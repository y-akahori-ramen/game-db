import type { MemoryMetric } from '../types/index.ts';

export const TIME_COLUMNS = new Set(['ElapsedTime', 'Time', 'Seconds', 'timestamp', 'time']);

/**
 * Derives elapsed time in seconds for a row in a memory metrics dataset.
 * Priority:
 * 1. Explicit column (ElapsedTime, Time, Seconds)
 * 2. If duration is provided: linearly interpolated across totalCount
 * 3. Default to 2Hz sampling (0.5s per sample, UE LLM default)
 */
export function getMemoryElapsedSeconds(
  row: MemoryMetric,
  index: number,
  totalCount: number,
  duration?: number,
): number {
  if (typeof row['ElapsedTime'] === 'number') return row['ElapsedTime'];
  if (typeof row['Time'] === 'number') return row['Time'];
  if (typeof row['Seconds'] === 'number') return row['Seconds'];
  if (duration !== undefined && duration > 0 && totalCount > 1) {
    return Number(((index / (totalCount - 1)) * duration).toFixed(2));
  }
  return Number((index * 0.5).toFixed(2));
}

/** Format seconds to human-readable string (e.g. 12.3s or 01:23.4). */
export function formatTimeDisplay(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}
