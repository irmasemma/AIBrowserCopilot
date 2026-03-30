import React from 'react';
import { Box, Text, useInput } from 'ink';

export type DetectStatus = 'checking' | 'found' | 'not-found' | 'health-ok' | 'health-fail';

export interface StepDetectProps {
  status: DetectStatus;
  binaryPath?: string;
  skipPrompt?: boolean;
  onUpdateChoice?: (update: boolean) => void;
}

export const StepDetect: React.FC<StepDetectProps> = ({
  status,
  binaryPath,
  skipPrompt = false,
  onUpdateChoice,
}) => {
  const [answered, setAnswered] = React.useState(false);
  const needsInput = status === 'found' && !skipPrompt && !answered;

  useInput((input, key) => {
    if (input.toLowerCase() === 'y' || key.return) {
      setAnswered(true);
      onUpdateChoice?.(true);
    } else if (input.toLowerCase() === 'n') {
      setAnswered(true);
      onUpdateChoice?.(false);
    }
  }, { isActive: needsInput });

  return (
    <Box flexDirection="column">
      {status === 'checking' && (
        <Text bold>⚙ Checking for existing installation...</Text>
      )}

      {status === 'not-found' && (
        <Text bold>⬇ No existing installation found</Text>
      )}

      {status === 'found' && (
        <Box flexDirection="column">
          <Text bold>✓ Browser bridge already installed</Text>
          {binaryPath && (
            <Box>
              <Text color="gray">Found: {binaryPath}</Text>
            </Box>
          )}
          {!skipPrompt && !answered && (
            <Box marginTop={1}>
              <Text>Update to latest? </Text>
              <Text bold>[Y/n] </Text>
            </Box>
          )}
        </Box>
      )}

      {status === 'health-ok' && (
        <Box>
          <Text color="green" bold>✓ </Text>
          <Text bold>Bridge verified</Text>
        </Box>
      )}

      {status === 'health-fail' && (
        <Box flexDirection="column">
          <Text color="red" bold>✗ Bridge health check failed</Text>
          <Text color="gray">The binary may be corrupted. Try reinstalling.</Text>
        </Box>
      )}
    </Box>
  );
};
