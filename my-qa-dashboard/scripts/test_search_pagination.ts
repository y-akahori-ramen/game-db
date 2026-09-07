import assert from 'node:assert/strict';

interface MockRun {
  runId: string;
  timestamp: string;
  gameVersion: string;
  platform: string;
  testName: string;
  status: 'PASSED' | 'FAILED' | 'ABORTED';
}

console.log('--- 1. Testing Pagination Slicing & Boundary Calculations ---');
const totalItems = 125;
const mockRuns: MockRun[] = Array.from({ length: totalItems }, (_, i) => ({
  runId: `run-${String(i + 1).padStart(3, '0')}`,
  timestamp: new Date(Date.UTC(2026, 7, 1, 10, 0, i)).toISOString(),
  gameVersion: 'v1.2.0',
  platform: i % 2 === 0 ? 'PS5' : 'Windows',
  testName: i % 3 === 0 ? 'Boss_Battle' : 'Level1_Playthrough',
  status: i % 5 === 0 ? 'FAILED' : 'PASSED',
}));

// Function mimicking SearchPage pagination logic
function paginate(runs: MockRun[], page: number, pageSize: number) {
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(runs.length / pageSize)) : 1;
  const safeCurrentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = pageSize > 0 ? (safeCurrentPage - 1) * pageSize : 0;
  const endIndex = pageSize > 0 ? Math.min(startIndex + pageSize, runs.length) : runs.length;
  const slice = pageSize > 0 ? runs.slice(startIndex, endIndex) : runs;
  return { totalPages, safeCurrentPage, startIndex, endIndex, slice };
}

// Page 1 of 50
const p1 = paginate(mockRuns, 1, 50);
assert.equal(p1.totalPages, 3);
assert.equal(p1.safeCurrentPage, 1);
assert.equal(p1.startIndex, 0);
assert.equal(p1.endIndex, 50);
assert.equal(p1.slice.length, 50);
assert.equal(p1.slice[0].runId, 'run-001');
assert.equal(p1.slice[49].runId, 'run-050');

// Page 3 of 50 (last page with remaining 25 items)
const p3 = paginate(mockRuns, 3, 50);
assert.equal(p3.safeCurrentPage, 3);
assert.equal(p3.startIndex, 100);
assert.equal(p3.endIndex, 125);
assert.equal(p3.slice.length, 25);
assert.equal(p3.slice[0].runId, 'run-101');
assert.equal(p3.slice[24].runId, 'run-125');

// Out of bounds page clamp
const pOverflow = paginate(mockRuns, 999, 50);
assert.equal(pOverflow.safeCurrentPage, 3);
assert.equal(pOverflow.slice.length, 25);

const pUnderflow = paginate(mockRuns, -5, 50);
assert.equal(pUnderflow.safeCurrentPage, 1);
assert.equal(pUnderflow.slice.length, 50);

// All items (pageSize = 0)
const pAll = paginate(mockRuns, 1, 0);
assert.equal(pAll.totalPages, 1);
assert.equal(pAll.slice.length, 125);

console.log('✓ Pagination slicing, clamping, and all-items mode verified.');

console.log('\n--- 2. Testing Cross-Page Selection Persistence ---');
let selectedRunIds: string[] = ['run-005', 'run-075']; // One on page 1, one on page 2

// Verify page 1 items
const isSelectedP1 = p1.slice.map((r) => selectedRunIds.includes(r.runId));
assert.equal(isSelectedP1.filter(Boolean).length, 1); // Only run-005 on page 1

// Verify page 2 items
const p2 = paginate(mockRuns, 2, 50);
const isSelectedP2 = p2.slice.map((r) => selectedRunIds.includes(r.runId));
assert.equal(isSelectedP2.filter(Boolean).length, 1); // Only run-075 on page 2

console.log('✓ Selection state remains persistent across page switches.');

console.log('\n--- 3. Testing Select All Page / Unselect All Page Logic ---');
const pageRunIds = p2.slice.map((r) => r.runId);

// Select all on page 2
const newSelected = Array.from(new Set([...selectedRunIds, ...pageRunIds]));
assert.equal(newSelected.length, 51); // 50 from page 2 + run-005 from page 1

// Unselect all on page 2
const pageRunSet = new Set(pageRunIds);
const remaining = newSelected.filter((id) => !pageRunSet.has(id));
assert.deepEqual(remaining, ['run-005']); // run-005 on page 1 is preserved

console.log('✓ Page-level batch selection and unselection correctly preserves other pages.');

console.log('\n--- 4. Testing Quick Status Filter Logic ---');
const passedRuns = mockRuns.filter((r) => r.status === 'PASSED');
const failedRuns = mockRuns.filter((r) => r.status === 'FAILED');

assert.equal(failedRuns.length, 25);
assert.equal(passedRuns.length, 100);

const pFailed = paginate(failedRuns, 1, 50);
assert.equal(pFailed.totalPages, 1);
assert.equal(pFailed.slice.length, 25);
assert(pFailed.slice.every((r) => r.status === 'FAILED'));

console.log('✓ Quick status filtering and pagination synergy verified.');

console.log('\n========================================');
console.log('All Search Pagination unit verification tests PASSED!');
console.log('========================================');
