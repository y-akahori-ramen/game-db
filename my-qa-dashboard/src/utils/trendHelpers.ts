import type { TestRunSummary } from '../services/SearchService.ts';
import type { TrendDataPoint, TrendSummaryStats, TrendTimeRange } from '../types/index.ts';

export interface TrendFilterOptions {
  testName?: string;
  platform?: string;
  gameVersion?: string;
  range?: TrendTimeRange;
}

/** Format ISO timestamp into a readable compact date-time string (e.g. "08/01 10:15"). */
export function formatTrendDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

/** Format ISO timestamp into a date-only string ("YYYY-MM-DD"). */
export function toDateString(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString.slice(0, 10);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return isoString.slice(0, 10);
  }
}

/**
 * Filter and chronologically sort (oldest to newest) test runs for trend plotting.
 */
export function filterTrendRuns(
  runs: TestRunSummary[],
  filters: TrendFilterOptions,
): TestRunSummary[] {
  let filtered = [...runs];

  if (filters.testName && filters.testName !== 'ALL') {
    filtered = filtered.filter((r) => r.testName === filters.testName);
  }

  if (filters.platform && filters.platform !== 'ALL') {
    filtered = filtered.filter((r) => r.platform === filters.platform);
  }

  if (filters.gameVersion && filters.gameVersion !== 'ALL') {
    filtered = filtered.filter((r) => r.gameVersion === filters.gameVersion);
  }

  // Sort ascending by timestamp (oldest first for time-series charts)
  filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Apply time window filter relative to the latest timestamp in the dataset
  if (filters.range && filters.range !== 'all' && filtered.length > 0) {
    const latestTimestamp = new Date(filtered[filtered.length - 1].timestamp).getTime();
    let days = 30;
    if (filters.range === '7d') days = 7;
    else if (filters.range === '14d') days = 14;
    else if (filters.range === '30d') days = 30;

    const cutoff = latestTimestamp - days * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  }

  return filtered;
}

/**
 * Convert runs to TrendDataPoint objects.
 */
export function toTrendDataPoints(runs: TestRunSummary[]): TrendDataPoint[] {
  return runs.map((r) => ({
    runId: r.runId,
    timestamp: r.timestamp,
    formattedDate: formatTrendDate(r.timestamp),
    gameVersion: r.gameVersion,
    platform: r.platform,
    testName: r.testName,
    status: r.status,
    avgFps: typeof r.avgFps === 'number' ? r.avgFps : null,
    minFps: typeof r.minFps === 'number' ? r.minFps : null,
    peakMemoryMb: typeof r.peakMemoryMb === 'number' ? r.peakMemoryMb : null,
  }));
}

/**
 * Calculate KPI summary statistics across filtered runs.
 */
export function calculateTrendSummary(runs: TestRunSummary[]): TrendSummaryStats {
  const totalRuns = runs.length;
  if (totalRuns === 0) {
    return {
      totalRuns: 0,
      passedRuns: 0,
      failedRuns: 0,
      passRate: 0,
      latestAvgFps: null,
      overallAvgFps: null,
      deltaFps: null,
      latestPeakMemory: null,
      overallPeakMemory: null,
      deltaPeakMemory: null,
    };
  }

  const passedRuns = runs.filter((r) => r.status === 'PASSED').length;
  const failedRuns = totalRuns - passedRuns;
  const passRate = Math.round((passedRuns / totalRuns) * 1000) / 10;

  // FPS calculations
  const runsWithFps = runs.filter((r) => typeof r.avgFps === 'number');
  let latestAvgFps: number | null = null;
  let overallAvgFps: number | null = null;
  let deltaFps: number | null = null;

  if (runsWithFps.length > 0) {
    // runs are sorted ascending, so last element is the latest
    const latest = runsWithFps[runsWithFps.length - 1].avgFps!;
    latestAvgFps = latest;
    const fpsSum = runsWithFps.reduce((sum, r) => sum + r.avgFps!, 0);
    overallAvgFps = Math.round((fpsSum / runsWithFps.length) * 10) / 10;
    deltaFps = Math.round((latest - overallAvgFps) * 10) / 10;
  }

  // Memory calculations
  const runsWithMem = runs.filter((r) => typeof r.peakMemoryMb === 'number');
  let latestPeakMemory: number | null = null;
  let overallPeakMemory: number | null = null;
  let deltaPeakMemory: number | null = null;

  if (runsWithMem.length > 0) {
    const latest = runsWithMem[runsWithMem.length - 1].peakMemoryMb!;
    latestPeakMemory = latest;
    const memSum = runsWithMem.reduce((sum, r) => sum + r.peakMemoryMb!, 0);
    overallPeakMemory = Math.round((memSum / runsWithMem.length) * 10) / 10;
    deltaPeakMemory = Math.round((latest - overallPeakMemory) * 10) / 10;
  }

  return {
    totalRuns,
    passedRuns,
    failedRuns,
    passRate,
    latestAvgFps,
    overallAvgFps,
    deltaFps,
    latestPeakMemory,
    overallPeakMemory,
    deltaPeakMemory,
  };
}

export interface DayPassFailStats {
  date: string;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
}

/**
 * Group test runs by date ("YYYY-MM-DD") to show daily test volume and pass rate.
 */
export function groupPassFailByDate(runs: TestRunSummary[]): DayPassFailStats[] {
  const map = new Map<string, { passed: number; failed: number }>();

  for (const r of runs) {
    const day = toDateString(r.timestamp);
    const curr = map.get(day) || { passed: 0, failed: 0 };
    if (r.status === 'PASSED') {
      curr.passed += 1;
    } else {
      curr.failed += 1;
    }
    map.set(day, curr);
  }

  const results: DayPassFailStats[] = [];
  for (const [date, counts] of map.entries()) {
    const total = counts.passed + counts.failed;
    results.push({
      date,
      passed: counts.passed,
      failed: counts.failed,
      total,
      passRate: total > 0 ? Math.round((counts.passed / total) * 100) : 0,
    });
  }

  results.sort((a, b) => a.date.localeCompare(b.date));
  return results;
}
