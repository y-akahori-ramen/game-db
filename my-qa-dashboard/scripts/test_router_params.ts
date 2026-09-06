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

console.log('\n========================================');
console.log('All Router Params unit verification tests PASSED!');
console.log('========================================');
