import assert from 'node:assert/strict';

/**
 * Mock DuckDB virtual filesystem simulator to test concurrent Compare sessions.
 */
class MockDuckDbFs {
  private files = new Map<string, Uint8Array>();
  public dropCalls: string[] = [];
  public registerCalls: string[] = [];
  public queryHistory: string[] = [];

  async dropFile(name: string): Promise<void> {
    this.dropCalls.push(name);
    this.files.delete(name);
  }

  async registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
    this.registerCalls.push(name);
    this.files.set(name, buffer);
  }

  hasFile(name: string): boolean {
    return this.files.has(name);
  }

  async query(sql: string): Promise<void> {
    this.queryHistory.push(sql);
    // Simulate read_csv_auto check
    const matches = sql.matchAll(/read_csv_auto\('([^']+)'\)/g);
    for (const match of matches) {
      const fileName = match[1];
      if (!this.hasFile(fileName)) {
        throw new Error(
          `IO Error: No files found that match the pattern "${fileName}" LINE 10: FROM read_csv_auto('${fileName}') ^`,
        );
      }
    }
  }
}

function getExt(url: string): string {
  return url.endsWith('.json') ? 'json' : 'csv';
}

/**
 * Runner simulating ComparePage's loading logic
 */
async function simulateCompareLoad({
  fs,
  runAId,
  runBId,
  urlA,
  urlB,
  session,
  isCancelled,
  delayMs = 0,
}: {
  fs: MockDuckDbFs;
  runAId: string;
  runBId: string;
  urlA: string;
  urlB: string;
  session: string;
  isCancelled: () => boolean;
  delayMs?: number;
}) {
  const filesToDrop: string[] = [];

  const loadRemoteFile = async (name: string) => {
    await fs.dropFile(name);
    await fs.registerFileBuffer(name, new Uint8Array([1, 2, 3]));
  };

  try {
    if (isCancelled()) return { status: 'cancelled' };

    const fileAName = `compare_${runAId}_a_${session}.${getExt(urlA)}`;
    const fileBName = `compare_${runBId}_b_${session}.${getExt(urlB)}`;
    filesToDrop.push(fileAName, fileBName);

    // Concurrent file load
    await Promise.all([loadRemoteFile(fileAName), loadRemoteFile(fileBName)]);

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (isCancelled()) return { status: 'cancelled' };

    // Query both files
    await fs.query(
      `SELECT * FROM read_csv_auto('${fileAName}') JOIN read_csv_auto('${fileBName}') ON sec`,
    );

    if (isCancelled()) return { status: 'cancelled' };

    return { status: 'success', fileAName, fileBName };
  } finally {
    for (const file of filesToDrop) {
      await fs.dropFile(file);
    }
  }
}

async function runTests() {
  console.log('--- 1. Testing Concurrent Sessions with Session-Unique File Names ---');
  const fs = new MockDuckDbFs();

  // Two concurrent sessions comparing the same runs (e.g. StrictMode mount / rapid navigation)
  const session1 = 'sess_1';
  const session2 = 'sess_2';

  // Run both sessions concurrently with slight delay
  const p1 = simulateCompareLoad({
    fs,
    runAId: 'run-001',
    runBId: 'run-002',
    urlA: 'sample_data/run-001/fps_metrics.csv',
    urlB: 'sample_data/run-002/fps_metrics.csv',
    session: session1,
    isCancelled: () => false,
    delayMs: 20,
  });

  const p2 = simulateCompareLoad({
    fs,
    runAId: 'run-001',
    runBId: 'run-002',
    urlA: 'sample_data/run-001/fps_metrics.csv',
    urlB: 'sample_data/run-002/fps_metrics.csv',
    session: session2,
    isCancelled: () => false,
    delayMs: 10,
  });

  const [res1, res2] = await Promise.all([p1, p2]);
  assert.equal(res1.status, 'success');
  assert.equal(res2.status, 'success');

  // Verify file names were distinct and session-qualified
  assert.equal(res1.fileAName, 'compare_run-001_a_sess_1.csv');
  assert.equal(res1.fileBName, 'compare_run-002_b_sess_1.csv');
  assert.equal(res2.fileAName, 'compare_run-001_a_sess_2.csv');
  assert.equal(res2.fileBName, 'compare_run-002_b_sess_2.csv');
  console.log('✓ Concurrent sessions succeeded without dropping each other\'s files.');

  console.log('\n--- 2. Testing Self-Comparison Safety (runAId === runBId) ---');
  const sessionSelf = 'sess_self';
  const resSelf = await simulateCompareLoad({
    fs,
    runAId: 'run-001',
    runBId: 'run-001',
    urlA: 'sample_data/run-001/fps_metrics.csv',
    urlB: 'sample_data/run-001/fps_metrics.csv',
    session: sessionSelf,
    isCancelled: () => false,
  });

  assert.equal(resSelf.status, 'success');
  assert.notEqual(resSelf.fileAName, resSelf.fileBName);
  assert.equal(resSelf.fileAName, 'compare_run-001_a_sess_self.csv');
  assert.equal(resSelf.fileBName, 'compare_run-001_b_sess_self.csv');
  console.log('✓ Comparing run with itself produces distinct file names for A and B.');

  console.log('\n--- 3. Testing Cancellation and File Cleanup ---');
  let cancelled = false;
  const cancelFs = new MockDuckDbFs();

  const cancelPromise = simulateCompareLoad({
    fs: cancelFs,
    runAId: 'run-001',
    runBId: 'run-002',
    urlA: 'sample_data/run-001/fps_metrics.csv',
    urlB: 'sample_data/run-002/fps_metrics.csv',
    session: 'sess_cancel',
    isCancelled: () => cancelled,
    delayMs: 30,
  });

  // Cancel immediately after loadRemoteFile starts
  setTimeout(() => {
    cancelled = true;
  }, 5);

  const cancelResult = await cancelPromise;
  assert.equal(cancelResult.status, 'cancelled');
  // Temporary files must have been dropped in finally
  assert.equal(cancelFs.hasFile('compare_run-001_a_sess_cancel.csv'), false);
  assert.equal(cancelFs.hasFile('compare_run-002_b_sess_cancel.csv'), false);
  console.log('✓ Cancelled load aborted cleanly and dropped temporary files in finally.');

  console.log('\n--- 4. Reproducing Old Flaw (Static File Names Without Session) ---');
  // Demonstrate that the old design with static names fails under concurrency
  const staticFs = new MockDuckDbFs();
  let caughtOldError: Error | null = null;

  const oldLoad = async (nameA: string, nameB: string, delayMs: number) => {
    // 1. loadRemoteFile
    await staticFs.dropFile(nameA);
    await staticFs.registerFileBuffer(nameA, new Uint8Array([1]));
    await staticFs.dropFile(nameB);
    await staticFs.registerFileBuffer(nameB, new Uint8Array([2]));

    // Query delay simulating network / query execution
    await new Promise((r) => setTimeout(r, delayMs));

    // Execute query
    return staticFs.query(
      `SELECT * FROM read_csv_auto('${nameA}') JOIN read_csv_auto('${nameB}') ON sec`,
    );
  };

  const staticA = 'compare_run-001_fps.csv';
  const staticB = 'compare_run-002_fps.csv';

  try {
    // Op 1 starts
    const op1 = oldLoad(staticA, staticB, 25);
    // Op 2 starts shortly after and drops staticB before Op 1 queries
    await new Promise((r) => setTimeout(r, 5));
    const op2 = (async () => {
      // Op 2 begins and drops staticB while Op 1 is attempting to query it
      await staticFs.dropFile(staticB);
    })();

    await Promise.all([op1, op2]);
  } catch (err) {
    caughtOldError = err instanceof Error ? err : new Error(String(err));
  }

  assert.ok(caughtOldError, 'Old design must produce an error under concurrency');
  assert.match(caughtOldError.message, /No files found that match the pattern "compare_run-002_fps.csv"/);
  console.log('✓ Old race condition reproduced and verified: dropFile deleted file during concurrent load.');

  console.log('\n========================================');
  console.log('All Compare Concurrency unit verification tests PASSED!');
  console.log('========================================');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
