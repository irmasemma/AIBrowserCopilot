import React from 'react';
import { Box, Text, useApp } from 'ink';
import type { PlatformInfo } from '../shared/platform.js';
import type { DownloadProgress, InstallResult } from '../installers/binary-installer.js';
import type { RegistrationResult } from '../installers/host-registrar.js';
import type { HealthCheckResult } from '../installers/health-check.js';
import type { ToolDetectionSummary } from '../detectors/types.js';
import { downloadBinary, isBinaryInstalled } from '../installers/binary-installer.js';
import { registerHost } from '../installers/host-registrar.js';
import { registerAllBrowsers } from '../installers/browser-registrar.js';
import { detectExtensionIds } from '../installers/extension-id-detector.js';
import { writeAllowedExtensionIds, ALLOWED_IDS_FILENAME } from '../installers/allowed-ids-writer.js';
import { checkBinaryHealth } from '../installers/health-check.js';
import { getHelperAssetName } from '../shared/constants.js';
import { uninstall, type UninstallResult } from '../installers/uninstaller.js';
import { registerAutostart, unregisterAutostart } from '../installers/autostart-registrar.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getInstallDir } from '../shared/platform.js';
import { getAssetName } from '../shared/constants.js';
import { join } from 'node:path';
import { registerAllDetectors, runAll, clear } from '../detectors/index.js';
import { StepInstall, type InstallStatus } from './step-install.js';

const nativeExit = globalThis.process?.exit?.bind(globalThis.process);

const forceExit = () => {
  if (nativeExit && !process.env['VITEST']) {
    setTimeout(() => nativeExit(0), 200);
  }
};
import { StepRegister, type RegisterStatus } from './step-register.js';
import { StepDetect, type DetectStatus } from './step-detect.js';
import { StepDiscover, type DiscoverPhase, type ToolConfigStatus } from './step-discover.js';
import { StepUninstall, type UninstallStatus } from './step-uninstall.js';

export interface CliFlags {
  yes: boolean;
  tools?: string;
  update: boolean;
  uninstall: boolean;
  extensionId?: string;
  fromLocal?: string;
}

export interface AppProps {
  platform: PlatformInfo;
  flags: CliFlags;
  downloadFn?: typeof downloadBinary;
  registerFn?: typeof registerHost;
  checkHealthFn?: typeof checkBinaryHealth;
  checkInstalledFn?: typeof isBinaryInstalled;
  runDetectorsFn?: typeof runAll;
  uninstallFn?: typeof uninstall;
}

type AppPhase = 'uninstall' | 'detect' | 'prompt' | 'download' | 'register' | 'health' | 'discover' | 'configure-prompt' | 'configure' | 'done';

export const App: React.FC<AppProps> = ({
  platform,
  flags,
  downloadFn = downloadBinary,
  registerFn = registerHost,
  checkHealthFn = checkBinaryHealth,
  checkInstalledFn = isBinaryInstalled,
  runDetectorsFn = runAll,
  uninstallFn = uninstall,
}) => {
  const { exit } = useApp();
  const [phase, setPhase] = React.useState<AppPhase>(flags.uninstall ? 'uninstall' : 'detect');

  // Uninstall state
  const [uninstallStatus, setUninstallStatus] = React.useState<UninstallStatus | null>(null);
  const [uninstallResult, setUninstallResult] = React.useState<UninstallResult | undefined>();
  const [uninstallError, setUninstallError] = React.useState<string | undefined>();

  // Detection state
  const [detectStatus, setDetectStatus] = React.useState<DetectStatus>('checking');
  const [existingBinaryPath, setExistingBinaryPath] = React.useState<string | undefined>();

  // Download state
  const [installStatus, setInstallStatus] = React.useState<InstallStatus | null>(null);
  const [progress, setProgress] = React.useState<DownloadProgress | undefined>();
  const [binaryPath, setBinaryPath] = React.useState<string | undefined>();
  const [installError, setInstallError] = React.useState<string | undefined>();

  // Registration state
  const [registerStatus, setRegisterStatus] = React.useState<RegisterStatus | null>(null);
  const [manifestPath, setManifestPath] = React.useState<string | undefined>();
  const [registerError, setRegisterError] = React.useState<string | undefined>();

  // Health check state
  const [healthStatus, setHealthStatus] = React.useState<DetectStatus | null>(null);

  // Discovery state
  const [discoverPhase, setDiscoverPhase] = React.useState<DiscoverPhase | null>(null);
  const [detections, setDetections] = React.useState<ToolDetectionSummary[]>([]);
  const [configStatuses, setConfigStatuses] = React.useState<ToolConfigStatus[]>([]);

  React.useEffect(() => {
    if (!platform.isSupported) {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [platform.isSupported, exit]);

  // Uninstall phase
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'uninstall') return;

    let cancelled = false;
    const run = async () => {
      setUninstallStatus('removing');
      try {
        const result = await uninstallFn(platform);
        if (cancelled) return;
        setUninstallResult(result);
        setUninstallStatus('complete');
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setUninstallError(message);
        setUninstallStatus('error');
      }
      setPhase('done');
      setTimeout(() => { exit(); forceExit(); }, 100);
    };

    run();
    return () => { cancelled = true; };
  }, [platform, phase, uninstallFn, exit]);

  // Phase 1: Detection
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'detect') return;

    const installDir = getInstallDir(platform);
    const alreadyInstalled = checkInstalledFn(installDir, platform);

    if (alreadyInstalled) {
      setExistingBinaryPath(join(installDir, getAssetName(platform.os, platform.arch)));
      setDetectStatus('found');

      if (flags.yes || flags.update) {
        // Auto-update when --yes or --update flag is passed
        setPhase('download');
      } else {
        setPhase('prompt');
      }
    } else {
      setDetectStatus('not-found');
      setPhase('download');
    }
  }, [platform, phase, flags.yes, flags.update, checkInstalledFn]);

  // Handle user's update choice
  const handleUpdateChoice = React.useCallback((update: boolean) => {
    if (update) {
      setPhase('download');
    } else {
      // Skip download, proceed to registration with existing binary
      setPhase('register');
    }
  }, []);

  // Phase 2: Download
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'download') return;

    let cancelled = false;
    const run = async () => {
      try {
        setInstallStatus('downloading');
        const installDir = getInstallDir(platform);
        const dlResult: InstallResult = await downloadFn(
          platform,
          installDir,
          (p: DownloadProgress) => {
            if (!cancelled) setProgress(p);
          },
          undefined,
          flags.fromLocal,
        );

        if (cancelled) return;

        if (!dlResult.success) {
          setInstallError(dlResult.error);
          setInstallStatus('error');
          exit();
          return;
        }

        setBinaryPath(dlResult.binaryPath);
        setInstallStatus('complete');
        setPhase('register');
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setInstallError(`Installation failed: ${message}`);
        setInstallStatus('error');
        exit();
      }
    };

    run();
    return () => { cancelled = true; };
  }, [platform, phase, downloadFn, flags.fromLocal, exit]);

  // Phase 3: Register
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'register') return;

    let cancelled = false;
    const run = async () => {
      try {
        setRegisterStatus('registering');
        const binPath = binaryPath ?? existingBinaryPath ?? '';

        // Resolve the Chrome extension ID. Prefer the explicit --extension-id
        // flag; otherwise best-effort auto-detect from installed Chromium
        // profiles. We only auto-USE a detected ID under --yes when EXACTLY ONE
        // is found; otherwise we SUGGEST it and ask the user to confirm by
        // re-running with --extension-id — never silently register an
        // unconfirmed ID (an empty allowed_origins manifest is useless and a
        // wrong ID would make Chrome reject every connection).
        let effectiveExtId = flags.extensionId;
        if (!effectiveExtId) {
          let detected: string[] = [];
          try { detected = detectExtensionIds(platform); } catch { detected = []; }
          if (detected.length === 1 && flags.yes) {
            effectiveExtId = detected[0];
          } else {
            if (cancelled) return;
            const hint = detected.length === 1
              ? `Detected a likely extension ID: ${detected[0]}\n  Re-run to confirm:  npx agenthub-setup --extension-id ${detected[0]}`
              : detected.length > 1
                ? `Found multiple AgentHub extensions: ${detected.join(', ')}\n  Pick yours and re-run:  npx agenthub-setup --extension-id <id>`
                : `Open chrome://extensions (enable Developer mode), copy AgentHub's ID, then re-run:\n  npx agenthub-setup --extension-id <id>`;
            setRegisterError(`Chrome extension ID required — the binary is installed, but Chrome can't be authorized to talk to it without your extension's ID.\n${hint}`);
            setRegisterStatus('error');
            setPhase('health');
            return;
          }
        }

        const regResult: RegistrationResult = await registerFn(
          platform,
          binPath,
          effectiveExtId,
        );

        if (cancelled) return;

        // Also register helper for all detected browsers (best-effort — main host registration is the critical path)
        try {
          const helperBinPath = join(getInstallDir(platform), getHelperAssetName(platform.os, platform.arch));
          const extensionIds = effectiveExtId ? [effectiveExtId] : [];
          registerAllBrowsers(platform, binPath, helperBinPath, extensionIds);
        } catch {
          // Helper registration is best-effort — extension falls back to default port if helper unavailable
        }

        // Write the bridge's Origin allowlist config from the resolved
        // extension ID. The bridge reads this at startup; without it the WS
        // server accepts any chrome-extension:// origin (defense-in-depth
        // back-compat). With it, only the listed IDs can drive the bridge.
        // Best-effort: a failure here logs nothing but the bridge keeps
        // running in back-compat mode, so install does not fail.
        if (effectiveExtId) {
          try {
            writeAllowedExtensionIds(
              join(getInstallDir(platform), ALLOWED_IDS_FILENAME),
              [effectiveExtId],
            );
          } catch {
            // Fall through — bridge stays in back-compat mode.
          }
        }

        if (regResult.success) {
          setManifestPath(regResult.manifestPath);
          setRegisterStatus('complete');

          // Register Windows autostart so the bridge runs from login onward.
          // Failures are non-fatal (corp policy may block HKCU writes).
          try {
            registerAutostart(binPath, platform);
          } catch {
            // Best effort — fall back to on-demand spawn via the helper.
          }

          // Spawn the bridge immediately so the user doesn't have to log out/in
          // to get a running bridge. Detached so it survives the installer exit.
          if (binPath && existsSync(binPath)) {
            try {
              const child = spawn(binPath, ['--service'], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
              });
              child.unref();
            } catch {
              // Best effort — bridge will start at next login or on-demand.
            }
          }
        } else {
          setRegisterError(regResult.error);
          setRegisterStatus('error');
        }

        setPhase('health');
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setRegisterError(`Registration failed: ${message}`);
        setRegisterStatus('error');
        exit();
      }
    };

    run();
    return () => { cancelled = true; };
  }, [platform, phase, binaryPath, existingBinaryPath, flags.extensionId, registerFn, exit]);

  // Phase 4: Health check
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'health') return;

    const installDir = getInstallDir(platform);
    const result: HealthCheckResult = checkHealthFn(installDir, platform);

    if (result.healthy) {
      setHealthStatus('health-ok');
      setPhase('discover');
    } else {
      setHealthStatus('health-fail');
      setPhase('done');
      const timer = setTimeout(() => { exit(); forceExit(); }, 100);
      return () => clearTimeout(timer);
    }
  }, [platform, phase, checkHealthFn, exit]);

  // Phase 5: Discover AI tools
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'discover') return;

    let cancelled = false;
    const run = async () => {
      setDiscoverPhase('scanning');
      clear();
      registerAllDetectors();
      const results = await runDetectorsFn(platform);

      if (cancelled) return;
      setDetections(results);

      const installedTools = results.filter((r) => r.detection.installed);
      if (installedTools.length === 0) {
        setDiscoverPhase('none-found');
        setPhase('done');
        setTimeout(() => { exit(); forceExit(); }, 100);
        return;
      }

      if (flags.yes || flags.update) {
        setDiscoverPhase('configuring');
        setPhase('configure');
      } else {
        setDiscoverPhase('results');
        setPhase('configure-prompt');
      }
    };

    run();
    return () => { cancelled = true; };
  }, [platform, phase, flags.yes, flags.update, runDetectorsFn, exit]);

  // Handle configure choice
  const handleConfigureChoice = React.useCallback((configure: boolean) => {
    if (configure) {
      setDiscoverPhase('configuring');
      setPhase('configure');
    } else {
      setDiscoverPhase('done');
      setPhase('done');
      exit();
      forceExit();
    }
  }, [exit]);

  // Phase 6: Configure tools
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'configure') return;

    let cancelled = false;
    const run = async () => {
      const installedTools = detections.filter((d) => d.detection.installed);
      const binPath = binaryPath ?? existingBinaryPath ?? '';

      // Initialize config statuses
      const statuses: ToolConfigStatus[] = installedTools.map((d) => ({
        slug: d.detector.slug,
        name: d.detector.name,
        status: 'pending' as const,
      }));
      setConfigStatuses(statuses);

      // Configure each tool sequentially
      for (let i = 0; i < installedTools.length; i++) {
        if (cancelled) return;
        const tool = installedTools[i];

        // Update status to writing
        setConfigStatuses((prev) =>
          prev.map((s, j) => j === i ? { ...s, status: 'writing' } : s),
        );

        try {
          const result = await tool.detector.writeConfig(platform, binPath, flags.extensionId);
          if (cancelled) return;

          setConfigStatuses((prev) =>
            prev.map((s, j) =>
              j === i
                ? { ...s, status: result.success ? 'success' : 'error', error: result.error }
                : s,
            ),
          );
        } catch (err) {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : String(err);
          setConfigStatuses((prev) =>
            prev.map((s, j) => j === i ? { ...s, status: 'error', error: message } : s),
          );
        }
      }

      if (!cancelled) {
        setDiscoverPhase('done');
        setPhase('done');
        setTimeout(() => {
          exit();
          forceExit();
        }, 100);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [platform, phase, detections, binaryPath, existingBinaryPath, flags.extensionId, exit]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header />
      <PlatformDisplay platform={platform} />
      {!platform.isSupported && <UnsupportedError platform={platform} />}
      {platform.isSupported && uninstallStatus && (
        <Box marginTop={1}>
          <StepUninstall
            status={uninstallStatus}
            result={uninstallResult}
            errorMessage={uninstallError}
          />
        </Box>
      )}
      {platform.isSupported && !flags.uninstall && (
        <>
          {/* Detection step */}
          <Box marginTop={1}>
            <StepDetect
              status={detectStatus}
              binaryPath={existingBinaryPath}
              skipPrompt={flags.yes || phase !== 'prompt'}
              onUpdateChoice={handleUpdateChoice}
            />
          </Box>

          {/* Download step */}
          {installStatus && (
            <Box marginTop={1}>
              <StepInstall
                platform={platform}
                status={installStatus}
                progress={progress}
                binaryPath={binaryPath}
                errorMessage={installError}
              />
            </Box>
          )}

          {/* Registration step */}
          {registerStatus && (
            <Box marginTop={1}>
              <StepRegister
                status={registerStatus}
                manifestPath={manifestPath}
                errorMessage={registerError}
              />
            </Box>
          )}

          {/* Health check result */}
          {healthStatus && (
            <Box marginTop={1}>
              <StepDetect status={healthStatus} />
            </Box>
          )}

          {/* Tool discovery */}
          {discoverPhase && (
            <Box marginTop={1}>
              <StepDiscover
                phase={discoverPhase}
                detections={detections}
                configStatuses={configStatuses}
                skipPrompt={flags.yes || phase !== 'configure-prompt'}
                onConfigureChoice={handleConfigureChoice}
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

const Header: React.FC = () => (
  <Box marginBottom={1}>
    <Text bold color="blue">AgentHub</Text>
    <Text> — </Text>
    <Text>Setup</Text>
  </Box>
);

const PlatformDisplay: React.FC<{ platform: PlatformInfo }> = ({ platform }) => (
  <Box>
    <Text>Detecting your system... </Text>
    {platform.isSupported ? (
      <Text bold color="green">{platform.displayName}</Text>
    ) : (
      <Text bold color="red">{platform.displayName}</Text>
    )}
  </Box>
);

const UnsupportedError: React.FC<{ platform: PlatformInfo }> = ({ platform }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text color="red">
      Your platform ({platform.displayName}) is not supported.
    </Text>
    <Text color="gray">
      Supported: Windows x64/arm64, macOS x64/arm64, Linux x64/arm64
    </Text>
  </Box>
);
