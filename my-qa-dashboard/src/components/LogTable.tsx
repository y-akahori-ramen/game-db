import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Search, Filter, FileUp, Loader2 } from 'lucide-react';
import { parseUeLogText } from '../utils/ueLogParser';
import type { LogLevelFilter } from '../types';

interface Props {
  executeQuery: <T>(sql: string) => Promise<T[]>;
  loadRowsAsTable: (tableName: string, rows: Record<string, unknown>[]) => Promise<void>;
  /** True once the sample UE log has been parsed and loaded into UE_LOG_TABLE. */
  logsReady: boolean;
  dbReady: boolean;
}

/** All logs (sample or uploaded) are loaded into this same table/schema; see ueLogParser.ts. */
export const UE_LOG_TABLE = 'ue_logs';
const LEVELS: LogLevelFilter[] = ['ALL', 'INFO', 'WARN', 'ERROR', 'FATAL'];

const LEVEL_STYLES: Record<string, string> = {
  INFO: 'bg-blue-500/15 text-blue-400',
  WARN: 'bg-yellow-500/15 text-yellow-400',
  ERROR: 'bg-red-500/15 text-red-400',
  FATAL: 'bg-red-700/30 text-red-300 font-bold',
};

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

interface DisplayLogEntry {
  frame: number | null;
  timestamp: string;
  level: string;
  badgeLabel: string;
  category: string;
  message: string;
}

export default function LogTable({
  executeQuery,
  loadRowsAsTable,
  logsReady,
  dbReady,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploadedEntryCount, setUploadedEntryCount] = useState(0);

  const [level, setLevel] = useState<LogLevelFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<DisplayLogEntry[]>([]);
  const [querying, setQuerying] = useState(false);

  // An uploaded log overwrites UE_LOG_TABLE, but either way it's the same schema/query.
  const ready = logsReady || uploaded;

  const runQuery = useCallback(async () => {
    setQuerying(true);
    try {
      const lv = escapeSql(level);
      const kw = escapeSql(keyword);
      const sql = `
        SELECT frame, COALESCE(timestamp_raw, '-') AS "timestamp", level, verbosity AS "badgeLabel", category, message
        FROM ${UE_LOG_TABLE}
        WHERE type = 'log'
          AND (level = '${lv}' OR '${lv}' = 'ALL')
          AND message LIKE '%${kw}%'
        ORDER BY line_number ASC
        LIMIT 2000;
      `;
      setRows(await executeQuery<DisplayLogEntry>(sql));
    } finally {
      setQuerying(false);
    }
  }, [executeQuery, level, keyword]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(runQuery, 200);
    return () => clearTimeout(timer);
  }, [ready, runQuery]);

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setParsing(true);
      setParseError(null);
      try {
        const text = await file.text();
        const entries = parseUeLogText(text);
        await loadRowsAsTable(UE_LOG_TABLE, entries as unknown as Record<string, unknown>[]);
        setUploadedFileName(file.name);
        setUploadedEntryCount(entries.length);
        setUploaded(true);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
      }
    },
    [loadRowsAsTable],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".log,.txt"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!dbReady || parsing}
          className="inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {parsing ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
          {parsing ? '解析中...' : 'ローカルのUEログを開く'}
        </button>
        {uploaded && uploadedFileName && (
          <span className="text-xs text-slate-500">
            {uploadedFileName} ({uploadedEntryCount.toLocaleString()} 行)
          </span>
        )}
      </div>

      {parseError && <p className="mb-3 text-sm text-red-400">解析エラー: {parseError}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as LogLevelFilter)}
            className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            {LEVELS.map((lv) => (
              <option key={lv} value={lv}>
                {lv === 'ALL' ? 'All Levels' : lv}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex-1 min-w-52">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search messages..."
            className="w-full bg-slate-800 border border-slate-700 rounded-md pl-9 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <span className="text-xs text-slate-500">
          {querying ? 'Querying...' : `${rows.length} rows`}
        </span>
      </div>

      <div className="overflow-y-auto max-h-96 rounded-md border border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="px-3 py-2 w-16 font-medium">Frame</th>
              <th className="px-3 py-2 w-32 font-medium">Timestamp</th>
              <th className="px-3 py-2 w-20 font-medium">Level</th>
              <th className="px-3 py-2 w-28 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-slate-800/60 hover:bg-slate-800/40"
              >
                <td className="px-3 py-1.5 text-slate-400 tabular-nums">{row.frame ?? '-'}</td>
                <td className="px-3 py-1.5 text-slate-400 tabular-nums">{row.timestamp}</td>
                <td className="px-3 py-1.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs ${LEVEL_STYLES[row.level] ?? ''}`}
                  >
                    {row.badgeLabel}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-300">{row.category}</td>
                <td className="px-3 py-1.5 text-slate-200 whitespace-pre-wrap">{row.message}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  {ready ? 'No logs match the filter.' : 'Load sample data or open a UE log to view logs.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
