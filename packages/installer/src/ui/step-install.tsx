import React from 'react';
import { Box, Text } from 'ink';
import type { PlatformInfo } from '../shared/platform.js';
import type { DownloadProgress } from '../installers/binary-installer.js';
import { getAssetName } from '../shared/constants.js';

export type InstallStatus = 'downloading' | 'installing' | 'complete' | 'error';

export interface StepInstallProps {
  platform: PlatformInfo;
  status: InstallStatus;
  progress?: DownloadProgress;
  binaryPath?: string;
  errorMessage?: string;
}

const BAR_WIDTH = 30;

const formatBytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

const ProgressBar: React.FC<{ percent: number }> = ({ percent }) => {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return (
    <Text>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(empty)}</Text>
      <Text> {percent}%</Text>
    </Text>
  );
};

export const StepInstall: React.FC<StepInstallProps> = ({
  platform,
  status,
  progress,
  binaryPath,
  errorMessage,
}) => {
  const assetName = getAssetName(platform.os, platform.arch);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {status === 'downloading' && '⬇ Downloading native host...'}
          {status === 'installing' && '⚙ Installing native host...'}
          {status === 'complete' && '✓ Installation complete'}
          {status === 'error' && '✗ Installation failed'}
        </Text>
      </Box>

      <Box>
        <Text color="gray">Binary: </Text>
        <Text>{assetName}</Text>
      </Box>

      {status === 'downloading' && progress && (
        <Box flexDirection="column" marginTop={1}>
          <ProgressBar percent={progress.percent} />
          <Text color="gray">
            {formatBytes(progress.bytesReceived)} / {formatBytes(progress.totalBytes)}
          </Text>
        </Box>
      )}

      {status === 'complete' && binaryPath && (
        <Box marginTop={1}>
          <Text color="green">✓ </Text>
          <Text color="gray">Installed to: {binaryPath}</Text>
        </Box>
      )}

      {status === 'error' && errorMessage && (
        <Box marginTop={1}>
          <Text color="red">{errorMessage}</Text>
        </Box>
      )}
    </Box>
  );
};
