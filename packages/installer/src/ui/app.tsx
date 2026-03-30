import React from 'react';
import { Box, Text, useApp } from 'ink';
import type { PlatformInfo } from '../shared/platform.js';
import type { DownloadProgress, InstallResult } from '../installers/binary-installer.js';
import type { RegistrationResult } from '../installers/host-registrar.js';
import type { HealthCheckResult } from '../installers/health-check.js';
import type { ToolDetectionSummary } from '../detectors/types.js';
import { downloadBinary, isBinaryInstalled } from '../installers/binary-installer.js';
import { registerHost } from '../installers/host-registrar.js';
import { checkBinaryHealth } from '../installers/health-check.js';
import { getInstallDir } from '../shared/platform.js';
import { getAssetName } from '../shared/constants.js';
import { join } from 'node:path';
import { registerAllDetectors, runAll, clear } from '../detectors/index.js';
import { StepInstall, type InstallStatus } from './step-install.js';
import { StepRegister, type RegisterStatus } from './step-register.js';
import { StepDetect, type DetectStatus } from './step-detect.js';
import { StepDiscover, type DiscoverPhase, type ToolConfigStatus } from './step-discover.js';

export interface CliFlags {
  yes: boolean;
  tools?: string;
  update: boolean;
  uninstall: boolean;
  extensionId?: string;
}

export interface AppProps {
  platform: PlatformInfo;
  flags: CliFlags;
  downloadFn?: typeof downloadBinary;
  registerFn?: typeof registerHost;
  checkHealthFn?: typeof checkBinaryHealth;
  checkInstalledFn?: typeof isBinaryInstalled;
  runDetectorsFn?: typeof runAll;
}

type AppPhase = 'detect' | 'prompt' | 'download' | 'register' | 'health' | 'discover' | 'configure-prompt' | 'configure' | 'done';

export const App: React.FC<AppProps> = ({
  platform,
  flags,
  downloadFn = downloadBinary,
  registerFn = registerHost,
  checkHealthFn = checkBinaryHealth,
  checkInstalledFn = isBinaryInstalled,
  runDetectorsFn = runAll,
}) => {
  const { exit } = useApp();
  const [phase, setPhase] = React.useState<AppPhase>('detect');

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

  // Phase 1: Detection
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'detect') return;

    const installDir = getInstallDir(platform);
    const alreadyInstalled = checkInstalledFn(installDir, platform);

    if (alreadyInstalled) {
      setExistingBinaryPath(join(installDir, getAssetName(platform.os, platform.arch)));
      setDetectStatus('found');

      if (flags.yes) {
        // Auto-update when --yes flag is passed
        setPhase('download');
      } else {
        setPhase('prompt');
      }
    } else {
      setDetectStatus('not-found');
      setPhase('download');
    }
  }, [platform, phase, flags.yes, checkInstalledFn]);

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
  }, [platform, phase, downloadFn, exit]);

  // Phase 3: Register
  React.useEffect(() => {
    if (!platform.isSupported || phase !== 'register') return;

    let cancelled = false;
    const run = async () => {
      try {
        setRegisterStatus('registering');
        const binPath = binaryPath ?? existingBinaryPath ?? '';
        const regResult: RegistrationResult = await registerFn(
          platform,
          binPath,
          flags.extensionId,
        );

        if (cancelled) return;

        if (regResult.success) {
          setManifestPath(regResult.manifestPath);
          setRegisterStatus('complete');
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
      const timer = setTimeout(() => exit(), 100);
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
        const timer = setTimeout(() => exit(), 100);
        return () => clearTimeout(timer);
      }

      if (flags.yes) {
        setDiscoverPhase('configuring');
        setPhase('configure');
      } else {
        setDiscoverPhase('results');
        setPhase('configure-prompt');
      }
    };

    run();
    return () => { cancelled = true; };
  }, [platform, phase, flags.yes, runDetectorsFn, exit]);

  // Handle configure choice
  const handleConfigureChoice = React.useCallback((configure: boolean) => {
    if (configure) {
      setDiscoverPhase('configuring');
      setPhase('configure');
    } else {
      setDiscoverPhase('done');
      setPhase('done');
      exit();
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
        const timer = setTimeout(() => exit(), 100);
        // Can't return cleanup from inside async, but timer is short-lived
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
      {platform.isSupported && (
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
    <Text bold color="blue">AI Browser CoPilot</Text>
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
