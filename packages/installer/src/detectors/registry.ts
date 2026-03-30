import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, ToolDetectionSummary, DetectionResult } from './types.js';

const DETECTION_TIMEOUT_MS = 2000;

const detectors: ToolDetector[] = [];

export const register = (detector: ToolDetector): void => {
  detectors.push(detector);
};

export const getAll = (): readonly ToolDetector[] => {
  return detectors;
};

export const clear = (): void => {
  detectors.length = 0;
};

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
};

/**
 * Run all registered detectors in parallel.
 * Uses Promise.allSettled for error isolation — one failing detector
 * doesn't affect others. Each detection has a 2-second timeout.
 */
export const runAll = async (platform: PlatformInfo): Promise<ToolDetectionSummary[]> => {
  const results = await Promise.allSettled(
    detectors.map(async (detector): Promise<ToolDetectionSummary> => {
      const detection = await withTimeout(
        detector.detect(platform),
        DETECTION_TIMEOUT_MS,
        detector.name,
      );
      return { detector, detection };
    }),
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // Detector failed — return error summary with installed: false
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const failedDetection: DetectionResult = { installed: false };
    return { detector: detectors[i], detection: failedDetection, error };
  });
};
