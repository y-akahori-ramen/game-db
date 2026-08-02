import { useCallback, useEffect, useRef, useState } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import type { DuckDBStatus } from '../types';

const PARQUET_FILES = [
  'fps_metrics.parquet',
  'memory_metrics.parquet',
  'logs.parquet',
];

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

  /** Fetch parquet files from public/sample_data and register them in DuckDB's virtual FS. */
  const loadParquetFiles = useCallback(async () => {
    const db = dbRef.current;
    if (!db) throw new Error('DuckDB is not initialized yet');
    await Promise.all(
      PARQUET_FILES.map(async (name) => {
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
   * Convert an array of plain JS objects into a Parquet file inside DuckDB's virtual filesystem
   * (via a throwaway staging table + COPY TO), so it can be queried the same way as the sample
   * Parquet files, e.g. `FROM '${fileName}'`. The JS rows never live on beyond this call.
   */
  const loadRowsAsParquetFile = useCallback(
    async (fileName: string, rows: Record<string, unknown>[]) => {
      const db = dbRef.current;
      if (!db) throw new Error('DuckDB is not initialized yet');
      const jsonFile = `${fileName}.staging.json`;
      const stagingTable = `__staging_${fileName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      await db.registerFileText(jsonFile, JSON.stringify(rows));
      const conn = await db.connect();
      try {
        await conn.query(`DROP TABLE IF EXISTS ${stagingTable}`);
        await conn.insertJSONFromPath(jsonFile, { name: stagingTable });
        await conn.query(`COPY ${stagingTable} TO '${fileName}' (FORMAT PARQUET)`);
        await conn.query(`DROP TABLE ${stagingTable}`);
      } finally {
        await conn.close();
      }
    },
    [],
  );

  return {
    status,
    error,
    loadParquetFiles,
    executeQuery,
    loadRowsAsParquetFile,
  };
}
