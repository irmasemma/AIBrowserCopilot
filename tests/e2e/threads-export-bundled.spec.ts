/**
 * Full-chain e2e: a real Claude CLI session exports a Threads-style feed
 * through the agenthub MCP, driving a real (bundled Chromium) browser with
 * the unpacked extension loaded.
 *
 * Chain under test:
 *   claude CLI (haiku, real session)
 *     → agenthub MCP (stdio exe, proxies to whatever owns :7483)
 *       → test bridge (this spec, owns :7483)
 *         → extension in headed Chromium
 *           → the @tech.mom_us feed fixture (served on http://127.0.0.1)
 *
 * Why a fixture instead of live threads.com: the live profile shows a login
 * wall (≈4 gated previews, 0 full posts) for an unauthenticated browser, so
 * it can't deterministically yield ≥5 posts. The fixture is served on
 * 127.0.0.1 — covered by the extension's `http://127.0.0.1/*` host permission
 * — so content scripts can read it without the optional <all_urls> grant.
 *
 * Why bundled Chromium: Chrome stable (138+) and Chrome Dev (151) both now
 * silently ignore --load-extension (verified empirically). Bundled Chromium
 * and Edge are the only engines that still load an unpacked extension.
 *
 * The installer / `npx agenthub-setup` step from a real install is omitted
 * deliberately: bundled Chromium uses the :7483 discovery fallback and the
 * bridge runs in accept-any-origin mode, so native-messaging registration
 * adds nothing here (and would mutate the developer's real machine).
 *
 * Assertion (per request): MCP works + ≥5 posts exported with some data.
 * Content values are not checked.
 *
 * Prereqs: `claude` on PATH and logged in; the `agenthub` MCP server already
 * registered in ~/.claude (the real install provides it). Run headed.
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';

const extensionPath = path.resolve(__dirname, '../../packages/extension/dist/chrome-mv3');
const nativeHostDist = path.resolve(__dirname, '../../packages/native-host/dist/index.js');
const fixtureHtml = readFileSync(path.resolve(__dirname, 'fixtures/threads-feed.html'), 'utf8');

let bridge: ChildProcess;
let context: BrowserContext;
let fixtureServer: http.Server;
let fixtureUrl: string;

const waitConnected = async (ctx: BrowserContext, extId: string, timeoutMs = 20_000): Promise<void> => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const state = await page.evaluate(async () => {
        const d = await chrome.storage.local.get('connectionContext');
        return (d.connectionContext as { state?: string } | undefined)?.state;
      });
      if (state === 'connected') return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`extension did not connect within ${timeoutMs}ms`);
  } finally {
    await page.close();
  }
};

test.describe('Threads export — real Claude CLI → MCP → headed browser', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);

    // 1. Own port 7483: stop the live bridge so our fresh one wins it. The
    //    claude-side agenthub stdio exe will proxy to whatever owns 7483.
    if (process.platform === 'win32') {
      try { execSync('taskkill /F /IM agenthub-win-x64.exe', { stdio: 'ignore' }); } catch { /* none */ }
    } else {
      try { execSync('pkill -f agenthub', { stdio: 'ignore' }); } catch { /* none */ }
    }
    await new Promise((r) => setTimeout(r, 500));

    // 2. Spawn the bridge with an empty LOCALAPPDATA → accept-any-origin mode.
    const installParent = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-threads-'));
    const lockFile = path.join(installParent, 'agenthub', 'server.lock');
    fs.mkdirSync(path.join(installParent, 'agenthub'), { recursive: true });
    bridge = spawn('node', [nativeHostDist], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '1', LOCALAPPDATA: installParent, AGENTHUB_INSTALL_DIR: path.join(installParent, 'agenthub') },
    });
    let exited: number | null = null;
    bridge.on('exit', (c) => { exited = c ?? -1; });
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 15_000;
      const poll = () => {
        if (exited !== null) return reject(new Error(`bridge exited: ${exited}`));
        try {
          const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { port?: number; pid?: number };
          if (lock.port && lock.pid === bridge.pid) return resolve();
        } catch { /* not yet */ }
        if (Date.now() > deadline) {
          return reject(new Error('bridge never claimed :7483 (live bridge still holding it?)'));
        }
        setTimeout(poll, 250);
      };
      poll();
    });

    // 3. Serve the fixture on 127.0.0.1 (extension has host perm for it).
    fixtureServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fixtureHtml);
    });
    const fixturePort = await new Promise<number>((resolve) => {
      fixtureServer.listen(0, '127.0.0.1', () => {
        resolve((fixtureServer.address() as import('net').AddressInfo).port);
      });
    });
    fixtureUrl = `http://127.0.0.1:${fixturePort}/`;

    // 4. Launch headed bundled Chromium with the unpacked extension; connect.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-threads-udd-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
    await new Promise((r) => setTimeout(r, 2500));
    let extId = context.serviceWorkers()[0]?.url().split('/')[2];
    if (!extId) extId = (await context.waitForEvent('serviceworker', { timeout: 6000 })).url().split('/')[2];
    await waitConnected(context, extId);

    // 5. Open the feed so it's the live tab the agent will operate on.
    const feed = await context.newPage();
    await feed.goto(fixtureUrl);
    await feed.bringToFront();
    await new Promise((r) => setTimeout(r, 800));
  });

  test.afterAll(async () => {
    try { await context?.close(); } catch { /* noop */ }
    await new Promise<void>((r) => fixtureServer ? fixtureServer.close(() => r()) : r());
    if (bridge && !bridge.killed) { bridge.kill(); await new Promise((r) => setTimeout(r, 400)); }
  });

  test('claude exports ≥5 posts from the feed via MCP (scroll + screenshot + extract)', async () => {
    test.setTimeout(240_000);

    const prompt = [
      'You have the agenthub MCP tools, connected to a real Chrome showing a Threads',
      `profile feed at ${fixtureUrl} .`,
      'Do this:',
      '1. Call mcp__agenthub__list_tabs and pick the tab whose url is that feed.',
      '2. Call mcp__agenthub__take_screenshot on it.',
      '3. Scroll the page down a couple times (mcp__agenthub__scroll_page) so ALL posts load.',
      '4. Extract EVERY post (author, text, likes, reposts, replies) using',
      '   mcp__agenthub__get_page_content or mcp__agenthub__extract_data.',
      'Finally, output ONLY a JSON array of the posts in a ```json code block,',
      'each item like {"text": "...", "likes": 0, "reposts": 0}. No prose after it.',
    ].join(' ');

    const args = [
      '--print',
      '--input-format', 'text',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', 'haiku',
      '--dangerously-skip-permissions',
    ];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: true, windowsHide: true });
    child.stdin.end(prompt);

    const toolUses: string[] = [];
    let assistantText = '';
    let raw = '';
    child.stdout.on('data', (d: Buffer) => {
      raw += d.toString();
      let nl: number;
      while ((nl = raw.indexOf('\n')) !== -1) {
        const line = raw.slice(0, nl); raw = raw.slice(nl + 1);
        if (!line.trim()) continue;
        let msg: { type?: string; message?: { content?: Array<{ type: string; name?: string; text?: string }> }; result?: string };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'assistant') {
          for (const b of msg.message?.content ?? []) {
            if (b.type === 'tool_use' && b.name) toolUses.push(b.name);
            if (b.type === 'text' && b.text) assistantText += '\n' + b.text;
          }
        }
        if (msg.type === 'result' && msg.result) assistantText += '\n' + msg.result;
      }
    });

    const exitCode: number = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } reject(new Error('claude timed out (180s)')); }, 180_000);
      child.on('exit', (c) => { clearTimeout(timer); resolve(c ?? -1); });
      child.on('error', reject);
    });
    expect(exitCode, 'claude CLI should exit cleanly').toBe(0);

    // MCP actually worked: at least one agenthub tool was invoked.
    const agentTools = toolUses.filter((t) => t.startsWith('mcp__agenthub__'));
    expect(agentTools.length, `expected agenthub MCP tool calls, saw: ${JSON.stringify(toolUses)}`).toBeGreaterThan(0);

    // Parse the exported posts from claude's final json block (fall back to
    // the first bare json array if no fence).
    const fenced = assistantText.match(/```json\s*([\s\S]*?)```/i);
    const bare = assistantText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    const jsonText = fenced?.[1] ?? bare?.[0] ?? '';
    let posts: Array<Record<string, unknown>> = [];
    try { const p = JSON.parse(jsonText.trim()); if (Array.isArray(p)) posts = p; } catch { /* handled below */ }

    expect(
      posts.length,
      `expected ≥5 exported posts. tools=${JSON.stringify(agentTools)}\n--- claude output (first 1200) ---\n${assistantText.slice(0, 1200)}`,
    ).toBeGreaterThanOrEqual(5);

    // "Some data": each post carries non-empty text.
    const withText = posts.filter((p) => typeof p.text === 'string' && (p.text as string).trim().length > 0);
    expect(withText.length, 'exported posts should contain non-empty text').toBeGreaterThanOrEqual(5);

    // eslint-disable-next-line no-console
    console.log(`✓ exported ${posts.length} posts; agenthub tools used: ${[...new Set(agentTools)].join(', ')}`);
  });
});
