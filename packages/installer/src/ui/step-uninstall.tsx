import React from 'react';
import { Box, Text } from 'ink';
import type { UninstallResult, ConfigRemovalResult } from '../installers/uninstaller.js';

export type UninstallStatus = 'confirm' | 'removing' | 'complete' | 'error';

interface Props {
  status: UninstallStatus;
  result?: UninstallResult;
  errorMessage?: string;
}

export const StepUninstall: React.FC<Props> = ({ status, result, errorMessage }) => {
  return (
    <Box flexDirection="column">
      <Text bold>🗑  Uninstall</Text>

      {status === 'removing' && (
        <Text color="yellow">  ⏳ Removing AI Browser CoPilot...</Text>
      )}

      {status === 'complete' && result && (
        <Box flexDirection="column">
          <Text color={result.binaryRemoved ? 'green' : 'red'}>
            {result.binaryRemoved ? '  ✓' : '  ✗'} Native host binary
          </Text>
          <Text color={result.manifestRemoved ? 'green' : 'red'}>
            {result.manifestRemoved ? '  ✓' : '  ✗'} Native messaging manifest
          </Text>
          <Text color={result.registryRemoved ? 'green' : 'red'}>
            {result.registryRemoved ? '  ✓' : '  ✗'} Registry key
          </Text>
          {result.configsRemoved.map((cr: ConfigRemovalResult) => (
            <Text key={cr.tool} color={cr.removed ? 'green' : 'red'}>
              {cr.removed ? '  ✓' : '  ✗'} {cr.tool} config
              {cr.backupPath ? ` (backup: ${cr.backupPath})` : ''}
            </Text>
          ))}
          {result.errors.length === 0 ? (
            <Text color="green" bold>
              {'\n'}  Uninstall complete.
            </Text>
          ) : (
            <Text color="yellow" bold>
              {'\n'}  Uninstall completed with {result.errors.length} warning(s).
            </Text>
          )}
        </Box>
      )}

      {status === 'error' && (
        <Text color="red">  ✗ Uninstall failed: {errorMessage}</Text>
      )}
    </Box>
  );
};
