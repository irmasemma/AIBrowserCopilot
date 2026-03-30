import React from 'react';
import { Box, Text } from 'ink';

export type RegisterStatus = 'registering' | 'complete' | 'error';

export interface StepRegisterProps {
  status: RegisterStatus;
  manifestPath?: string;
  errorMessage?: string;
}

export const StepRegister: React.FC<StepRegisterProps> = ({
  status,
  manifestPath,
  errorMessage,
}) => {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {status === 'registering' && '⚙ Registering native messaging host...'}
          {status === 'complete' && '✓ Native messaging host registered'}
          {status === 'error' && '✗ Registration failed'}
        </Text>
      </Box>

      {status === 'complete' && manifestPath && (
        <Box>
          <Text color="green">✓ </Text>
          <Text color="gray">Manifest: {manifestPath}</Text>
        </Box>
      )}

      {status === 'error' && errorMessage && (
        <Box>
          <Text color="red">{errorMessage}</Text>
        </Box>
      )}
    </Box>
  );
};
