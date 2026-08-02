import { useCallback, useEffect, useState } from 'react';
import { Search, Filter } from 'lucide-react';
import type { LogEntry, LogLevelFilter } from '../types';

interface Props {
  executeQuery: <T>(sql: string) => Promise<T[]>;
  dataLoaded: boolean;
}

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

export default function LogTable({ executeQuery, dataLoaded }: Props) {
  const [level, setLevel] = useState<LogLevelFilter>('ALL');
  const [keyword, setKeyword] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [querying, setQuerying] = useState(false);

  const runQuery = useCallback(async () => {
    setQuerying(true);
    try {
      const lv = escapeSql(level);
      const kw = escapeSql(keyword);
      const sql = `
        SELECT timestamp, level, category, message
        FROM 'logs.parquet'
        WHERE (level = '${lv}' OR '${lv}' = 'ALL')
          AND message LIKE '%${kw}%'
        ORDER BY timestamp ASC;
      `;
      setLogs(await executeQuery<LogEntry>(sql));
    } finally {
      setQuerying(false);
    }
  }, [executeQuery, level, keyword]);

  useEffect(() => {
    if (!dataLoaded) return;
    const timer = setTimeout(runQuery, 200);
    return () => clearTimeout(timer);
  }, [dataLoaded, runQuery]);

  return (
    <div className="flex flex-col h-full">
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
          {querying ? 'Querying...' : `${logs.length} rows`}
        </span>
      </div>

      <div className="overflow-y-auto max-h-96 rounded-md border border-slate-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="px-3 py-2 w-24 font-medium">Time (s)</th>
              <th className="px-3 py-2 w-20 font-medium">Level</th>
              <th className="px-3 py-2 w-28 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr
                key={i}
                className="border-b border-slate-800/60 hover:bg-slate-800/40"
              >
                <td className="px-3 py-1.5 text-slate-400 tabular-nums">
                  {log.timestamp.toFixed(3)}
                </td>
                <td className="px-3 py-1.5">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs ${LEVEL_STYLES[log.level] ?? ''}`}
                  >
                    {log.level}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-300">{log.category}</td>
                <td className="px-3 py-1.5 text-slate-200">{log.message}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  {dataLoaded ? 'No logs match the filter.' : 'Load sample data to view logs.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
