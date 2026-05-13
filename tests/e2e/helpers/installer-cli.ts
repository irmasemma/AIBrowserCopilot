/**
 * Drive the LOCAL installer build (packages/installer/dist/index.js) for
 * install / uninstall flows. We never call the published `npx
 * ai-browser-copilot-setup` here — it's stale at 0.1.2 and we're verifying
 * the working tree.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const INSTALLER_CLI = path.join(REPO_ROOT, 'packages/installer/dist/index.js');

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
}

const runNode = (args: string[], timeoutMs = 120_000): RunResult => {
  const command = `node ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
  const r = spawnSync('node', args, {
    encoding: 'utf-8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return {
    ok: r.status === 0,
    exitCode: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    command,
  };
};

export const ensureInstallerBuilt = (): void => {
  if (!existsSync(INSTALLER_CLI)) {
    throw new Error(
      `Local installer not built at ${INSTALLER_CLI}.\n` +
        `Run: npm run build -w packages/installer`,
    );
  }
};

export const runInstall = (extensionId: string): RunResult => {
  ensureInstallerBuilt();
  return runNode([
    INSTALLER_CLI,
    '--from-local',
    REPO_ROOT,
    '--extension-id',
    extensionId,
    '--yes',
  ]);
};

export const runUninstall = (): RunResult => {
  ensureInstallerBuilt();
  return runNode([INSTALLER_CLI, '--uninstall', '--yes']);
};
