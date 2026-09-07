import { useCallback, useEffect, useState } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import type { DuckDBStatus } from '../types';

export const FPS_CSV_FILE = 'fps_metrics.csv';
export const MEMORY_CSV_FILE = 'memory_metrics.csv';

/** Convert Arrow cell values (BigInt, etc.) to plain JS values. */
function toPlain(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

let duckDbInstance: duckdb.AsyncDuckDB | null = null;
let duckDbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let duckDbError: Error | null = null;

async function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const base = import.meta.env.BASE_URL || '/';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const bundles: duckdb.DuckDBBundles = {
    mvp: {
      mainModule: `${cleanBase}duckdb-wasm/duckdb-mvp.wasm`,
      mainWorker: `${cleanBase}duckdb-wasm/duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${cleanBase}duckdb-wasm/duckdb-eh.wasm`,
      mainWorker: `${cleanBase}duckdb-wasm/duckdb-browser-eh.worker.js`,
    },
  };
  const bundle = await duckdb.selectBundle(bundles);
  const workerScriptUrl = new URL(bundle.mainWorker!, window.location.href).href;
  const workerBlobUrl = URL.createObjectURL(
    new Blob([`importScripts("${workerScriptUrl}");`], {
      type: 'text/javascript',
    }),
  );
  const worker = new Worker(workerBlobUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  const mainModuleUrl = new URL(bundle.mainModule, window.location.href).href;
  await db.instantiate(mainModuleUrl, bundle.pthreadWorker);
  URL.revokeObjectURL(workerBlobUrl);
  return db;
}

export async function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (duckDbInstance) {
    return duckDbInstance;
  }
  if (!duckDbPromise) {
    duckDbPromise = initDuckDB()
      .then((db) => {
        duckDbInstance = db;
        duckDbError = null;
        return db;
      })
      .catch((e: unknown) => {
        duckDbError = e instanceof Error ? e : new Error(String(e));
        duckDbPromise = null;
        throw duckDbError;
      });
  }
  return duckDbPromise;
}

export function useDuckDB() {
  const [status, setStatus] = useState<DuckDBStatus>(() => {
    if (duckDbInstance) return 'ready';
    if (duckDbError) return 'error';
    return 'loading';
  });
  const [error, setError] = useState<string | null>(() => {
    return duckDbError ? duckDbError.message : null;
  });

  useEffect(() => {
    let cancelled = false;

    getDuckDB()
      .then(() => {
        if (!cancelled) {
          setStatus('ready');
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Fetch a remote data file (CSV/JSON) and register it in DuckDB's virtual FS under `name`,
   * overwriting any previous registration of the same name.
   */
  const loadRemoteFile = useCallback(async (name: string, url: string) => {
    const db = await getDuckDB();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    await db.dropFile(name).catch(() => { });
    await db.registerFileBuffer(name, buf);
  }, []);

  /** Execute a SQL query and return rows as plain JS objects. */
  const executeQuery = useCallback(
    async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
      const db = await getDuckDB();
      const conn = await db.connect();
      try {
        const result = await conn.query(sql);
        const rows: T[] = [];
        for (const row of result) {
          const obj: Record<string, unknown> = {};
          for (const key of result.schema.fields.map((f) => f.name)) {
            obj[key] = toPlain(row[key]);
          }
          rows.push(obj as T);
        }
        return rows;
      } finally {
        await conn.close();
      }
    },
    [],
  );

  /**
   * Load an array of already-parsed plain JS objects directly into a real DuckDB table (replacing
   * any existing table of the same name), so it can be queried as `FROM tableName`. No
   * intermediate file round-trip: the rows are already structured, so encoding them to a file
   * format and decoding them back on every subsequent query would be pure overhead.
   *
   * `insertJSONFromPath` requires a single JSON document (a row-array `[{...}, ...]`), not
   * newline-delimited JSON. Rows are still encoded one at a time straight into bytes (never
   * joined into a single JS string) because `JSON.stringify` on a large array of rows (e.g. a big
   * UE log) can exceed the JS engine's max string length and throw "Invalid string length".
   */
  const loadRowsAsTable = useCallback(
    async (tableName: string, rows: Record<string, unknown>[]) => {
      const db = await getDuckDB();

      if (rows.length === 0) {
        const conn = await db.connect();
        try {
          await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
          await conn.query(`
            CREATE TABLE IF NOT EXISTS ${tableName} (
              line_number INTEGER,
              frame INTEGER,
              timestamp_raw VARCHAR,
              level VARCHAR,
              verbosity VARCHAR,
              category VARCHAR,
              message VARCHAR,
              type VARCHAR
            )
          `);
        } finally {
          await conn.close();
        }
        return;
      }

      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const jsonFile = `${tableName}_staging_${uniqueSuffix}.json`;
      const encoder = new TextEncoder();
      const chunks: Uint8Array[] = new Array(rows.length + 2);
      chunks[0] = encoder.encode('[');
      let totalLength = chunks[0].length;
      for (let i = 0; i < rows.length; i++) {
        const chunk = encoder.encode((i === 0 ? '' : ',') + JSON.stringify(rows[i]));
        chunks[i + 1] = chunk;
        totalLength += chunk.length;
      }
      chunks[rows.length + 1] = encoder.encode(']');
      totalLength += chunks[rows.length + 1].length;
      const buf = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        buf.set(chunk, offset);
        offset += chunk.length;
      }
      await db.registerFileBuffer(jsonFile, buf);
      const conn = await db.connect();
      try {
        await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
        await conn.insertJSONFromPath(jsonFile, { name: tableName });
      } finally {
        await conn.close();
        await db.dropFile(jsonFile).catch(() => { });
      }
    },
    [],
  );

  /**
   * Register a locally opened file under `name` (e.g. FPS_CSV_FILE), overwriting any previous
   * registration of the same name so existing queries like `FROM '<name>'` keep working unchanged.
   */
  const loadLocalCsvFile = useCallback(async (name: string, file: File) => {
    const db = await getDuckDB();
    const buf = new Uint8Array(await file.arrayBuffer());
    await db.dropFile(name).catch(() => { });
    await db.registerFileBuffer(name, buf);
  }, []);

  /** Drop a file registered in DuckDB's virtual FS under `name`. */
  const dropFile = useCallback(async (name: string) => {
    const db = await getDuckDB();
    await db.dropFile(name).catch(() => { });
  }, []);

  return {
    status,
    error,
    loadRemoteFile,
    dropFile,
    executeQuery,
    loadRowsAsTable,
    loadLocalCsvFile,
  };
}
