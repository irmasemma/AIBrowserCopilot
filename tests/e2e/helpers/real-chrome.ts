/**
 * Launch the user's real browser (Chrome by default, or Edge with
 * COPILOT_TEST_BROWSER=edge) — real profile, real credentials — and locate the
 * Pilotwave extension's service worker.
 *
 * Real-profile launch is gated by COPILOT_TEST_KILL_CHROME=1 because attaching
 * to a profile that's already in use requires killing the user's running
 * browser (Chrome and Edge both hold an exclusive lock on their user-data-dir).
 * The gate keeps a casual `playwright test` from stomping on the user's session.
 */
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

type BrowserChoice = 'chrome' | 'edge';

const BROWSER: BrowserChoice =
  (process.env.COPILOT_TEST_BROWSER?.toLowerCase() as BrowserChoice) === 'edge' ? 'edge' : 'chrome';

interface BrowserSpec {
  /** Process image name on Windows. */
  imageName: string;
  /** Possible exe install paths in priority order. */
  exeCandidates: string[];
  /** Default OS user-data-dir for this browser. */
  defaultUserDataDir: string;
  /** Default profile directory inside user-data-dir. */
  defaultProfile: string;
  /** chrome:// or edge:// URL for the extensions page. */
  extensionsUrl: string;
  /**
   * True when this binary is on a stable channel that silently ignores
   * --load-extension. Stable Google Chrome (138+) does this. Edge currently
   * does not.
   */
  isStableLoadExtensionBlocked: (exe: string) => boolean;
}

const CHROME_SPEC: BrowserSpec = {
  imageName: 'chrome.exe',
  exeCandidates: [
    process.env.COPILOT_TEST_CHROME_EXE ?? '',
    'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome SxS\\Application\\chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  ].filter((p) => p.length > 0),
  defaultUserDataDir: path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data'),
  defaultProfile: 'Profile 1',
  extensionsUrl: 'chrome://extensions/',
  isStableLoadExtensionBlocked: (exe) => {
    const dir = exe.toLowerCase();
    return !dir.includes('chrome dev') && !dir.includes('chrome beta') && !dir.includes('chrome sxs');
  },
};

const EDGE_SPEC: BrowserSpec = {
  imageName: 'msedge.exe',
  exeCandidates: [
    process.env.COPILOT_TEST_EDGE_EXE ?? '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((p) => p.length > 0),
  defaultUserDataDir: path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'User Data'),
  defaultProfile: 'Default',
  extensionsUrl: 'edge://extensions/',
  // Edge has not (yet) shipped Chrome's stable-channel load-extension block.
  isStableLoadExtensionBlocked: () => false,
};

const SPEC: BrowserSpec = BROWSER === 'edge' ? EDGE_SPEC : CHROME_SPEC;

export const EXPECTED_EXTENSION_ID =
  process.env.COPILOT_TEST_EXPECTED_EXTENSION_ID ?? 'ehchmchlmggdigicfjfmlgcbhdcdcmll';

export const USER_DATA_DIR = process.env.COPILOT_TEST_USER_DATA_DIR ?? SPEC.defaultUserDataDir;
export const PROFILE_DIR = process.env.COPILOT_TEST_PROFILE_DIR ?? SPEC.defaultProfile;

export const findChromeExe = (): string | null => {
  for (const p of SPEC.exeCandidates) if (existsSync(p)) return p;
  return null;
};

export const isChromeRunning = (): boolean => {
  const r = spawnSync('tasklist.exe', ['/FI', `IMAGENAME eq ${SPEC.imageName}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf-8',
  });
  return r.status === 0 && new RegExp(SPEC.imageName.replace('.', '\\.'), 'i').test(r.stdout);
};

export const killAllChrome = (): void => {
  if (!isChromeRunning()) return;
  try {
    execSync(`taskkill /IM ${SPEC.imageName} /F`, { stdio: 'ignore', timeout: 10_000 });
  } catch {
    // taskkill exits non-zero when nothing matches — fine.
  }
  // Wait for the user-data-dir lock file to release.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!isChromeRunning()) return;
    execSync('cmd /c "ping -n 1 127.0.0.1 >nul"', { stdio: 'ignore' });
  }
};

// Chromium 136+ refuses remote debugging when --user-data-dir matches the OS
// default profile path. Present the real dir to the browser under a different
// path via a directory junction; the gate compares path strings, so this slips
// through while the underlying data (cookies, sessions, extensions) is the
// real profile. Idempotent — reuses an existing junction on subsequent runs.
// Browser-suffixed so Chrome and Edge get distinct junctions.
const JUNCTION_USER_DATA_DIR = path.join(os.tmpdir(), `copilot-real-${BROWSER}-userdata`);
const ensureNonDefaultUserDataDir = (realUserDataDir: string): string => {
  if (existsSync(JUNCTION_USER_DATA_DIR)) {
    try {
      const st = lstatSync(JUNCTION_USER_DATA_DIR);
      // Node reports both junctions and symlinks as isSymbolicLink on Windows.
      if (st.isSymbolicLink()) return JUNCTION_USER_DATA_DIR;
    } catch {
      // recreate below
    }
    throw new Error(
      `${JUNCTION_USER_DATA_DIR} exists but is not a junction. Remove it manually and retry.`,
    );
  }
  const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', JUNCTION_USER_DATA_DIR, realUserDataDir], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(
      `Failed to create junction ${JUNCTION_USER_DATA_DIR} -> ${realUserDataDir}\n` +
        `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  }
  return JUNCTION_USER_DATA_DIR;
};

export interface LaunchedChrome {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  chromeExe: string;
}

export interface LaunchOpts {
  /** Path to extension dist (chrome-mv3). When omitted, no extension is loaded. */
  extensionDist?: string;
  /** Hard timeout to find the service worker (only relevant when loading the extension). */
  serviceWorkerTimeoutMs?: number;
  /** Extra Chrome args. */
  extraArgs?: string[];
}

const matchExtensionId = (sw: Worker): string | null =>
  sw.url().match(/^chrome-extension:\/\/([a-z]+)\//)?.[1] ?? null;

/**
 * Chrome 128+ and Edge similarly block unpacked extensions unless Developer
 * Mode is ON in the profile. The flag lives in HMAC-protected Secure
 * Preferences so we cannot flip it from outside the browser — but
 * chrome://extensions / edge://extensions exposes a toggle and Playwright can
 * drive it via CDP (regular content scripts can't, chrome:// and edge:// URLs
 * are gated). Returns whether the toggle was just flipped (true) or was
 * already on (false). After flipping, the caller must reload the page that
 * loads the extension; the browser won't auto-load --load-extension paths
 * retroactively.
 */
const ensureDeveloperModeOn = async (context: BrowserContext): Promise<boolean> => {
  const page = await context.newPage();
  try {
    await page.goto(SPEC.extensionsUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    // Chrome puts the toggle at extensions-manager → extensions-toolbar → #devMode.
    // Edge's extensions page uses a similar Polymer structure but with a slightly
    // different element tree. Rather than hard-coding either path we walk every
    // shadow root in the document looking for an element whose id is "devMode" or
    // whose aria-label/title hints at "developer mode". Polymer hydrates async so
    // we poll briefly.
    const result = await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const isToggleOn = (el: Element): boolean => {
        if (el instanceof HTMLInputElement) return el.checked;
        return (
          el.getAttribute('aria-pressed') === 'true' ||
          el.getAttribute('aria-checked') === 'true' ||
          el.hasAttribute('checked')
        );
      };

      const matchesDevMode = (el: Element): boolean => {
        // Chrome: cr-toggle id="devMode". Edge: input id="developer-mode".
        if (el.id === 'devMode' || el.id === 'developer-mode') return true;
        const aria = (el.getAttribute('aria-label') ?? '').toLowerCase();
        const title = (el.getAttribute('title') ?? '').toLowerCase();
        return aria.includes('developer mode') || title.includes('developer mode');
      };

      const walk = (root: Document | ShadowRoot): Element | null => {
        const stack: Array<Element | ShadowRoot | Document> = [root];
        while (stack.length > 0) {
          const node = stack.pop()!;
          const els = (node as ParentNode).querySelectorAll('*');
          for (const el of Array.from(els)) {
            if (matchesDevMode(el)) return el;
            const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
            if (sr) stack.push(sr);
          }
        }
        return null;
      };

      for (let i = 0; i < 20; i++) {
        const toggle = walk(document);
        if (toggle) {
          const wasOn = isToggleOn(toggle);
          if (!wasOn) (toggle as HTMLElement).click();
          return { found: true, wasOn };
        }
        await sleep(150);
      }
      return { found: false, wasOn: false };
    });
    if (!result.found) {
      const sample = await page.evaluate(() => {
        const collect = (root: Document | ShadowRoot, depth: number, out: string[]): void => {
          if (depth > 6) return;
          for (const el of Array.from((root as ParentNode).querySelectorAll('*'))) {
            const id = el.id;
            const aria = el.getAttribute('aria-label') ?? '';
            const role = el.getAttribute('role') ?? '';
            if (id || aria || ['button', 'switch', 'checkbox'].includes(role)) {
              out.push(
                `${'  '.repeat(depth)}<${el.tagName.toLowerCase()} id="${id}" aria-label="${aria}" role="${role}">`,
              );
            }
            const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
            if (sr) collect(sr, depth + 1, out);
          }
        };
        const out: string[] = [];
        collect(document, 0, out);
        return out.slice(0, 80).join('\n');
      });
      throw new Error(
        `Developer Mode toggle not found in ${SPEC.extensionsUrl} DOM. ` +
          `Interesting elements (truncated):\n${sample}`,
      );
    }
    return !result.wasOn;
  } finally {
    await page.close().catch(() => undefined);
  }
};

interface WakeAttempt {
  navigated: boolean;
  navError?: string;
  pageTitle?: string;
}

const tryWakeServiceWorker = async (
  context: BrowserContext,
  expectedId: string,
): Promise<WakeAttempt> => {
  // MV3 service workers are lazy — they don't necessarily register on
  // browser startup. Opening any URL from the extension forces activation.
  // If the extension is not loaded at all, this throws; we surface it for
  // diagnostics rather than swallowing.
  let page;
  try {
    page = await context.newPage();
    await page.goto(`chrome-extension://${expectedId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    const title = await page.title();
    await page.close();
    return { navigated: true, pageTitle: title };
  } catch (err) {
    if (page) await page.close().catch(() => undefined);
    return { navigated: false, navError: err instanceof Error ? err.message : String(err) };
  }
};

const findServiceWorker = async (
  context: BrowserContext,
  expectedId: string,
  timeoutMs: number,
): Promise<{ extensionId: string; serviceWorker: Worker }> => {
  // Always try to wake the SW first — MV3 SWs are lazy and may not register
  // until something navigates to a chrome-extension:// URL. The wake result
  // also tells us whether the extension is loaded at all.
  const wake = await tryWakeServiceWorker(context, expectedId);

  const deadline = Date.now() + timeoutMs;
  let lastSeen: string[] = [];

  while (Date.now() < deadline) {
    const sws = context.serviceWorkers();
    lastSeen = sws.map((sw) => sw.url());
    for (const sw of sws) {
      if (matchExtensionId(sw) === expectedId) {
        return { extensionId: expectedId, serviceWorker: sw };
      }
    }
    await wait(300);
  }

  const sws = context.serviceWorkers();
  const ids = sws.map(matchExtensionId).filter((id): id is string => Boolean(id));
  const wakeReport = wake.navigated
    ? `wake-up: navigated to chrome-extension://${expectedId}/sidepanel.html OK (title="${wake.pageTitle}") — but no SW appeared`
    : `wake-up: navigation FAILED (${wake.navError}) — extension is probably not loaded. ` +
      `Most likely cause: Developer Mode is OFF in ${SPEC.extensionsUrl} for this profile. ` +
      `Open the browser (close test first), go to ${SPEC.extensionsUrl}, toggle "Developer mode" on, then re-run.`;
  throw new Error(
    `Did not find expected extension ID "${expectedId}" within ${timeoutMs}ms.\n` +
      `Service workers seen: ${lastSeen.join(', ') || '(none)'}\n` +
      `Extension IDs derived: ${ids.join(', ') || '(none)'}\n` +
      `${wakeReport}\n` +
      `If the unpacked extension path produces a different ID on this machine, set ` +
      `COPILOT_TEST_EXPECTED_EXTENSION_ID and rerun the installer with that ID in --extension-id.`,
  );
};

const baseChromeArgs = (extraArgs?: string[]): string[] => [
  `--profile-directory=${PROFILE_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  ...(extraArgs ?? []),
];

const launchOptions = (chromeExe: string, args: string[]) => ({
  executablePath: chromeExe,
  headless: false as const,
  args,
  // Drop --disable-extensions: it suppresses unpacked extensions even when
  // --load-extension is supplied on some Chrome builds. Drop --enable-automation
  // so Chrome doesn't slap an "automated test software" infobar.
  ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
  timeout: 60_000,
});

const bootstrapDeveloperMode = async (chromeExe: string, userDataDir: string): Promise<void> => {
  // Brief launch with no --load-extension just to flip the Developer Mode
  // toggle. Chrome 128+ refuses unpacked extensions until this is on, and the
  // flag lives in HMAC-protected Secure Preferences (can't be edited from
  // outside Chrome). Idempotent: if dev mode is already on, the toggle's no-op
  // is handled inside ensureDeveloperModeOn.
  const ctx = await chromium.launchPersistentContext(
    userDataDir,
    launchOptions(chromeExe, baseChromeArgs()),
  );
  try {
    const flipped = await ensureDeveloperModeOn(ctx);
    if (flipped) await wait(1500); // let Chrome persist the pref before close
  } finally {
    await ctx.close().catch(() => undefined);
  }
  killAllChrome();
};

export const launchRealChrome = async (opts: LaunchOpts = {}): Promise<LaunchedChrome> => {
  if (process.env.COPILOT_TEST_KILL_CHROME !== '1') {
    throw new Error(
      'Refusing to launch — COPILOT_TEST_KILL_CHROME is not set to "1".\n' +
        'Running this test will kill your real Chrome session. To opt in:\n' +
        '  COPILOT_TEST_KILL_CHROME=1 npx playwright test tests/e2e/install-and-connect.spec.ts',
    );
  }

  const chromeExe = findChromeExe();
  if (!chromeExe) {
    throw new Error(
      `${SPEC.imageName} not found in standard install paths. ` +
        `Set ${BROWSER === 'edge' ? 'COPILOT_TEST_EDGE_EXE' : 'COPILOT_TEST_CHROME_EXE'}.`,
    );
  }
  if (opts.extensionDist && SPEC.isStableLoadExtensionBlocked(chromeExe)) {
    throw new Error(
      `Refusing to launch Chrome stable (${chromeExe}) with --load-extension.\n` +
        'Google Chrome stable silently ignores --load-extension since channel 138+, so the\n' +
        'unpacked extension will never load and this test will hang on the side-panel\n' +
        'connection step. Install Chrome Dev (https://www.google.com/chrome/dev/), set\n' +
        'COPILOT_TEST_CHROME_EXE to a Chromium / Canary / Beta binary that still honours\n' +
        '--load-extension, or run the test against Edge by setting COPILOT_TEST_BROWSER=edge.\n' +
        'See docs/test-findings.md (#4) for context.',
    );
  }

  killAllChrome();

  const userDataDir = ensureNonDefaultUserDataDir(USER_DATA_DIR);

  if (opts.extensionDist) {
    await bootstrapDeveloperMode(chromeExe, userDataDir);
  }

  const args = baseChromeArgs(opts.extraArgs);
  if (opts.extensionDist) {
    args.push(`--load-extension=${opts.extensionDist}`);
    args.push(`--disable-extensions-except=${opts.extensionDist}`);
  }

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions(chromeExe, args));

  if (!opts.extensionDist) {
    return { context, extensionId: '', serviceWorker: null as unknown as Worker, chromeExe };
  }

  const { extensionId, serviceWorker } = await findServiceWorker(
    context,
    EXPECTED_EXTENSION_ID,
    opts.serviceWorkerTimeoutMs ?? 15_000,
  );
  return { context, extensionId, serviceWorker, chromeExe };
};

export const closeChrome = async (context: BrowserContext | null | undefined): Promise<void> => {
  if (!context) return;
  try {
    await context.close();
  } catch {
    // best-effort
  }
  // Belt and braces — context.close() doesn't always reap the chrome.exe tree.
  killAllChrome();
};
