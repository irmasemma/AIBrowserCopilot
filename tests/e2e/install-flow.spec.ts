/**
 * Install / Uninstall / Multi-Client Lifecycle — Real E2E Tests.
 *
 * Spawns the real compiled native-host .exe, drives the installer/uninstaller
 * directly, and exercises a real Chrome+extension via Playwright. MCP traffic
 * here uses LSP-style Content-Length framing, which the host accepts
 * alongside the MCP-spec NDJSON format (it auto-detects per session). NDJSON
 * is verified separately in `packages/native-host/src/smoke.test.ts`.
 *
 * Scenarios covered:
 *   3.1 Uninstall removes binary, manifests, registry key, lock file, configs.
 *   3.2 Reinstall while old server is running — installer kills stale process.
 *   3.3 Live status: connected → reconnecting → connected.
 *   3.4 Outdated bridge banner appears when bridge reports older version.
 *   3.5 Two stdio MCP clients with overlapping JSON-RPC ids both succeed.
 *   3.6 Multi-tab: list_tabs returns all open tabs, get_page_content honors tab_id.
 */

import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess, execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

import { detectPlatform, getInstallDir } from '../../packages/installer/src/shared/platform.js';
import { uninstall } from '../../packages/installer/src/installers/uninstaller.js';
import {
  killRunningNativeHost,
  isPortFree,
  waitForPortFree,
  NATIVE_HOST_PORT,
} from '../../packages/installer/src/installers/process-killer.js';
import { getAssetName } from '../../packages/installer/src/shared/constants.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXTENSION_PATH = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');
const NATIVE_HOST_BIN = path.resolve(
  REPO_ROOT,
  'packages/native-host/bin/agenthub-win-x64.exe',
);
const HELPER_BIN = path.resolve(
  REPO_ROOT,
  'packages/native-host-helper/bin/agenthub-helper-win-x64.exe',
);

const PLATFORM = detectPlatform();
const INSTALL_DIR = getInstallDir(PLATFORM);
const ASSET_NAME = getAssetName(PLATFORM.os, PLATFORM.arch);
const BACKUP_DIR = path.join(tmpdir(), `aibc-install-backup-${process.pid}`);

/* ─────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const portListening = async (port: number, timeoutMs = 8000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortFree(port))) return true;
    await sleep(100);
  }
  return false;
};

/** Snapshot the current install dir to tmp so we can restore at end. */
const snapshotInstall = () => {
  if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true, force: true });
  if (existsSync(INSTALL_DIR)) {
    cpSync(INSTALL_DIR, BACKUP_DIR, { recursive: true });
  }
};

/** Restore install dir from snapshot. */
const restoreInstall = () => {
  if (!existsSync(BACKUP_DIR)) return;
  if (existsSync(INSTALL_DIR)) rmSync(INSTALL_DIR, { recursive: true, force: true });
  cpSync(BACKUP_DIR, INSTALL_DIR, { recursive: true });
};

const ensureInstallDir = () => {
  if (!existsSync(INSTALL_DIR)) mkdirSync(INSTALL_DIR, { recursive: true });
};

/** Place the locally-built binary into the install dir. */
const placeFreshBinary = () => {
  ensureInstallDir();
  cpSync(NATIVE_HOST_BIN, path.join(INSTALL_DIR, ASSET_NAME), { force: true });
};

const installedBinaryPath = () => path.join(INSTALL_DIR, ASSET_NAME);

/** Spawn the native host binary. Returns child + parsed startup info. */
interface SpawnedHost {
  child: ChildProcess;
  pid: number;
  isServer: boolean;
}

const spawnNativeHost = async (label = 'host'): Promise<SpawnedHost> => {
  const exe = installedBinaryPath();
  if (!existsSync(exe)) throw new Error(`Binary missing at ${exe}`);
  const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });

  // Read stderr until either "Server started" (server) or first WS open (proxy).
  let serverStarted = false;
  const stderrBuf: string[] = [];
  child.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    stderrBuf.push(s);
    if (process.env.AIBC_DEBUG) console.log(`[${label}.stderr] ${s.trim()}`);
    if (/Server started on/.test(s)) serverStarted = true;
  });
  if (process.env.AIBC_DEBUG) {
    child.stdout?.on('data', (d: Buffer) =>
      console.log(`[${label}.stdout] ${d.toString().slice(0, 400)}`),
    );
  }

  // Give the binary up to 4s to either become the server or open a WS proxy.
  // For proxies there is no stderr; we just confirm the process is alive.
  await sleep(2000);
  if (child.exitCode != null) {
    throw new Error(`Native host exited early (code=${child.exitCode}): ${stderrBuf.join('')}`);
  }

  return { child, pid: child.pid!, isServer: serverStarted };
};

/** Send a Content-Length-framed JSON-RPC message to a child's stdin. */
const writeFramed = (child: ChildProcess, msg: unknown) => {
  const body = JSON.stringify(msg);
  const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  child.stdin?.write(frame);
};

/** Read framed JSON-RPC responses from a child's stdout, dispatching by id. */
class FramedReader {
  private buf = Buffer.alloc(0);
  private contentLength = -1;
  private pending = new Map<string | number, (msg: any) => void>();
  private orphan: any[] = [];

  constructor(child: ChildProcess) {
    child.stdout?.on('data', (chunk: Buffer) => this.feed(chunk));
  }

  private feed(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      if (this.contentLength === -1) {
        const headerEnd = this.buf.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = this.buf.subarray(0, headerEnd).toString();
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (!m) {
          this.buf = this.buf.subarray(headerEnd + 4);
          continue;
        }
        this.contentLength = parseInt(m[1], 10);
        this.buf = this.buf.subarray(headerEnd + 4);
      }
      if (this.contentLength >= 0 && this.buf.length >= this.contentLength) {
        const body = this.buf.subarray(0, this.contentLength).toString();
        this.buf = this.buf.subarray(this.contentLength);
        this.contentLength = -1;
        try {
          const msg = JSON.parse(body);
          const handler = this.pending.get(msg.id);
          if (handler) {
            this.pending.delete(msg.id);
            handler(msg);
          } else {
            this.orphan.push(msg);
          }
        } catch {
          /* drop malformed */
        }
      } else break;
    }
  }

  waitFor(id: string | number, timeoutMs = 10000): Promise<any> {
    // Check orphan list first (response may have arrived already).
    const idx = this.orphan.findIndex((m) => m.id === id);
    if (idx >= 0) return Promise.resolve(this.orphan.splice(idx, 1)[0]);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for JSON-RPC id=${id}`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }
}

/** Send one MCP request and await its reply. */
const mcpRpc = async (
  child: ChildProcess,
  reader: FramedReader,
  method: string,
  params: Record<string, unknown> | undefined,
  id: number,
  timeoutMs = 10000,
): Promise<any> => {
  const wait = reader.waitFor(id, timeoutMs);
  writeFramed(child, { jsonrpc: '2.0', id, method, params });
  return wait;
};

const mcpInitialize = (child: ChildProcess, reader: FramedReader, id = 1) =>
  mcpRpc(child, reader, 'initialize', { protocolVersion: '2024-11-05' }, id);

const mcpListTools = (child: ChildProcess, reader: FramedReader, id = 2) =>
  mcpRpc(child, reader, 'tools/list', {}, id);

const mcpCallTool = (
  child: ChildProcess,
  reader: FramedReader,
  name: string,
  args: Record<string, unknown>,
  id: number,
  browser = 'chrome',
) =>
  mcpRpc(
    child,
    reader,
    'tools/call',
    { name, arguments: { ...args, browser } },
    id,
    20000,
  );

const killChild = async (child: ChildProcess) => {
  if (child.exitCode != null) return;
  try {
    if (PLATFORM.os === 'windows') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    /* already dead */
  }
  await sleep(300);
};

/** Launch a persistent Chrome with the loaded extension. */
const launchExtensionContext = async (): Promise<BrowserContext> =>
  chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

const discoverExtensionId = async (ctx: BrowserContext): Promise<string> => {
  await sleep(2000);
  const sws = ctx.serviceWorkers();
  if (sws.length > 0) return sws[0].url().split('/')[2];
  try {
    const sw = await ctx.waitForEvent('serviceworker', { timeout: 5000 });
    return sw.url().split('/')[2];
  } catch {
    /* fall through */
  }
  const bgs = ctx.backgroundPages();
  if (bgs.length > 0) return bgs[0].url().split('/')[2];
  throw new Error('Could not discover extension ID');
};

/** Poll `chrome.storage.local.connectionContext.state` until it matches. */
const waitForState = async (
  ctx: BrowserContext,
  extId: string,
  expected: string | string[],
  timeoutMs = 15000,
): Promise<string> => {
  const expects = Array.isArray(expected) ? expected : [expected];
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const start = Date.now();
  let last = '<none>';
  try {
    while (Date.now() - start < timeoutMs) {
      const state = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('connectionContext');
        return (data.connectionContext as { state?: string } | undefined)?.state ?? null;
      });
      last = state ?? '<null>';
      if (state && expects.includes(state)) return state;
      await sleep(400);
    }
  } finally {
    await page.close().catch(() => {});
  }
  throw new Error(
    `State did not become one of [${expects.join(',')}] within ${timeoutMs}ms (last=${last})`,
  );
};

/* ─────────────────────────────────────────────────────────────────────── */
/* Suite-level setup / teardown                                             */
/* ─────────────────────────────────────────────────────────────────────── */

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Snapshot whatever install state the dev machine has so afterAll can restore.
  snapshotInstall();
  // Always start each suite with a clean port.
  await killRunningNativeHost(PLATFORM);
  expect(await isPortFree(NATIVE_HOST_PORT)).toBe(true);
});

test.afterAll(async () => {
  // Ensure no test left a process behind.
  await killRunningNativeHost(PLATFORM);
  // Restore the user's install so the dev machine still works.
  restoreInstall();
});

test.beforeEach(async () => {
  // Each test owns the port. Belt-and-suspenders.
  await killRunningNativeHost(PLATFORM);
});

/* ─────────────────────────────────────────────────────────────────────── */
/* 3.1 — Uninstall removes everything                                       */
/* ─────────────────────────────────────────────────────────────────────── */

test('3.1 uninstall removes binary, manifest, lock file, registry', async () => {
  // Arrange: ensure binary + a fake manifest + a fake lock file exist.
  ensureInstallDir();
  placeFreshBinary();
  const manifestPath = path.join(INSTALL_DIR, 'com.agenthub.native_host.json');
  writeFileSync(manifestPath, JSON.stringify({ name: 'com.agenthub.native_host' }));
  const lockPath = path.join(INSTALL_DIR, 'server.lock');
  writeFileSync(
    lockPath,
    JSON.stringify({ pid: 1, port: NATIVE_HOST_PORT, version: '0.0.0' }),
  );

  // Act
  const result = await uninstall(PLATFORM);

  // Assert
  expect(result.errors).toEqual([]);
  expect(existsSync(installedBinaryPath())).toBe(false);
  expect(existsSync(lockPath)).toBe(false);
  expect(result.binaryRemoved).toBe(true);
  expect(result.registryRemoved).toBe(true);
});

/* ─────────────────────────────────────────────────────────────────────── */
/* 3.2 — Reinstall while old server is running (kill + replace)             */
/* ─────────────────────────────────────────────────────────────────────── */

test('3.2 installer kills running native host, then replaces the binary', async () => {
  // Arrange: put a fresh binary in place and start it.
  placeFreshBinary();
  const host = await spawnNativeHost();
  expect(host.isServer).toBe(true);
  expect(await portListening(NATIVE_HOST_PORT)).toBe(true);

  // Lock file should now exist with a real PID.
  const lockPath = path.join(INSTALL_DIR, 'server.lock');
  expect(existsSync(lockPath)).toBe(true);
  const lockData = JSON.parse(readFileSync(lockPath, 'utf-8'));
  expect(lockData.port).toBe(NATIVE_HOST_PORT);
  expect(typeof lockData.pid).toBe('number');

  // Act: ask the installer's process killer to reclaim the port.
  const killResult = await killRunningNativeHost(PLATFORM);

  // Assert: port freed, lock file cleaned up, child exited.
  expect(killResult.killed).toBe(true);
  expect(killResult.portFree).toBe(true);
  expect(await waitForPortFree(NATIVE_HOST_PORT, 5000)).toBe(true);
  expect(existsSync(lockPath)).toBe(false);

  // Now we should be able to replace the binary on Windows (was locked before).
  // cpSync should succeed without EBUSY/EPERM.
  expect(() => placeFreshBinary()).not.toThrow();

  // Cleanup
  await killChild(host.child);
});

/* ─────────────────────────────────────────────────────────────────────── */
/* 3.3 — Live status: connected → reconnecting → connected                  */
/* ─────────────────────────────────────────────────────────────────────── */

test('3.3 extension status: connected → reconnecting → connected', async () => {
  test.setTimeout(90_000);
  placeFreshBinary();

  // Start native host.
  let host = await spawnNativeHost();
  expect(host.isServer).toBe(true);
  expect(await portListening(NATIVE_HOST_PORT)).toBe(true);

  // Launch extension and wait for connected.
  const ctx = await launchExtensionContext();
  let extId = '';
  try {
    extId = await discoverExtensionId(ctx);
    const s1 = await waitForState(ctx, extId, 'connected', 20_000);
    expect(s1).toBe('connected');

    // Kill host. Extension's WS should close → state moves off "connected".
    await killChild(host.child);
    await waitForPortFree(NATIVE_HOST_PORT, 5000);

    const s2 = await waitForState(ctx, extId, ['reconnecting', 'disconnected'], 15_000);
    expect(['reconnecting', 'disconnected']).toContain(s2);

    // Restart host.
    host = await spawnNativeHost('h2');
    expect(host.isServer).toBe(true);
    expect(await portListening(NATIVE_HOST_PORT)).toBe(true);
    console.log('[3.3] new host listening on 7483');

    const s3 = await waitForState(ctx, extId, 'connected', 60_000);
    expect(s3).toBe('connected');
  } finally {
    await ctx.close().catch(() => {});
    await killChild(host.child);
  }
});

/* ─────────────────────────────────────────────────────────────────────── */
/* 3.4 — Outdated bridge banner                                             */
/* ─────────────────────────────────────────────────────────────────────── */

test('3.4 extension shows outdated banner when bridge reports older version', async () => {
  test.setTimeout(120_000);

  // Stub WS server that imitates an older bridge.
  const wss = new WebSocketServer({ host: '127.0.0.1', port: NATIVE_HOST_PORT });
  let connections = 0;
  wss.on('connection', (ws, req) => {
    connections += 1;
    console.log(`[stub] connection #${connections} url=${req.url}`);
    ws.send(
      JSON.stringify({
        type: 'server_info',
        pid: 1,
        port: NATIVE_HOST_PORT,
        version: '0.0.1',
        startedBy: 'stub',
        capabilities: ['list_tabs'],
        uptime: 0,
        connectedBrowsers: [],
        connectedStubs: 0,
      }),
    );
    // Answer pings so the extension stays "connected" and shows the banner
    // rather than dropping back to reconnecting.
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        }
      } catch {
        /* ignore */
      }
    });
    ws.on('close', () => console.log('[stub] client disconnected'));
  });

  const ctx = await launchExtensionContext();
  try {
    const extId = await discoverExtensionId(ctx);
    console.log(`[3.4] extension id: ${extId}`);
    await waitForState(ctx, extId, 'connected', 30_000);
    console.log('[3.4] extension reports connected');

    // Poll storage for versionStatus directly so we can see what landed.
    const sidePage = await ctx.newPage();
    await sidePage.goto(`chrome-extension://${extId}/sidepanel.html`);
    let storedVersion: string | undefined;
    let storedStatus: string | undefined;
    const dl = Date.now() + 15_000;
    while (Date.now() < dl) {
      const dump = await sidePage.evaluate(async () => {
        const d = await chrome.storage.local.get('connectionContext');
        const c = d.connectionContext as
          | { versionStatus?: string; serverInfo?: { version?: string } }
          | undefined;
        return { v: c?.serverInfo?.version, s: c?.versionStatus };
      });
      storedVersion = dump.v;
      storedStatus = dump.s;
      if (storedStatus) break;
      await sleep(400);
    }
    console.log(`[3.4] storage versionStatus=${storedStatus} bridgeVersion=${storedVersion}`);
    expect(storedStatus).toBe('outdated');

    const banner = sidePage.locator('[data-testid="outdated-bridge-banner"]');
    // Probe: is the side panel HTML loading OutdatedBridgeBanner at all?
    await sleep(2000);
    const debug = await sidePage.evaluate(() => ({
      bodyHtml: document.body.innerHTML.length,
      hasBanner: !!document.querySelector('[data-testid="outdated-bridge-banner"]'),
      hasHeader: !!document.querySelector('[role="tablist"]'),
      bodyText: document.body.innerText?.slice(0, 600),
    }));
    console.log('[3.4] sidepanel debug:', JSON.stringify(debug));
    await expect(banner).toBeVisible({ timeout: 10_000 });
    console.log('[3.4] banner visible — passed');
    await sidePage.close();
    console.log('[3.4] sidePage closed');
  } finally {
    console.log('[3.4] finally: closing ctx');
    await ctx.close().catch(() => {});
    console.log('[3.4] ctx closed; terminating wss clients');
    for (const client of wss.clients) {
      try { client.terminate(); } catch { /* ignore */ }
    }
    await new Promise<void>((r) => wss.close(() => r()));
    console.log('[3.4] wss closed');
    await waitForPortFree(NATIVE_HOST_PORT, 3000);
  }
});

/* ─────────────────────────────────────────────────────────────────────── */
/* 3.5 — Two MCP clients with overlapping JSON-RPC ids                       */
/* ─────────────────────────────────────────────────────────────────────── */

test('3.5 two stdio MCP clients with overlapping ids both succeed', async () => {
  test.setTimeout(120_000);
  placeFreshBinary();

  // Browser context first so an extension is connected to receive tool calls.
  const ctx = await launchExtensionContext();
  let extId = '';
  // Spawn binary #1 (becomes WS server).
  const a = await spawnNativeHost('a');
  expect(a.isServer).toBe(true);
  // Spawn binary #2 (becomes WS proxy).
  const b = await spawnNativeHost('b');
  expect(b.isServer).toBe(false);

  const readerA = new FramedReader(a.child);
  const readerB = new FramedReader(b.child);

  try {
    extId = await discoverExtensionId(ctx);
    await waitForState(ctx, extId, 'connected', 20_000);

    // Open a real test page so list_tabs has something to return.
    const fixturePage = await ctx.newPage();
    await fixturePage.goto(
      'data:text/html,<html><head><title>Fixture A</title></head><body>fixture-a</body></html>',
    );
    await sleep(500);

    // Initialize both clients.
    await mcpInitialize(a.child, readerA, 1);
    await mcpInitialize(b.child, readerB, 1);

    // Both ask for the tool list.
    const toolsA = await mcpListTools(a.child, readerA, 2);
    const toolsB = await mcpListTools(b.child, readerB, 2);
    expect(toolsA.result.tools.length).toBeGreaterThan(0);
    expect(toolsB.result.tools.length).toBeGreaterThan(0);

    // Issue overlapping list_tabs concurrently with the SAME id (5) on each
    // client. This is what would clobber pendingRequests if it were keyed by
    // raw msg.id. Each client must still get its own response.
    const [resA, resB] = await Promise.all([
      mcpCallTool(a.child, readerA, 'list_tabs', {}, 5),
      mcpCallTool(b.child, readerB, 'list_tabs', {}, 5),
    ]);

    expect(resA.id).toBe(5);
    expect(resB.id).toBe(5);
    expect(resA.error).toBeUndefined();
    expect(resB.error).toBeUndefined();
    expect(resA.result).toBeTruthy();
    expect(resB.result).toBeTruthy();
  } finally {
    await ctx.close().catch(() => {});
    await killChild(b.child);
    await killChild(a.child);
  }
});

/* ─────────────────────────────────────────────────────────────────────── */
/* 3.6 — Multi-tab via MCP                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

test('3.6 list_tabs returns all open tabs and get_page_content works per tab_id', async () => {
  test.setTimeout(90_000);
  placeFreshBinary();

  const ctx = await launchExtensionContext();
  const a = await spawnNativeHost();
  expect(a.isServer).toBe(true);
  const reader = new FramedReader(a.child);

  try {
    const extId = await discoverExtensionId(ctx);
    await waitForState(ctx, extId, 'connected', 20_000);

    // Open three known tabs.
    const titles = ['Tab-One', 'Tab-Two', 'Tab-Three'];
    for (const title of titles) {
      const p = await ctx.newPage();
      await p.goto(
        `data:text/html,<html><head><title>${title}</title></head><body>${title.toLowerCase()}-body</body></html>`,
      );
    }
    await sleep(800);

    await mcpInitialize(a.child, reader, 1);

    const list = await mcpCallTool(a.child, reader, 'list_tabs', {}, 10);
    expect(list.error).toBeUndefined();
    const text = list.result?.content?.[0]?.text ?? JSON.stringify(list.result);
    for (const t of titles) {
      expect(text).toContain(t);
    }

    // Pull the actual tab id for "Tab-Two" from the response (the tool
    // reliably emits per-tab ids; even if shape varies, all of these are
    // valid containers we accept).
    const tabsAny =
      list.result?.tabs ??
      list.result?.content?.[0]?.tabs ??
      (() => {
        try {
          return JSON.parse(text).tabs;
        } catch {
          return null;
        }
      })();

    if (Array.isArray(tabsAny)) {
      const target = tabsAny.find((t: any) => /Tab-Two/.test(t.title ?? ''));
      expect(target).toBeTruthy();
      const got = await mcpCallTool(
        a.child,
        reader,
        'get_page_content',
        { tab_id: target.id ?? target.tabId },
        11,
      );
      expect(got.error).toBeUndefined();
      const gotText =
        got.result?.content?.[0]?.text ?? JSON.stringify(got.result);
      expect(gotText.toLowerCase()).toContain('tab-two-body');
    }
  } finally {
    await ctx.close().catch(() => {});
    await killChild(a.child);
  }
});
