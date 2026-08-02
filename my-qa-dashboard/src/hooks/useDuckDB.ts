import { useCallback, useEffect, useRef, useState } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import type { DuckDBStatus } from '../types';

export const FPS_CSV_FILE = 'fps_metrics.csv';
export const MEMORY_CSV_FILE = 'memory_metrics.csv';
const CSV_FILES = [FPS_CSV_FILE, MEMORY_CSV_FILE];

/** Convert Arrow cell values (BigInt, etc.) to plain JS values. */
function toPlain(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

export function useDuckDB() {
  const [status, setStatus] = useState<DuckDBStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);
  const initPromiseRef = useRef<Promise<duckdb.AsyncDuckDB> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<duckdb.AsyncDuckDB> {
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker!}");`], {
          type: 'text/javascript',
        }),
      );
      const worker = new Worker(workerUrl);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      return db;
    }

    if (!initPromiseRef.current) {
      initPromiseRef.current = init();
    }

    initPromiseRef.current
      .then((db) => {
        dbRef.current = db;
        if (!cancelled) setStatus('ready');
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

  /** Fetch CSV files from public/sample_data and register them in DuckDB's virtual FS. */
  const loadCsvFiles = useCallback(async () => {
    const db = dbRef.current;
    if (!db) throw new Error('DuckDB is not initialized yet');
    await Promise.all(
      CSV_FILES.map(async (name) => {
        const res = await fetch(`${import.meta.env.BASE_URL}sample_data/${name}`);
        if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        await db.registerFileBuffer(name, buf);
      }),
    );
  }, []);

  /** Execute a SQL query and return rows as plain JS objects. */
  const executeQuery = useCallback(
    async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
      const db = dbRef.current;
      if (!db) throw new Error('DuckDB is not initialized yet');
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
   */
  const loadRowsAsTable = useCallback(
    async (tableName: string, rows: Record<string, unknown>[]) => {
      const db = dbRef.current;
      if (!db) throw new Error('DuckDB is not initialized yet');
      const jsonFile = `${tableName}.staging.json`;
      await db.registerFileText(jsonFile, JSON.stringify(rows));
      const conn = await db.connect();
      try {
        await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
        await conn.insertJSONFromPath(jsonFile, { name: tableName });
      } finally {
        await conn.close();
        await db.dropFile(jsonFile);
      }
    },
    [],
  );

  /**
   * Register a locally opened file under `name` (e.g. FPS_CSV_FILE), overwriting any previous
   * registration of the same name so existing queries like `FROM '<name>'` keep working unchanged.
   */
  const loadLocalCsvFile = useCallback(async (name: string, file: File) => {
    const db = dbRef.current;
    if (!db) throw new Error('DuckDB is not initialized yet');
    const buf = new Uint8Array(await file.arrayBuffer());
    await db.dropFile(name).catch(() => { });
    await db.registerFileBuffer(name, buf);
  }, []);

  return {
    status,
    error,
    loadCsvFiles,
    executeQuery,
    loadRowsAsTable,
    loadLocalCsvFile,
  };
}
