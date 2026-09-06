import assert from 'node:assert/strict';

/**
 * Simulate the asynchronous initialization queueing pattern used in getDuckDB().
 */
class AsyncResourceQueue<T> {
  private instance: T | null = null;
  private initPromise: Promise<T> | null = null;
  private error: Error | null = null;
  private initFn: () => Promise<T>;

  constructor(initFn: () => Promise<T>) {
    this.initFn = initFn;
  }

  async get(): Promise<T> {
    if (this.instance) {
      return this.instance;
    }
    if (!this.initPromise) {
      this.initPromise = this.initFn()
        .then((res) => {
          this.instance = res;
          this.error = null;
          return res;
        })
        .catch((err: unknown) => {
          this.error = err instanceof Error ? err : new Error(String(err));
          this.initPromise = null;
          throw this.error;
        });
    }
    return this.initPromise;
  }
}

async function runTests() {
  console.log('--- 1. Testing Concurrent Calls While Initializing (Queueing) ---');
  let initCallCount = 0;
  let resolveInit!: (val: { dbId: string }) => void;

  const queue = new AsyncResourceQueue<{ dbId: string }>(() => {
    initCallCount++;
    return new Promise<{ dbId: string }>((resolve) => {
      resolveInit = resolve;
    });
  });

  // Start 3 concurrent callers before init completes (simulating loadRemoteFile, executeQuery, etc.)
  const call1 = queue.get();
  const call2 = queue.get();
  const call3 = queue.get();

  // Only one init should have started
  assert.equal(initCallCount, 1, 'Init function must only be called once');

  // Complete init
  resolveInit({ dbId: 'duckdb-instance-1' });

  const [res1, res2, res3] = await Promise.all([call1, call2, call3]);
  assert.equal(res1.dbId, 'duckdb-instance-1');
  assert.equal(res2.dbId, 'duckdb-instance-1');
  assert.equal(res3.dbId, 'duckdb-instance-1');
  console.log('✓ All 3 in-flight calls received the resolved DB instance.');

  console.log('\n--- 2. Testing Immediate Return When Already Initialized ---');
  const call4 = await queue.get();
  assert.equal(call4.dbId, 'duckdb-instance-1');
  assert.equal(initCallCount, 1, 'No additional init call should occur');
  console.log('✓ Subsequent calls return the cached DB instance immediately.');

  console.log('\n--- 3. Testing Error Propagation and Retry ---');
  let attempt = 0;
  const failingQueue = new AsyncResourceQueue<{ ok: boolean }>(async () => {
    attempt++;
    if (attempt === 1) {
      throw new Error('WASM compilation failed');
    }
    return { ok: true };
  });

  await assert.rejects(
    async () => {
      await failingQueue.get();
    },
    {
      message: 'WASM compilation failed',
    },
  );
  console.log('✓ Initial failure correctly propagated to caller.');

  // Second attempt should succeed after retry
  const retryRes = await failingQueue.get();
  assert.equal(retryRes.ok, true);
  console.log('✓ Retry after failure succeeded.');

  console.log('\n========================================');
  console.log('All DuckDB Queue unit verification tests PASSED!');
  console.log('========================================');
}

runTests();
