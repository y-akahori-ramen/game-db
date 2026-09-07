import assert from 'node:assert/strict';
import { mergeQueryParams, type QueryParams } from '../src/utils/routeHelpers.ts';

console.log('--- 1. Testing Media Selection Preserving Selected Log Line & Time ---');
const initialParamsWithLog: QueryParams = {
  log: 142,
  t: 18.5,
};

// User selects a media item (screenshot or video)
const afterSelectMedia = mergeQueryParams(initialParamsWithLog, {
  media: 'run-001-screenshot-01.png',
});

assert.equal(afterSelectMedia.media, 'run-001-screenshot-01.png');
assert.equal(afterSelectMedia.log, 142, 'Selected log line (#142) MUST be preserved when selecting media');
assert.equal(afterSelectMedia.t, 18.5, 'Video timestamp must be preserved when selecting media');
console.log('✓ Changing media correctly preserved selected log line and video timestamp.');

console.log('\n--- 2. Testing Video Seek Preserving Selected Log Line & Media ---');
const afterVideoSeek = mergeQueryParams(afterSelectMedia, {
  t: 45.2,
});

assert.equal(afterVideoSeek.t, 45.2);
assert.equal(afterVideoSeek.log, 142, 'Selected log line (#142) MUST be preserved when seeking video');
assert.equal(afterVideoSeek.media, 'run-001-screenshot-01.png', 'Selected media MUST be preserved when seeking video');
console.log('✓ Video seek correctly preserved selected log line and media.');

console.log('\n--- 3. Testing Selecting Another Log Line Preserving Media & Timestamp ---');
const afterSelectAnotherLine = mergeQueryParams(afterVideoSeek, {
  log: 305,
});

assert.equal(afterSelectAnotherLine.log, 305);
assert.equal(afterSelectAnotherLine.media, 'run-001-screenshot-01.png');
assert.equal(afterSelectAnotherLine.t, 45.2);
console.log('✓ Selecting another log line correctly preserved media and timestamp.');

console.log('\n--- 4. Testing Explicit Deselection of Log Line ---');
const afterDeselectLine = mergeQueryParams(afterSelectAnotherLine, {
  log: undefined,
});

assert.equal(afterDeselectLine.log, undefined, 'Log line must be removed when explicitly passed as undefined');
assert.equal(afterDeselectLine.media, 'run-001-screenshot-01.png', 'Media should remain intact');
assert.equal(afterDeselectLine.t, 45.2, 'Timestamp should remain intact');
console.log('✓ Deselecting log line removed log while preserving other parameters.');

console.log('\n--- 5. Testing Deletion with Null, Empty String, and NaN ---');
const paramsToClear: QueryParams = {
  testName: 'CombatTest',
  gameVersion: '1.2.0',
  t: 30,
  log: 99,
};

const cleared = mergeQueryParams(paramsToClear, {
  testName: '',
  gameVersion: undefined,
  t: NaN,
  log: null as unknown as undefined,
});

assert.deepEqual(cleared, {}, 'Falsy/NaN/undefined values in updates should delete corresponding keys');
console.log('✓ Null, empty string, and NaN are cleanly stripped.');

console.log('\n--- 6. Testing Direct URL Route Parsing ---');
import { parseRouteFromLocation } from '../src/utils/routeHelpers.ts';

// Test 1: Direct URL with pathname /runs/run-001
const parsedFromPath = parseRouteFromLocation('/runs/run-001', '?log=15&t=3.5');
assert.equal(parsedFromPath.route.name, 'dashboard');
assert.equal(parsedFromPath.route.runId, 'run-001');
assert.equal(parsedFromPath.params.log, 15);
assert.equal(parsedFromPath.params.t, 3.5);
console.log('✓ Pathname /runs/run-001 parses route and params correctly.');

// Test 2: Direct URL with query param ?run=run-002
const parsedFromQueryRun = parseRouteFromLocation('/', '?run=run-002&media=screenshot_001.png');
assert.equal(parsedFromQueryRun.route.name, 'dashboard');
assert.equal(parsedFromQueryRun.route.runId, 'run-002');
assert.equal(parsedFromQueryRun.params.media, 'screenshot_001.png');
console.log('✓ Query ?run=run-002 parses route and media param correctly.');

// Test 3: Direct URL with query param ?runId=run-003
const parsedFromQueryRunId = parseRouteFromLocation('/', '?runId=run-003');
assert.equal(parsedFromQueryRunId.route.name, 'dashboard');
assert.equal(parsedFromQueryRunId.route.runId, 'run-003');
console.log('✓ Query ?runId=run-003 parses route correctly.');

// Test 4: Direct URL with query param ?compare=run-001,run-002
const parsedFromQueryCompare = parseRouteFromLocation('/', '?compare=run-001,run-002');
assert.equal(parsedFromQueryCompare.route.name, 'compare');
assert.deepEqual(parsedFromQueryCompare.route.compareRunIds, ['run-001', 'run-002']);
console.log('✓ Query ?compare=run-001,run-002 parses compare route correctly.');

// Test 5: Default root path parses as search
const parsedRoot = parseRouteFromLocation('/', '');
assert.equal(parsedRoot.route.name, 'search');
console.log('✓ Root / parses as search route correctly.');

// Test 6: Direct URL with pathname /trends
const parsedTrendsPath = parseRouteFromLocation('/trends', '?range=14d&platform=PS5');
assert.equal(parsedTrendsPath.route.name, 'trends');
assert.equal(parsedTrendsPath.params.range, '14d');
assert.equal(parsedTrendsPath.params.platform, 'PS5');
console.log('✓ Pathname /trends parses route and trend params correctly.');

// Test 7: Direct URL with query param ?view=trends
const parsedTrendsQuery = parseRouteFromLocation('/', '?view=trends&testName=Level1_Playthrough');
assert.equal(parsedTrendsQuery.route.name, 'trends');
assert.equal(parsedTrendsQuery.params.testName, 'Level1_Playthrough');
console.log('✓ Query ?view=trends parses route and testName param correctly.');

console.log('\n========================================');
console.log('All Router Params & Direct URL Parsing unit verification tests PASSED!');
console.log('========================================');
