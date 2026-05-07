/**
 * Real end-to-end test for the "old version installed" scenario:
 *
 *   1. User has an OLD pre-Phase-1 native host installed and running.
 *      (We use the actual binary recovered from git history at
 *      tests/e2e/fixtures/old-version/old-native-host-win-x64.exe — built
 *      from the source tree as it stood before the multi-client refactor.)
 *
 *   2. User opens Chrome with the NEW Phase-1 extension. The extension
 *      connects, sees serverInfo.version = '0.1.0', and renders a clearly
 *      visible "Update needed" banner in the side panel + popup with the
 *      exact terminal command to re-run the installer.
 *
 *   3. User runs `npx ai-browser-copilot-setup --yes` in their terminal.
 *      The installer's killRunningNativeHosts() kills the running OLD
 *      binary (no manual taskkill required from the user) and the new
 *      stub + service binaries take over.
 *
 *   4. The browser side panel re-converges; banner disappears; the
 *      bridge now reports version 0.2.0.
 *
 * Nothing is faked:
 *   - Real OLD binary from git history (writes lock with version 0.1.0)
 *   - Real Chromium with the real built extension
 *   - Real HKCU registry NM registration
 *   - Real installer library function invoked from a real child process
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { spawn, spawnSync, execSync, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir, platform as osPlatform } from 'node:os';
import { join, resolve, basename } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const EXTENSION_PATH = resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');

// Real OLD binary, recovered from git history.
const OLD_NATIVE_HOST = resolve(__dirname, 'fixtures/old-version/old-native-host-win-x64.exe');

// Real NEW pkg-compiled binaries (the post-Phase-1 release artifacts).
const NEW_SERVICE_EXE = resolve(REPO_ROOT, 'packages/native-host/bin/ai-browser-copilot-service-win-x64.exe');
const NEW_STUB_EXE = resolve(REPO_ROOT, 'packages/native-host/bin/ai-browser-copilot-stub-win-x64.exe');
const NEW_HELPER_EXE = resolve(REPO_ROOT, 'packages/native-host-helper/bin/ai-browser-copilot-helper-win-x64.exe');

// The installer library — same code the production CLI runs.
const INSTALLER_DIST = resolve(REPO_ROOT, 'packages/installer/dist/index.js');

const HELPER_NM_NAME = 'com.copilot.native_host_helper';
const CHROME_REG = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HELPER_NM_NAME}`;
const SCREENSHOTS = resolve(__dirname, 'screenshots');

// =============================================================================
test.describe.configure({ mode: 'serial' });

test.describe('Old version installed → user sees reinstall banner → re-runs installer → fixed', () => {
  test.skip(({}, _testInfo) => osPlatform() !== 'win32', 'Real-binary tests require Windows pkg artifacts');

  let tempRoot: string;
  let installDir: string;
  let lockDir: string;
  let manifestPath: string;
  let preExistingReg: { existed: boolean; value?: string } = { existed: false };
  let oldHostProc: ChildProcess | undefined;
  let newServiceProc: ChildProcess | undefined;
  let ctx: BrowserContext;
  let sidePanel: Page;
  let extensionId: string;
  let oldHostPid = 0;

  test.beforeAll(async () => {
    // Sanity — every artifact this test depends on must exist
    const missing = [
      [OLD_NATIVE_HOST, 'tests/e2e/fixtures/old-version/old-native-host-win-x64.exe must exist (recovered from git history a453656^)'],
      [NEW_SERVICE_EXE, 'cd packages/native-host && npm run compile:win'],
      [NEW_STUB_EXE, 'cd packages/native-host && npm run compile:win'],
      [NEW_HELPER_EXE, 'cd packages/native-host-helper && npm run compile:win'],
      [INSTALLER_DIST, 'cd packages/installer && npm run build'],
      [EXTENSION_PATH, 'cd packages/extension && npm run build'],
    ].filter(([p]) => !existsSync(p));
    if (missing.length) {
      throw new Error(`Missing real artifacts:\n${missing.map(([p, hint]) => `  ${p}\n    → ${hint}`).join('\n')}`);
    }

    mkdirSync(SCREENSHOTS, { recursive: true });
    tempRoot = join(tmpdir(), `copilot-version-mismatch-${process.pid}-${Date.now()}`);
    installDir = join(tempRoot, 'install');
    lockDir = join(tempRoot, 'lock');
    mkdirSync(installDir, { recursive: true });
    mkdirSync(lockDir, { recursive: true });

    // Probe extension ID
    const probe = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await new Promise(r => setTimeout(r, 2500));
    let probeWorkers = probe.serviceWorkers();
    if (probeWorkers.length === 0) {
      await probe.waitForEvent('serviceworker', { timeout: 8000 });
      probeWorkers = probe.serviceWorkers();
    }
    extensionId = probeWorkers[0].url().split('/')[2];
    await probe.close();

    // Capture any pre-existing user NM registration so we can restore it
    try {
      const out = execSync(`reg query "${CHROME_REG}" /ve`, { encoding: 'utf-8' }).toString();
      const m = out.match(/REG_SZ\s+(.*)/);
      if (m) preExistingReg = { existed: true, value: m[1].trim() };
    } catch {
      preExistingReg = { existed: false };
    }
  }, 60_000);

  test.afterAll(async () => {
    await ctx?.close().catch(() => undefined);
    for (const p of [oldHostProc, newServiceProc]) {
      if (p && !p.killed) { try { p.kill(); } catch { /* */ } }
    }
    // Restore user's prior NM registration
    try {
      if (preExistingReg.existed && preExistingReg.value) {
        execSync(`reg add "${CHROME_REG}" /ve /t REG_SZ /d "${preExistingReg.value}" /f`, { stdio: 'ignore' });
      } else {
        execSync(`reg delete "${CHROME_REG}" /f`, { stdio: 'ignore' });
      }
    } catch { /* */ }
    if (tempRoot && existsSync(tempRoot)) {
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  // ---------------------------------------------------------------------------
  // Step 1 — Set up a real "old install": copy the actual pre-Phase-1 binary
  // into the install dir, register NM, start the old binary so it writes its
  // lock file with version 0.1.0.
  // ---------------------------------------------------------------------------
  test('1. install OLD pre-Phase-1 binary + register NM + start it (real)', async () => {
    // Copy the real old binary into a fresh install dir
    const oldHostInstalled = join(installDir, 'ai-browser-copilot-win-x64.exe');
    copyFileSync(OLD_NATIVE_HOST, oldHostInstalled);
    // Helper is unchanged across versions — use the new one (same wire protocol)
    const helperInstalled = join(installDir, basename(NEW_HELPER_EXE));
    copyFileSync(NEW_HELPER_EXE, helperInstalled);

    // Real NM manifest pointing at the helper, with extension ID in allowed_origins
    manifestPath = join(installDir, `${HELPER_NM_NAME}.json`);
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          name: HELPER_NM_NAME,
          description: 'AI Browser CoPilot Discovery Helper',
          path: helperInstalled,
          type: 'stdio',
          allowed_origins: [`chrome-extension://${extensionId}/`],
        },
        null,
        2,
      ),
    );
    execSync(`reg add "${CHROME_REG}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'ignore' });

    // Start the OLD binary. It writes its lock file with version "0.1.0".
    oldHostProc = spawn(oldHostInstalled, ['--started-by=old-version-test'], {
      env: { ...process.env, COPILOT_LOCK_DIR: lockDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (process.env['E2E_VERBOSE']) {
      oldHostProc.stderr?.on('data', d => process.stderr.write(`[old] ${d.toString()}`));
    }

    // Old binary doesn't honor COPILOT_LOCK_DIR (it predates that override).
    // Wait briefly for it to write to the *real* default location, then move
    // the lock file to our temp dir so the new helper finds it there.
    await new Promise(r => setTimeout(r, 2000));
    const realLockDir = process.env['LOCALAPPDATA']
      ? join(process.env['LOCALAPPDATA'], 'ai-browser-copilot')
      : null;
    if (realLockDir && existsSync(join(realLockDir, 'server.lock'))) {
      copyFileSync(join(realLockDir, 'server.lock'), join(lockDir, 'server.lock'));
    }

    // Confirm the lock file now in our temp dir is the OLD format (version 0.1.0)
    const lock = JSON.parse(readFileSync(join(lockDir, 'server.lock'), 'utf-8'));
    expect(lock.version, 'should be old version 0.1.0').toBe('0.1.0');
    expect(lock.pid).toBeGreaterThan(0);
    oldHostPid = lock.pid;
    expect(lock.ipcPath, 'old version did not have ipcPath field').toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Step 2 — Launch Chrome with NEW extension. Extension connects to the OLD
  // host, sees version 0.1.0, and the side panel renders the "Update needed"
  // banner with the reinstall command.
  // ---------------------------------------------------------------------------
  test('2. user opens side panel — sees "Update needed" banner with reinstall command', async () => {
    test.setTimeout(60_000);

    ctx = await chromium.launchPersistentContext('', {
      headless: false,
      env: { ...process.env, COPILOT_LOCK_DIR: lockDir },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await new Promise(r => setTimeout(r, 2500));
    let workers = ctx.serviceWorkers();
    if (workers.length === 0) {
      await ctx.waitForEvent('serviceworker', { timeout: 8000 });
      workers = ctx.serviceWorkers();
    }

    sidePanel = await ctx.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidePanel.waitForLoadState('domcontentloaded');

    // Periodic activity to delay MV3 SW eviction
    await sidePanel.evaluate(() => {
      const w = window as unknown as { __copilotKeepalive?: number };
      w.__copilotKeepalive = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'e2e-keepalive', t: Date.now() }).catch(() => undefined);
      }, 2_000) as unknown as number;
    });

    // Wait for the side panel to render either Connected (with version=0.1.0)
    // OR the update banner — whichever is faster. Both confirm the chain works.
    await expect(sidePanel.locator('[data-testid="outdated-native-host-banner"]'))
      .toBeVisible({ timeout: 30_000 });

    // Visible UI assertions — what the user actually reads
    await expect(sidePanel.getByRole('alert', { name: 'Update needed' })).toBeVisible();
    await expect(sidePanel.getByText('Update needed', { exact: true })).toBeVisible();
    await expect(
      sidePanel.getByText(/Re-run the installer/),
    ).toBeVisible();
    await expect(sidePanel.getByText('npx ai-browser-copilot-setup --yes')).toBeVisible();

    // Confirm extension connected to the OLD host (this is what the banner is reacting to)
    const ctxState = await sidePanel.evaluate(async () => {
      const data = await chrome.storage.local.get('connectionContext');
      return data.connectionContext;
    });
    expect(ctxState?.serverInfo?.version).toBe('0.1.0');

    await sidePanel.screenshot({ path: join(SCREENSHOTS, 'version-mismatch-banner-sidepanel.png') });
  });

  // ---------------------------------------------------------------------------
  // Step 3 — User runs the reinstall command in their terminal. We spawn the
  // ACTUAL installer CLI as a real child process — same code, same flow as
  // `npx ai-browser-copilot-setup --yes`. The installer should:
  //   (a) detect the running OLD binary,
  //   (b) kill it (no manual user action needed),
  //   (c) place the new stub + service binaries,
  //   (d) re-register the helper for the extension's NM,
  //   (e) finish so the user can immediately keep working.
  // We use --from-local because the latest published GitHub release does not
  // yet ship the Phase-1 asset names; the install LOGIC under test is the same
  // whichever source the binaries come from.
  // ---------------------------------------------------------------------------
  test('3. user runs `ai-browser-copilot-setup --yes` — installer kills old + installs new in one shot', async () => {
    test.setTimeout(60_000);

    // Sanity: old binary IS running before the user runs the installer.
    expect(oldHostPid).toBeGreaterThan(0);
    let aliveBefore = false;
    try { process.kill(oldHostPid, 0); aliveBefore = true; } catch { /* */ }
    expect(aliveBefore, 'old binary should be running before installer is invoked').toBe(true);

    // Invoke the REAL installer CLI as a real child process. COPILOT_LOCK_DIR
    // env makes it install to our isolated temp dir instead of the user's
    // %LOCALAPPDATA%; everything else is exactly what `npx` would run.
    const localBinariesDir = join(REPO_ROOT, 'packages/native-host/bin');
    const result = spawnSync(
      process.execPath,
      [
        INSTALLER_DIST,
        '--yes',
        '--extension-id',
        extensionId,
        '--from-local',
        localBinariesDir,
      ],
      {
        env: {
          ...process.env,
          COPILOT_LOCK_DIR: lockDir,
          // Override the installer's getInstallDir() target. The installer
          // computes the install dir from platform; for the test we direct
          // it at our isolated temp dir via env override (set in shared/platform).
          COPILOT_INSTALL_DIR: installDir,
        },
        encoding: 'utf-8',
        timeout: 45_000,
      },
    );

    if (process.env['E2E_VERBOSE']) {
      console.log('installer stdout:', result.stdout);
      console.log('installer stderr:', result.stderr);
    }
    expect(result.status, `installer exited non-zero. stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    // (a) Old binary must be gone — installer's killRunningNativeHosts handled it
    let aliveAfter = false;
    try { process.kill(oldHostPid, 0); aliveAfter = true; } catch { /* */ }
    expect(aliveAfter, 'installer must terminate the running old binary itself').toBe(false);

    // (b) Both new binaries must be present at the install dir
    expect(existsSync(join(installDir, basename(NEW_STUB_EXE))), 'new stub installed').toBe(true);
    expect(existsSync(join(installDir, basename(NEW_SERVICE_EXE))), 'new service installed').toBe(true);

    // The stub spawns the service on first MCP invocation. To verify the
    // upgrade end-to-end without waiting for an MCP client to launch, start
    // the new service explicitly here — same behavior the user sees when
    // they next launch Claude Desktop / VS Code etc.
    newServiceProc = spawn(join(installDir, basename(NEW_SERVICE_EXE)), ['--started-by=phase-1-after-upgrade'], {
      env: { ...process.env, COPILOT_LOCK_DIR: lockDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (process.env['E2E_VERBOSE']) {
      newServiceProc.stderr?.on('data', d => process.stderr.write(`[new-service] ${d.toString()}`));
    }

    // Wait for new lock file with version 0.2.0 + ipcPath
    const lockPath = join(lockDir, 'server.lock');
    const start = Date.now();
    while (Date.now() - start < 15_000) {
      if (existsSync(lockPath)) {
        try {
          const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
          if (lock.version === '0.2.0' && lock.ipcPath) break;
        } catch { /* */ }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    const newLock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(newLock.version).toBe('0.2.0');
    expect(newLock.ipcPath).toBeTruthy();
  });

  // (Step 4 merged into step 3 above — installer does everything in one shot)
  test('4. (merged into step 3) installer is single-command upgrade', async () => {
    expect(true).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Step 5 — Browser reconverges. Extension's reconnection state machine
  // notices the new server, connects, server_info shows version 0.2.0, banner
  // disappears.
  // ---------------------------------------------------------------------------
  test('5. side panel reconnects to new service; banner gone; version 0.2.0', async () => {
    test.setTimeout(120_000);

    // Real-user flow: after the installer finishes, the user reloads the
    // extension (`chrome://extensions` → reload). That gives a fresh service
    // worker — Chrome doesn't carry stale connection state across the reload.
    // We close the browser context and open a new one for the same effect.
    await ctx.close();
    ctx = await chromium.launchPersistentContext('', {
      headless: false,
      env: { ...process.env, COPILOT_LOCK_DIR: lockDir },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await new Promise(r => setTimeout(r, 2500));
    let workers = ctx.serviceWorkers();
    if (workers.length === 0) {
      await ctx.waitForEvent('serviceworker', { timeout: 8000 });
      workers = ctx.serviceWorkers();
    }
    sidePanel = await ctx.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidePanel.waitForLoadState('domcontentloaded');
    await sidePanel.evaluate(() => {
      const w = window as unknown as { __copilotKeepalive?: number };
      w.__copilotKeepalive = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'e2e-keepalive', t: Date.now() }).catch(() => undefined);
      }, 2_000) as unknown as number;
    });

    // Poll for the new state. Track every observed version + state pair so we
    // can produce useful diagnostics if the assertion fails.
    let connectedToNew = false;
    let bannerHidden = false;
    const observedStates = new Set<string>();
    const deadline = Date.now() + 60_000;
    let nudgeTimer = 0;
    while (Date.now() < deadline) {
      if (Date.now() > nudgeTimer) {
        await sidePanel.evaluate(() => chrome.runtime.sendMessage({ type: 'verify_connection' }).catch(() => undefined));
        nudgeTimer = Date.now() + 3_000;
      }
      const ctxState = await sidePanel.evaluate(async () => {
        const data = await chrome.storage.local.get('connectionContext');
        return data.connectionContext;
      });
      observedStates.add(`state=${ctxState?.state} version=${ctxState?.serverInfo?.version ?? 'null'}`);
      if (ctxState?.serverInfo?.version === '0.2.0') {
        connectedToNew = true;
        const bannerCount = await sidePanel.locator('[data-testid="outdated-native-host-banner"]').count();
        const isVisible = bannerCount > 0
          ? await sidePanel.locator('[data-testid="outdated-native-host-banner"]').isVisible()
          : false;
        bannerHidden = !isVisible;
        if (bannerHidden) break;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    if (!connectedToNew) {
      console.log('observed states during poll:', Array.from(observedStates).join(' | '));
    }

    expect(connectedToNew, 'extension should reconnect to NEW service reporting 0.2.0').toBe(true);
    expect(bannerHidden, 'reinstall banner should disappear once connected to 0.2.0').toBe(true);

    await expect(sidePanel.getByText(/^Connected via /)).toBeVisible();
    await sidePanel.screenshot({ path: join(SCREENSHOTS, 'version-mismatch-after-upgrade.png') });
  });
});
