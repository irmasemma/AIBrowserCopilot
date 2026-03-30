import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { ToolDetectionSummary, WriteConfigResult } from '../detectors/types.js';

export type DiscoverPhase = 'scanning' | 'results' | 'configuring' | 'done' | 'none-found';

export interface ToolConfigStatus {
  slug: string;
  name: string;
  status: 'pending' | 'writing' | 'success' | 'error';
  error?: string;
}

export interface StepDiscoverProps {
  phase: DiscoverPhase;
  detections?: ToolDetectionSummary[];
  configStatuses?: ToolConfigStatus[];
  skipPrompt?: boolean;
  onConfigureChoice?: (configure: boolean) => void;
}

export const StepDiscover: React.FC<StepDiscoverProps> = ({
  phase,
  detections = [],
  configStatuses = [],
  skipPrompt = false,
  onConfigureChoice,
}) => {
  const [answered, setAnswered] = React.useState(false);
  const needsInput = phase === 'results' && !skipPrompt && !answered;
  const installedTools = detections.filter((d) => d.detection.installed);

  useInput((input, key) => {
    if (input.toLowerCase() === 'y' || key.return) {
      setAnswered(true);
      onConfigureChoice?.(true);
    } else if (input.toLowerCase() === 'n') {
      setAnswered(true);
      onConfigureChoice?.(false);
    }
  }, { isActive: needsInput });

  return (
    <Box flexDirection="column">
      {phase === 'scanning' && (
        <Text bold>⚙ Scanning for AI tools...</Text>
      )}

      {phase === 'none-found' && (
        <Box flexDirection="column">
          <Text bold color="yellow">⚠ No AI tools found</Text>
          <Text color="gray">
            Install Claude Desktop, VS Code, or Cursor first.
          </Text>
        </Box>
      )}

      {(phase === 'results' || phase === 'configuring' || phase === 'done') && (
        <Box flexDirection="column">
          <Text bold>Found AI tools:</Text>
          {detections.map((d) => (
            <Box key={d.detector.slug}>
              {d.detection.installed ? (
                <Text>
                  <Text color="green">  ✓ </Text>
                  <Text>{d.detector.name}</Text>
                  {d.detection.hasExistingMcp && (
                    <Text color="gray"> (already configured)</Text>
                  )}
                </Text>
              ) : (
                <Text>
                  <Text color="gray">  - </Text>
                  <Text color="gray">{d.detector.name} — not found</Text>
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {phase === 'results' && installedTools.length > 0 && !skipPrompt && !answered && (
        <Box marginTop={1}>
          <Text>Configure these tools? </Text>
          <Text bold>[Y/n] </Text>
        </Box>
      )}

      {(phase === 'configuring' || phase === 'done') && configStatuses.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Configuring:</Text>
          {configStatuses.map((s) => (
            <Box key={s.slug}>
              {s.status === 'pending' && <Text color="gray">  ○ {s.name}</Text>}
              {s.status === 'writing' && <Text color="yellow">  ⚙ {s.name}...</Text>}
              {s.status === 'success' && <Text><Text color="green">  ✓ </Text><Text>{s.name}</Text></Text>}
              {s.status === 'error' && (
                <Text>
                  <Text color="red">  ✗ </Text>
                  <Text>{s.name}</Text>
                  {s.error && <Text color="gray"> — {s.error}</Text>}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
