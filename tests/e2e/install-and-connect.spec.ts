/**
 * E2E install + connect: drives the user's REAL browser (Chrome by default,
 * Edge with COPILOT_TEST_BROWSER=edge) with the REAL profile through two
 * install scenarios — clean reinstall and stale-installer reinstall — and
 * verifies the side panel reaches "Connected" plus two `claude -p` turns
 * invoking `mcp__pilotwave__list_tabs` against the live bridge.
 *
 * Opt-in. Set COPILOT_TEST_KILL_CHROME=1 to allow killing the user's running
 * browser session (the browser holds an exclusive lock on the user-data-dir,
 * so attaching otherwise is impossible).
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';

import {
  describeInstall,
  isFullyInstalled,
  isFullyUninstalled,
  snapshotInstallState,
} from './helpers/install-state';
import { runInstall, runUninstall } from './helpers/installer-cli';
import {
  EXPECTED_EXTENSION_ID,
  closeChrome,
  killAllChrome,
  launchRealChrome,
} from './helpers/real-chrome';
import {
  assertConnected,
  openSidePanel,
  waitForConnected,
} from './helpers/sidepanel';
import { findListTabsCall, parseListTabsResult, runClaudePrompt } from './helpers/claude-cli';

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXTENSION_DIST = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');

const requirePrebuilt = () => {
  if (!existsSync(EXTENSION_DIST)) {
    throw new Error(
      `Extension dist missing at ${EXTENSION_DIST}.\n` +
        `Build it first: npm run build:extension`,
    );
  }
  const bridgeBin = path.resolve(REPO_ROOT, 'packages/native-host/bin/pilotwave-win-x64.exe');
  const helperBin = path.resolve(
    REPO_ROOT,
    'packages/native-host-helper/bin/pilotwave-helper-win-x64.exe',
  );
  if (!existsSync(bridgeBin) || !existsSync(helperBin)) {
    throw new Error(
      `Native binaries missing.\n` +
        `Build them first:\n` +
        `  npm run compile:win -w packages/native-host\n` +
        `  npm run compile:win -w packages/native-host-helper\n` +
        `Looked at:\n  ${bridgeBin}\n  ${helperBin}`,
    );
  }
};

const CLAUDE_PROMPT =
  'Use the mcp__pilotwave__list_tabs tool right now to enumerate every tab open in my browser. ' +
  'Call the tool. Do not describe what you would do.';

const runClaudeListTabsTurn = async (label: string): Promise<void> => {
  const result = await runClaudePrompt(CLAUDE_PROMPT, { timeoutMs: 180_000 });
  expect(
    result.exitCode,
    `${label}: claude -p exited non-zero. stderr (first 500): ${result.stderr.slice(0, 500)}`,
  ).toBe(0);
  const call = findListTabsCall(result);
  expect(
    call,
    `${label}: claude did not invoke mcp__pilotwave__list_tabs.\n` +
      `Tools called: ${result.toolUses.map((t) => t.toolName).join(', ') || '(none)'}\n` +
      `Final text: ${result.finalText.slice(0, 200)}\n` +
      `stderr (first 300): ${result.stderr.slice(0, 300)}`,
  ).toBeTruthy();
  expect(
    call!.res.isError,
    `${label}: list_tabs returned an error: ${call!.res.text.slice(0, 300)}`,
  ).toBe(false);
  const tabs = parseListTabsResult(call!.res.text);
  expect(Array.isArray(tabs), `${label}: list_tabs result should parse to an array`).toBe(true);
  expect(tabs.length, `${label}: list_tabs returned no tabs`).toBeGreaterThanOrEqual(1);
  const withUrl = tabs.find((t) => typeof t.url === 'string' && t.url.length > 0);
  expect(withUrl, `${label}: no tab in list_tabs result has a non-empty url`).toBeTruthy();
};

const runConnectAndChatPhase = async (
  context: BrowserContext,
  extensionId: string,
): Promise<void> => {
  // First: side panel must reach Connected. This validates the install +
  // bridge + native messaging path before we try to drive list_tabs from an
  // external MCP client.
  const page = await openSidePanel(context, extensionId);
  const display = await waitForConnected(page);
  assertConnected(display);

  // Then: run two list_tabs turns through Claude Code's MCP client. The
  // installer registers pilotwave as an MCP server in ~/.claude.
  // Two distinct subprocess turns to verify the bridge handles back-to-back
  // requests without state leaks.
  await runClaudeListTabsTurn('Claude turn #1');
  await runClaudeListTabsTurn('Claude turn #2');
};

test.describe.configure({ mode: 'serial' });

test.describe('install-and-connect', () => {
  test.beforeAll(() => {
    requirePrebuilt();
  });

  test.afterAll(async () => {
    killAllChrome();
  });

  test('Test A — clean reinstall: full uninstall, reinstall from local, side panel reaches Connected, two chats invoke list_tabs', async () => {
    test.setTimeout(8 * 60_000);

    // 1. If anything is installed, fully uninstall.
    let snap = snapshotInstallState();
    if (
      snap.bridgeBinary.exists ||
      snap.helperBinary.exists ||
      snap.nativeHostManifest.exists ||
      snap.helperManifest.exists ||
      snap.lockFile.exists ||
      snap.registry.nativeHost ||
      snap.registry.helper ||
      snap.registry.autostart
    ) {
      const r = runUninstall();
      expect(r.ok, `installer --uninstall failed:\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(true);
    }

    // 2. Verify everything is gone.
    snap = snapshotInstallState();
    expect(
      isFullyUninstalled(snap),
      `expected a fully uninstalled state but found:\n${describeInstall(snap)}`,
    ).toBe(true);

    // 3. Install from the local working tree.
    const ir = runInstall(EXPECTED_EXTENSION_ID);
    expect(
      ir.ok,
      `installer --from-local failed (exit=${ir.exitCode}):\nstdout:\n${ir.stdout}\nstderr:\n${ir.stderr}`,
    ).toBe(true);

    // 4. Verify install dropped all required artifacts.
    snap = snapshotInstallState();
    expect(
      isFullyInstalled(snap),
      `expected a fully installed state but found:\n${describeInstall(snap)}`,
    ).toBe(true);

    // 5. Launch real Chrome with the extension and run the connect + chat phase.
    const launched = await launchRealChrome({ extensionDist: EXTENSION_DIST });
    try {
      expect(launched.extensionId).toBe(EXPECTED_EXTENSION_ID);
      await runConnectAndChatPhase(launched.context, launched.extensionId);
    } finally {
      await closeChrome(launched.context);
    }
  });

  test('Test B — stale-installer reinstall: prior install left running, new install must overwrite + reach Connected', async () => {
    test.setTimeout(8 * 60_000);

    // 1. Confirm prior install is still on disk (Test A leaves it; if not, install
    //    once now to seed the stale state we want to overwrite). We deliberately
    //    do NOT run --uninstall here — that's the whole point of Test B.
    let snap = snapshotInstallState();
    if (!isFullyInstalled(snap)) {
      const seed = runInstall(EXPECTED_EXTENSION_ID);
      expect(
        seed.ok,
        `seed install failed (exit=${seed.exitCode}):\nstdout:\n${seed.stdout}\nstderr:\n${seed.stderr}`,
      ).toBe(true);
      snap = snapshotInstallState();
      expect(isFullyInstalled(snap), `seed install incomplete:\n${describeInstall(snap)}`).toBe(true);
    }

    // 2. Make sure NO Chrome is open (so the only thing holding the old binary
    //    open is the running bridge — that's the regression case).
    killAllChrome();

    // 3. Confirm the old bridge is actually running so we exercise the fix.
    //    The installer auto-spawns it after a successful install (app.tsx ~248).
    const before = snapshotInstallState();
    expect(
      before.runningBridgePids.length,
      `expected a running bridge from the prior install but found none:\n${describeInstall(before)}`,
    ).toBeGreaterThan(0);
    const oldBridgeMtime = before.bridgeBinary.mtimeMs ?? 0;
    const oldBridgePids = new Set(before.runningBridgePids);

    // 4. Reinstall over the top — without uninstall — and verify the new
    //    install overwrote the binary even though the old bridge held a lock.
    const r = runInstall(EXPECTED_EXTENSION_ID);
    expect(
      r.ok,
      `stale reinstall failed (exit=${r.exitCode}):\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}\n` +
        `before-snap:\n${describeInstall(before)}`,
    ).toBe(true);

    const after = snapshotInstallState();
    expect(isFullyInstalled(after), `post-reinstall state incomplete:\n${describeInstall(after)}`).toBe(true);
    // mtime moved forward → file was actually replaced. Equal-or-newer is fine
    // (Node atomic-rename can preserve mtime in some FS configurations, so we
    // also accept the weaker check that the old PIDs are gone).
    const mtimeAdvanced = (after.bridgeBinary.mtimeMs ?? 0) >= oldBridgeMtime;
    const oldPidsKilled = after.runningBridgePids.every((pid) => !oldBridgePids.has(pid));
    expect(
      mtimeAdvanced && oldPidsKilled,
      `expected reinstall to replace binary and kill old bridge.\n` +
        `before mtime=${oldBridgeMtime} pids=[${[...oldBridgePids].join(',')}]\n` +
        `after  mtime=${after.bridgeBinary.mtimeMs} pids=[${after.runningBridgePids.join(',')}]`,
    ).toBe(true);

    // 5. Launch real Chrome, run the connect + chat phase.
    const launched = await launchRealChrome({ extensionDist: EXTENSION_DIST });
    try {
      expect(launched.extensionId).toBe(EXPECTED_EXTENSION_ID);
      await runConnectAndChatPhase(launched.context, launched.extensionId);
    } finally {
      await closeChrome(launched.context);
    }
  });
});
