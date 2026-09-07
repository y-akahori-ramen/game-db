import assert from 'node:assert/strict';
import {
  getMemoryElapsedSeconds,
  formatTimeDisplay,
  TIME_COLUMNS,
} from '../src/utils/timeHelpers.ts';
import { mergeQueryParams, parseRouteFromLocation } from '../src/utils/routeHelpers.ts';

console.log('--- 1. Testing getMemoryElapsedSeconds ---');

// Case A: Explicit ElapsedTime column
const rowWithElapsed = { TrackedTotal: 1000, ElapsedTime: 42.5, Audio: 50 };
assert.equal(getMemoryElapsedSeconds(rowWithElapsed, 5, 10), 42.5);

// Case B: Explicit Time column
const rowWithTime = { TrackedTotal: 1000, Time: 15.3, Audio: 50 };
assert.equal(getMemoryElapsedSeconds(rowWithTime, 5, 10), 15.3);

// Case C: Explicit Seconds column
const rowWithSeconds = { TrackedTotal: 1000, Seconds: 8.75, Audio: 50 };
assert.equal(getMemoryElapsedSeconds(rowWithSeconds, 5, 10), 8.75);

// Case D: Interpolated with duration
const rowNoTime = { TrackedTotal: 1000, Audio: 50 };
// Total 11 items (index 0 to 10), duration 100s -> index 5 should be 50.0s
assert.equal(getMemoryElapsedSeconds(rowNoTime, 5, 11, 100), 50.0);
assert.equal(getMemoryElapsedSeconds(rowNoTime, 0, 11, 100), 0.0);
assert.equal(getMemoryElapsedSeconds(rowNoTime, 10, 11, 100), 100.0);

// Case E: Default fallback (2Hz = 0.5s per index)
assert.equal(getMemoryElapsedSeconds(rowNoTime, 0, 10), 0.0);
assert.equal(getMemoryElapsedSeconds(rowNoTime, 6, 10), 3.0);
assert.equal(getMemoryElapsedSeconds(rowNoTime, 15, 10), 7.5);
console.log('✓ getMemoryElapsedSeconds correctly derives seconds across all priority cases.');

console.log('--- 2. Testing formatTimeDisplay ---');
assert.equal(formatTimeDisplay(0), '0.0s');
assert.equal(formatTimeDisplay(12.34), '12.3s');
assert.equal(formatTimeDisplay(59.9), '59.9s');
assert.equal(formatTimeDisplay(60), '1:00.0');
assert.equal(formatTimeDisplay(75.5), '1:15.5');
assert.equal(formatTimeDisplay(185.2), '3:05.2');
console.log('✓ formatTimeDisplay formats seconds and minutes accurately.');

console.log('--- 3. Testing TIME_COLUMNS exclusion ---');
const rawColumns = ['TrackedTotal', 'ElapsedTime', 'Untagged', 'Audio', 'Seconds', 'time'];
const metricColumns = rawColumns.filter((col) => col !== 'TrackedTotal' && !TIME_COLUMNS.has(col));
assert.deepEqual(metricColumns, ['Untagged', 'Audio']);
console.log('✓ TIME_COLUMNS filters out non-metric time headers.');

console.log('--- 4. Testing Timeline & Log sync in URL Query Params ---');
const initialParams = { testName: 'Combat_Test' };
// Clicking a log at line 142 that occurred at t=28.4s
const withLogAndSeek = mergeQueryParams(initialParams, { log: 142, t: 28.4 });
assert.equal(withLogAndSeek.log, 142);
assert.equal(withLogAndSeek.t, 28.4);
assert.equal(withLogAndSeek.testName, 'Combat_Test');

// Seeking to t=45.0s preserves selected log
const afterSeek = mergeQueryParams(withLogAndSeek, { t: 45.0 });
assert.equal(afterSeek.log, 142);
assert.equal(afterSeek.t, 45.0);

// Parsing from URL search string
const parsed = parseRouteFromLocation('/runs/run-001', '?log=142&t=28.4', '/');
assert.equal(parsed.route.name, 'dashboard');
assert.equal(parsed.route.runId, 'run-001');
assert.equal(parsed.params.log, 142);
assert.equal(parsed.params.t, 28.4);
console.log('✓ Timeline & log parameters sync seamlessly in query parameters.');

console.log('========================================');
console.log('All Timeline Sync unit verification tests PASSED!');
console.log('========================================');
