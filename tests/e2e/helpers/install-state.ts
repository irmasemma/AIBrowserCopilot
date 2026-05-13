/**
 * Probes for AI Browser CoPilot install state on Windows.
 *
 * The product layout is described in CLAUDE.md and packages/installer/src/installers/uninstaller.ts.
 * Helpers here are READ-ONLY snapshots — uninstall + install are driven by the
 * real CLI in `installer-cli.ts`. Tests assert presence/absence between phases
 * by calling these.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const INSTALL_DIR = join(
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local'),
  'ai-browser-copilot',
);

export const BRIDGE_BIN = 'ai-browser-copilot-win-x64.exe';
export const HELPER_BIN = 'ai-browser-copilot-helper-win-x64.exe';
export const NATIVE_HOST_MANIFEST = 'com.copilot.native_host.json';
export const HELPER_MANIFEST = 'com.copilot.native_host_helper.json';
export const LOCK_FILE = 'server.lock';

const HKCU_NM_BASE = 'HKCU\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts';
const HKCU_RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'AIBrowserCopilot';

export interface InstallSnapshot {
  bridgeBinary: { exists: boolean; path: string; mtimeMs?: number };
  helperBinary: { exists: boolean; path: string; mtimeMs?: number };
  nativeHostManifest: { exists: boolean; path: string };
  helperManifest: { exists: boolean; path: string };
  lockFile: { exists: boolean; path: string; pid?: number; port?: number; token?: string };
  registry: {
    nativeHost: boolean;
    helper: boolean;
    autostart: boolean;
    autostartCommand?: string;
  };
  runningBridgePids: number[];
}

const queryRegValue = (path: string, value?: string): string | null => {
  try {
    const args = value ? ['query', path, '/v', value] : ['query', path, '/ve'];
    const out = spawnSync('reg.exe', args, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (out.status !== 0) return null;
    return out.stdout;
  } catch {
    return null;
  }
};

const regHasValue = (path: string, value?: string): boolean => queryRegValue(path, value) !== null;

const findPidsByImage = (image: string): number[] => {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${image}" /FO CSV /NH`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids: number[] = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"[^"]+","(\d+)"/);
      if (m) {
        const pid = parseInt(m[1], 10);
        if (Number.isFinite(pid)) pids.push(pid);
      }
    }
    return pids;
  } catch {
    return [];
  }
};

const readLockFile = (path: string): { pid?: number; port?: number; token?: string } | null => {
  try {
    if (!existsSync(path)) return null;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      pid: typeof data.pid === 'number' ? data.pid : undefined,
      port: typeof data.port === 'number' ? data.port : undefined,
      token: typeof data.token === 'string' ? data.token : undefined,
    };
  } catch {
    return null;
  }
};

const safeStatMs = (path: string): number | undefined => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
};

export const snapshotInstallState = (): InstallSnapshot => {
  const bridgePath = join(INSTALL_DIR, BRIDGE_BIN);
  const helperPath = join(INSTALL_DIR, HELPER_BIN);
  const manifestPath = join(INSTALL_DIR, NATIVE_HOST_MANIFEST);
  const helperManifestPath = join(INSTALL_DIR, HELPER_MANIFEST);
  const lockPath = join(INSTALL_DIR, LOCK_FILE);
  const lockData = readLockFile(lockPath);
  const autostart = queryRegValue(HKCU_RUN, RUN_VALUE);

  return {
    bridgeBinary: { exists: existsSync(bridgePath), path: bridgePath, mtimeMs: safeStatMs(bridgePath) },
    helperBinary: { exists: existsSync(helperPath), path: helperPath, mtimeMs: safeStatMs(helperPath) },
    nativeHostManifest: { exists: existsSync(manifestPath), path: manifestPath },
    helperManifest: { exists: existsSync(helperManifestPath), path: helperManifestPath },
    lockFile: {
      exists: existsSync(lockPath),
      path: lockPath,
      pid: lockData?.pid,
      port: lockData?.port,
      token: lockData?.token,
    },
    registry: {
      nativeHost: regHasValue(`${HKCU_NM_BASE}\\com.copilot.native_host`),
      helper: regHasValue(`${HKCU_NM_BASE}\\com.copilot.native_host_helper`),
      autostart: autostart !== null,
      autostartCommand: autostart?.match(new RegExp(`${RUN_VALUE}\\s+REG_SZ\\s+(.+)`))?.[1]?.trim(),
    },
    runningBridgePids: [...findPidsByImage(BRIDGE_BIN), ...findPidsByImage(HELPER_BIN)],
  };
};

export const isFullyInstalled = (s: InstallSnapshot): boolean =>
  s.bridgeBinary.exists &&
  s.helperBinary.exists &&
  s.nativeHostManifest.exists &&
  s.helperManifest.exists &&
  s.registry.nativeHost &&
  s.registry.helper;

export const isFullyUninstalled = (s: InstallSnapshot): boolean =>
  !s.bridgeBinary.exists &&
  !s.helperBinary.exists &&
  !s.nativeHostManifest.exists &&
  !s.helperManifest.exists &&
  !s.lockFile.exists &&
  !s.registry.nativeHost &&
  !s.registry.helper &&
  !s.registry.autostart;

export const describeInstall = (s: InstallSnapshot): string => {
  const lines: string[] = [];
  lines.push(`Install dir: ${INSTALL_DIR}`);
  lines.push(`  bridge bin:        ${s.bridgeBinary.exists ? 'present' : 'MISSING'} (${s.bridgeBinary.path})`);
  lines.push(`  helper bin:        ${s.helperBinary.exists ? 'present' : 'MISSING'} (${s.helperBinary.path})`);
  lines.push(`  native_host manif: ${s.nativeHostManifest.exists ? 'present' : 'MISSING'}`);
  lines.push(`  helper manif:      ${s.helperManifest.exists ? 'present' : 'MISSING'}`);
  lines.push(`  lock file:         ${s.lockFile.exists ? `pid=${s.lockFile.pid} port=${s.lockFile.port}` : 'MISSING'}`);
  lines.push(`  registry NM host:  ${s.registry.nativeHost ? 'set' : 'MISSING'}`);
  lines.push(`  registry NM helper:${s.registry.helper ? 'set' : 'MISSING'}`);
  lines.push(`  autostart:         ${s.registry.autostart ? `set (${s.registry.autostartCommand})` : 'MISSING'}`);
  lines.push(`  running bridge pid:${s.runningBridgePids.join(',') || '(none)'}`);
  return lines.join('\n');
};
