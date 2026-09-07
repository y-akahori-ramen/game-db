import assert from 'node:assert/strict';
import type { TestRunSummary } from '../src/services/SearchService.ts';
import {
  calculateTrendSummary,
  filterTrendRuns,
  formatTrendDate,
  groupPassFailByDate,
  toDateString,
  toTrendDataPoints,
} from '../src/utils/trendHelpers.ts';

const mockRuns: TestRunSummary[] = [
  {
    runId: 'run-001',
    gameVersion: 'v1.2.0',
    platform: 'PS5',
    testName: 'Level1_Playthrough',
    status: 'FAILED',
    timestamp: '2026-08-01T10:15:00Z',
    avgFps: 50.0,
    minFps: 20.0,
    peakMemoryMb: 800.0,
    artifacts: [],
  },
  {
    runId: 'run-002',
    gameVersion: 'v1.2.0',
    platform: 'Windows',
    testName: 'Boss_Battle_Stress',
    status: 'PASSED',
    timestamp: '2026-08-02T14:40:00Z',
    avgFps: 60.0,
    minFps: 45.0,
    peakMemoryMb: 600.0,
    artifacts: [],
  },
  {
    runId: 'run-003',
    gameVersion: 'v1.2.1',
    platform: 'PS5',
    testName: 'Level1_Playthrough',
    status: 'PASSED',
    timestamp: '2026-08-05T11:00:00Z',
    avgFps: 58.0,
    minFps: 40.0,
    peakMemoryMb: 750.0,
    artifacts: [],
  },
  {
    runId: 'run-004',
    gameVersion: 'v1.3.0',
    platform: 'PS5',
    testName: 'Level1_Playthrough',
    status: 'PASSED',
    timestamp: '2026-08-10T09:30:00Z',
    avgFps: 62.0,
    minFps: 55.0,
    peakMemoryMb: 770.0,
    artifacts: [],
  },
];

console.log('--- 1. Testing Date Formatting ---');
assert.equal(toDateString('2026-08-01T10:15:00Z'), '2026-08-01');
const formatted = formatTrendDate('2026-08-01T10:15:00Z');
assert.match(formatted, /08\/01/);
console.log('✓ Date formatting functions output expected strings.');

console.log('\n--- 2. Testing Filter by Test Name ---');
const levelRuns = filterTrendRuns(mockRuns, { testName: 'Level1_Playthrough' });
assert.equal(levelRuns.length, 3);
assert.ok(levelRuns.every((r) => r.testName === 'Level1_Playthrough'));
// Should be sorted ascending by timestamp
assert.equal(levelRuns[0].runId, 'run-001');
assert.equal(levelRuns[1].runId, 'run-003');
assert.equal(levelRuns[2].runId, 'run-004');
console.log('✓ Filtering by test name correctly filters and sorts chronologically.');

console.log('\n--- 3. Testing Filter by Platform and Time Range ---');
const ps5Runs = filterTrendRuns(mockRuns, { platform: 'PS5' });
assert.equal(ps5Runs.length, 3);
assert.ok(ps5Runs.every((r) => r.platform === 'PS5'));

// Range filter: 7 days relative to latest timestamp (2026-08-10)
// Cutoff is 2026-08-03. run-003 (08-05) and run-004 (08-10) should pass, run-001 (08-01) excluded.
const recentRuns = filterTrendRuns(mockRuns, { range: '7d' });
assert.equal(recentRuns.length, 2);
assert.equal(recentRuns[0].runId, 'run-003');
assert.equal(recentRuns[1].runId, 'run-004');
console.log('✓ Platform and time-window filtering work accurately.');

console.log('\n--- 4. Testing calculateTrendSummary KPIs ---');
const statsAll = calculateTrendSummary(mockRuns);
assert.equal(statsAll.totalRuns, 4);
assert.equal(statsAll.passedRuns, 3);
assert.equal(statsAll.failedRuns, 1);
assert.equal(statsAll.passRate, 75.0);
// latestAvgFps: run-004 has 62.0
assert.equal(statsAll.latestAvgFps, 62.0);
// overallAvgFps: (50 + 60 + 58 + 62) / 4 = 57.5
assert.equal(statsAll.overallAvgFps, 57.5);
// deltaFps: 62.0 - 57.5 = +4.5
assert.equal(statsAll.deltaFps, 4.5);
// latestPeakMemory: 770.0
assert.equal(statsAll.latestPeakMemory, 770.0);
// overallPeakMemory: (800 + 600 + 750 + 770) / 4 = 730.0
assert.equal(statsAll.overallPeakMemory, 730.0);
// deltaPeakMemory: 770 - 730 = 40.0
assert.equal(statsAll.deltaPeakMemory, 40.0);
console.log('✓ calculateTrendSummary computes exact KPIs and delta indicators.');

console.log('\n--- 5. Testing Empty Runs Edge Case ---');
const emptyStats = calculateTrendSummary([]);
assert.equal(emptyStats.totalRuns, 0);
assert.equal(emptyStats.passRate, 0);
assert.equal(emptyStats.latestAvgFps, null);
assert.equal(emptyStats.deltaFps, null);
console.log('✓ calculateTrendSummary gracefully handles empty datasets.');

console.log('\n--- 6. Testing groupPassFailByDate ---');
const dateGroups = groupPassFailByDate(mockRuns);
assert.equal(dateGroups.length, 4);
assert.equal(dateGroups[0].date, '2026-08-01');
assert.equal(dateGroups[0].failed, 1);
assert.equal(dateGroups[0].passed, 0);
assert.equal(dateGroups[0].passRate, 0);
assert.equal(dateGroups[1].date, '2026-08-02');
assert.equal(dateGroups[1].passed, 1);
assert.equal(dateGroups[1].passRate, 100);
console.log('✓ groupPassFailByDate aggregates daily pass/fail volumes and rates.');

console.log('\n--- 7. Testing toTrendDataPoints ---');
const dataPoints = toTrendDataPoints(mockRuns);
assert.equal(dataPoints.length, 4);
assert.equal(dataPoints[0].runId, 'run-001');
assert.equal(dataPoints[0].avgFps, 50.0);
assert.equal(dataPoints[0].minFps, 20.0);
assert.equal(dataPoints[0].peakMemoryMb, 800.0);
console.log('✓ toTrendDataPoints converts summaries to chart data points correctly.');

console.log('\n========================================');
console.log('All Trend Dashboard unit verification tests PASSED!');
console.log('========================================');
