/**
 * E2E install + side-panel chat: install from local, launch the real browser,
 * reach Connected, then run two side-panel chat turns — one configured for
 * OpenAI, one for Anthropic — and assert each invokes list_tabs against the
 * real bridge.
 *
 * Distinct from install-and-connect.spec.ts (which drives chats through
 * `claude -p` over MCP). This one exercises the extension's in-side-panel
 * chatbot end-to-end, which requires real provider API keys.
 *
 * Keys are read from env at runtime; never committed. Test skips itself with a
 * clear message when keys are missing.
 *
 *   AGENTHUB_TEST_OPENAI_KEY=sk-...
 *   AGENTHUB_TEST_ANTHROPIC_KEY=sk-ant-api03-...
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
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
  LIST_TABS_PROMPT,
  assertConnected,
  assertListTabsResult,
  dispatchListTabs,
  openSidePanel,
  seedChatConfig,
  sendChatMessage,
  startNewChat,
  switchToChatTab,
  waitForConnected,
  waitForToolCall,
  type ChatConfig,
  type Provider,
} from './helpers/sidepanel';

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXTENSION_DIST = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');

const requirePrebuilt = () => {
  if (!existsSync(EXTENSION_DIST)) {
    throw new Error(
      `Extension dist missing at ${EXTENSION_DIST}.\n` +
        `Build it first: npm run build:extension`,
    );
  }
};

const PROVIDER_MODEL: Record<Provider, string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash',
};

interface ProviderRun {
  provider: Provider;
  apiKey: string;
}

const collectProviderRuns = (): ProviderRun[] => {
  const runs: ProviderRun[] = [];
  const openai = process.env.AGENTHUB_TEST_OPENAI_KEY;
  const anthropic = process.env.AGENTHUB_TEST_ANTHROPIC_KEY;
  if (openai) runs.push({ provider: 'openai', apiKey: openai });
  if (anthropic) runs.push({ provider: 'anthropic', apiKey: anthropic });
  return runs;
};

const dumpChatState = async (page: Page): Promise<string> => {
  const transcript = await page
    .locator('[data-testid="chat-tool-call"], .max-w-\\[85\\%\\]')
    .allTextContents()
    .catch(() => [] as string[]);
  const hasError = await page.locator('text=/error|failed|invalid/i').count().catch(() => 0);
  const busy = await page.getByText('Working').count().catch(() => 0);
  return [
    `transcript blocks (${transcript.length}):`,
    ...transcript.map((t, i) => `  [${i}] ${t.slice(0, 200)}`),
    `error-ish text matches: ${hasError}`,
    `busy spinners visible: ${busy}`,
  ].join('\n');
};

interface ChatTurnOpts {
  /** When true, assert the side panel reaches Connected before chatting. */
  requireConnected: boolean;
}

const runSidePanelChatTurn = async (
  context: BrowserContext,
  extensionId: string,
  run: ProviderRun,
  label: string,
  opts: ChatTurnOpts,
): Promise<void> => {
  const t0 = Date.now();
  const tick = (msg: string) => console.log(`[${label}] +${Date.now() - t0}ms ${msg}`);

  tick('opening side panel');
  const page: Page = await openSidePanel(context, extensionId);
  const consoleLog: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => consoleLog.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const config: ChatConfig = {
    provider: run.provider,
    apiKey: run.apiKey,
    model: PROVIDER_MODEL[run.provider],
  };
  tick('seeding chat config');
  await seedChatConfig(page, config);
  // The side panel renders a SetupWizard (instead of the tabs) on first launch
  // when the bridge can't be reached and there's no prior connection. Test C
  // gets past this because the bridge IS up and lastConnectedAt becomes
  // non-null. Test D has no bridge — without this opt-out the Chat tab
  // wouldn't render, switchToChatTab would no-op, and the textarea fill below
  // would hang forever. setupComplete=true bypasses the wizard gate in
  // entrypoints/sidepanel/main.tsx, which is fine for the test surface.
  await page.evaluate(() => chrome.storage.local.set({ setupComplete: true }));
  tick('reloading');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });
  tick('header rendered');

  if (opts.requireConnected) {
    assertConnected(await waitForConnected(page));
    tick('reached Connected');
  } else {
    tick('skipping Connected check (no-bridge mode)');
  }

  tick('switching to chat tab');
  await switchToChatTab(page);
  tick('starting new chat');
  await startNewChat(page);
  tick('sending chat message');
  await sendChatMessage(page, LIST_TABS_PROMPT);

  try {
    tick('waiting for list_tabs tool call');
    const invocation = await waitForToolCall(page, 'list_tabs', { timeoutMs: 90_000 });
    tick(`got tool call ok=${invocation.ok}`);
    expect(
      invocation.ok,
      `${label}: list_tabs invocation should succeed (${invocation.text})`,
    ).toBe(true);
    tick('dispatching list_tabs directly');
    const tabs = await dispatchListTabs(page);
    tick(`got ${tabs.length} tabs from direct dispatch`);
    assertListTabsResult(tabs);
    tick('asserted; done');
  } catch (err) {
    tick(`caught: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
    const state = await dumpChatState(page).catch((dumpErr) => `(dump failed: ${dumpErr})`);
    throw new Error(
      `${label}: chat turn failed.\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}\n\n` +
        `Chat state:\n${state}\n\n` +
        `Page errors (${pageErrors.length}):\n${pageErrors.slice(-10).join('\n')}\n\n` +
        `Console (last 30):\n${consoleLog.slice(-30).join('\n')}`,
    );
  }

  await page.close();
};

test.describe.configure({ mode: 'serial' });

test.describe('install-and-chat', () => {
  const runs = collectProviderRuns();

  test.beforeAll(() => {
    requirePrebuilt();
    if (runs.length === 0) {
      test.skip(
        true,
        'No provider keys in env. Set AGENTHUB_TEST_OPENAI_KEY and/or AGENTHUB_TEST_ANTHROPIC_KEY to enable.',
      );
    }
  });

  test.afterAll(() => {
    killAllChrome();
  });

  const ensureFullyUninstalled = () => {
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
    snap = snapshotInstallState();
    expect(
      isFullyUninstalled(snap),
      `expected a fully uninstalled state but found:\n${describeInstall(snap)}`,
    ).toBe(true);
  };

  test('Test C — side-panel chat invokes list_tabs for each configured provider (OpenAI, Anthropic), bridge connected', async () => {
    test.setTimeout(10 * 60_000);

    ensureFullyUninstalled();

    const ir = runInstall(EXPECTED_EXTENSION_ID);
    expect(
      ir.ok,
      `installer --from-local failed (exit=${ir.exitCode}):\nstdout:\n${ir.stdout}\nstderr:\n${ir.stderr}`,
    ).toBe(true);
    const snap = snapshotInstallState();
    expect(
      isFullyInstalled(snap),
      `expected a fully installed state but found:\n${describeInstall(snap)}`,
    ).toBe(true);

    const launched = await launchRealChrome({ extensionDist: EXTENSION_DIST });
    try {
      expect(launched.extensionId).toBe(EXPECTED_EXTENSION_ID);
      for (const run of runs) {
        await runSidePanelChatTurn(
          launched.context,
          launched.extensionId,
          run,
          `provider=${run.provider}`,
          { requireConnected: true },
        );
      }
    } finally {
      await closeChrome(launched.context);
    }
  });

  test('Test D — side-panel chat invokes list_tabs for each configured provider, bridge NOT installed', async () => {
    test.setTimeout(5 * 60_000);

    // Regression for "extension works standalone": uninstall everything so no
    // bridge / native-messaging host / MCP registration exists, then verify the
    // side-panel chat path (chat → background dispatch_tool → tool-dispatcher
    // → chrome.tabs.query) still drives list_tabs end-to-end. Confirms list_tabs
    // is a pure browser-API call and does not depend on the bridge being up.
    ensureFullyUninstalled();

    const launched = await launchRealChrome({ extensionDist: EXTENSION_DIST });
    try {
      expect(launched.extensionId).toBe(EXPECTED_EXTENSION_ID);
      for (const run of runs) {
        await runSidePanelChatTurn(
          launched.context,
          launched.extensionId,
          run,
          `provider=${run.provider} (no-bridge)`,
          { requireConnected: false },
        );
      }
    } finally {
      await closeChrome(launched.context);
    }
  });

  test('Test E — side panel auto-recovers from no-bridge to Connected after install (no manual reload)', async () => {
    test.setTimeout(6 * 60_000);

    // Step 1: ensure nothing is installed (same starting state as Test D).
    ensureFullyUninstalled();

    // Step 2: launch the real browser, open the side panel WITHOUT installing
    //         the bridge first. setupComplete=true bypasses the SetupWizard so
    //         we can read the connection header. The header should show a
    //         broken state (helper_unavailable / no_lock_file / was_connected
    //         depending on what the SW manages to discover before our read).
    const launched = await launchRealChrome({ extensionDist: EXTENSION_DIST });
    let installerExit: number | null = null;
    let firstHeaderTitle = '';
    let recoveredAtMs: number | null = null;
    try {
      expect(launched.extensionId).toBe(EXPECTED_EXTENSION_ID);
      const page: Page = await openSidePanel(launched.context, launched.extensionId);
      await page.evaluate(() => chrome.storage.local.set({ setupComplete: true }));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

      const titleLoc = page.locator('[data-testid="connection-header-title"]').first();
      firstHeaderTitle = (await titleLoc.textContent())?.trim() ?? '';
      expect(
        firstHeaderTitle,
        'side panel should NOT be Connected before install runs',
      ).not.toBe('Connected');

      // Step 3: while the side panel is OPEN, run the installer. This is the
      //         exact flow a user follows: open the panel, see it's broken,
      //         run the install in another terminal, expect the panel to
      //         self-heal.
      const ir = runInstall(EXPECTED_EXTENSION_ID);
      installerExit = ir.exitCode;
      expect(
        ir.ok,
        `installer --from-local failed (exit=${ir.exitCode}):\nstdout:\n${ir.stdout}\nstderr:\n${ir.stderr}`,
      ).toBe(true);

      const snap = snapshotInstallState();
      expect(
        isFullyInstalled(snap),
        `post-install snapshot incomplete:\n${describeInstall(snap)}`,
      ).toBe(true);

      // Step 4: wait for the side panel to reach Connected WITHOUT touching
      //         the page. SW's alarm reconciles every 30s and the page's
      //         own verify_connection-on-mount has already fired. Generous
      //         timeout (3 min) allows for two alarm cycles plus bridge spawn.
      const deadline = Date.now() + 3 * 60_000;
      const recordedHeaders: string[] = [];
      while (Date.now() < deadline) {
        const title = (await titleLoc.textContent())?.trim() ?? '';
        if (recordedHeaders[recordedHeaders.length - 1] !== title) {
          recordedHeaders.push(`${new Date().toISOString()} ${title}`);
        }
        if (title === 'Connected') {
          recoveredAtMs = Date.now();
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(
        recoveredAtMs,
        `side panel never reached Connected after install. Header history:\n${recordedHeaders.join('\n')}`,
      ).not.toBeNull();
    } finally {
      // eslint-disable-next-line no-console
      console.log(
        `Test E summary: firstHeaderTitle="${firstHeaderTitle}" ` +
          `installerExit=${installerExit} recoveredAtMs=${recoveredAtMs}`,
      );
      await closeChrome(launched.context);
    }
  });
});
