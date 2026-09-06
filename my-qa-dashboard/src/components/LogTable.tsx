import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  AlignLeft,
  Check,
  Copy,
  FileUp,
  Filter,
  History,
  Info,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  ShieldAlert,
  WrapText,
  X,
} from 'lucide-react';
import { parseUeLogText } from '../utils/ueLogParser';
import {
  buildLogSearchCondition,
  escapeSql,
  splitTextByMatches,
} from '../utils/logQueryHelpers';
import type { LogLevelFilter } from '../types';

interface Props {
  executeQuery: <T>(sql: string) => Promise<T[]>;
  loadRowsAsTable: (tableName: string, rows: Record<string, unknown>[]) => Promise<void>;
  /** True once the sample UE log has been parsed and loaded into UE_LOG_TABLE. */
  logsReady: boolean;
  dbReady: boolean;
  targetLine?: number | null;
  onSelectLine?: (lineNumber: number | null) => void;
}

export const UE_LOG_TABLE = 'ue_logs';

const LEVEL_STYLES: Record<string, { badge: string; text: string; rowBorder?: string }> = {
  FATAL: {
    badge: 'bg-red-950/80 text-red-300 border border-red-500/50 font-bold',
    text: 'text-red-300',
    rowBorder: 'border-l-2 border-l-red-500 bg-red-950/10',
  },
  ERROR: {
    badge: 'bg-red-500/20 text-red-400 border border-red-500/30 font-semibold',
    text: 'text-red-400',
    rowBorder: 'border-l-2 border-l-red-500/60 bg-red-950/5',
  },
  WARN: {
    badge: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    text: 'text-yellow-300',
    rowBorder: 'border-l-2 border-l-yellow-500/60 bg-yellow-950/5',
  },
  INFO: {
    badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
    text: 'text-slate-200',
  },
};

interface DisplayLogEntry {
  lineNumber: number;
  frame: number | null;
  timestamp: string;
  level: string;
  badgeLabel: string;
  category: string;
  message: string;
}

interface LevelCountRow {
  level: string;
  count: number;
}

interface CategoryCountRow {
  category: string;
  count: number;
}

export default function LogTable({
  executeQuery,
  loadRowsAsTable,
  logsReady,
  dbReady,
  targetLine,
  onSelectLine,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const searchInputId = useId();

  // Local file upload state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploadedEntryCount, setUploadedEntryCount] = useState(0);

  // Filter & Search states
  const [level, setLevel] = useState<LogLevelFilter>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [keyword, setKeyword] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [searchCategory, setSearchCategory] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);

  // Context View mode: shows ±N lines around a specific line
  const [contextTargetLine, setContextTargetLine] = useState<number | null>(null);
  const [contextRadius, setContextRadius] = useState(25);

  // UI display options
  const [wordWrap, setWordWrap] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  const [copiedLinkLine, setCopiedLinkLine] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Data & Query states
  const [rows, setRows] = useState<DisplayLogEntry[]>([]);
  const [querying, setQuerying] = useState(false);
  const [levelCounts, setLevelCounts] = useState<Record<string, number>>({
    ALL: 0,
    FATAL: 0,
    ERROR: 0,
    WARN: 0,
    INFO: 0,
  });
  const [categories, setCategories] = useState<CategoryCountRow[]>([]);

  const ready = logsReady || uploaded;

  // 1. Fetch metadata summary (level counts and categories) whenever data is loaded/overwritten
  const fetchMetadata = useCallback(async () => {
    if (!ready) return;
    try {
      // Query level counts
      const levelResults = await executeQuery<LevelCountRow>(`
        SELECT level, count(*) as count
        FROM ${UE_LOG_TABLE}
        WHERE type = 'log'
        GROUP BY level;
      `);
      const counts: Record<string, number> = { ALL: 0, FATAL: 0, ERROR: 0, WARN: 0, INFO: 0 };
      let total = 0;
      for (const row of levelResults) {
        counts[row.level] = Number(row.count);
        total += Number(row.count);
      }
      counts.ALL = total;
      setLevelCounts(counts);

      // Query categories
      const catResults = await executeQuery<CategoryCountRow>(`
        SELECT category, count(*) as count
        FROM ${UE_LOG_TABLE}
        WHERE type = 'log'
        GROUP BY category
        ORDER BY count DESC, category ASC;
      `);
      setCategories(catResults.map((r) => ({ category: r.category, count: Number(r.count) })));
    } catch (err) {
      console.error('Failed to load log metadata:', err);
    }
  }, [ready, executeQuery]);

  useEffect(() => {
    if (ready) {
      fetchMetadata();
    }
  }, [ready, fetchMetadata]);

  // 2. Fetch log rows matching current filters or context mode
  const runQuery = useCallback(async () => {
    if (!ready) return;
    setQuerying(true);
    setRegexError(null);

    try {
      // Context mode takes precedence when active
      if (contextTargetLine !== null) {
        const minLine = Math.max(1, contextTargetLine - contextRadius);
        const maxLine = contextTargetLine + contextRadius;
        const sql = `
          SELECT
            line_number AS "lineNumber",
            frame,
            COALESCE(timestamp_raw, '-') AS "timestamp",
            level,
            verbosity AS "badgeLabel",
            category,
            message
          FROM ${UE_LOG_TABLE}
          WHERE line_number BETWEEN ${minLine} AND ${maxLine}
          ORDER BY line_number ASC;
        `;
        const result = await executeQuery<DisplayLogEntry>(sql);
        setRows(result);
        return;
      }

      // Standard filtered query
      const searchRes = buildLogSearchCondition(
        { keyword, isRegex, caseSensitive, searchCategory },
        'message',
        'category',
      );

      if (!searchRes.isValid) {
        setRegexError(searchRes.errorMessage || 'Invalid regular expression');
        setRows([]);
        return;
      }

      const conditions: string[] = ["type = 'log'"];

      if (level !== 'ALL') {
        conditions.push(`level = '${escapeSql(level)}'`);
      }

      if (selectedCategory !== 'ALL') {
        conditions.push(`category = '${escapeSql(selectedCategory)}'`);
      }

      if (searchRes.sqlCondition !== '1=1') {
        conditions.push(searchRes.sqlCondition);
      }

      const whereClause = conditions.join(' AND ');
      const sql = `
        SELECT
          line_number AS "lineNumber",
          frame,
          COALESCE(timestamp_raw, '-') AS "timestamp",
          level,
          verbosity AS "badgeLabel",
          category,
          message
        FROM ${UE_LOG_TABLE}
        WHERE ${whereClause}
        ORDER BY line_number ASC
        LIMIT 2000;
      `;

      const result = await executeQuery<DisplayLogEntry>(sql);
      setRows(result);
    } catch (err) {
      console.error('Failed to execute log query:', err);
    } finally {
      setQuerying(false);
    }
  }, [
    ready,
    executeQuery,
    contextTargetLine,
    contextRadius,
    level,
    selectedCategory,
    keyword,
    isRegex,
    caseSensitive,
    searchCategory,
  ]);

  // Debounced query execution
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(runQuery, 180);
    return () => clearTimeout(timer);
  }, [ready, runQuery]);

  // Auto-scroll to targetLine when rows load or targetLine changes
  useEffect(() => {
    const focusLine = contextTargetLine ?? targetLine;
    if (!focusLine || rows.length === 0) return;
    const rowEl = document.getElementById(`log-row-${focusLine}`);
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [targetLine, contextTargetLine, rows]);

  // Handle local file upload
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
        setContextTargetLine(null);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
      }
    },
    [loadRowsAsTable],
  );

  // Copy line text to clipboard
  const handleCopyLine = useCallback(
    (entry: DisplayLogEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      const formatted = `[${entry.timestamp}][${entry.frame ?? '-'}] ${entry.category}: ${entry.badgeLabel}: ${entry.message}`;
      navigator.clipboard.writeText(formatted);
      setCopiedLine(entry.lineNumber);
      setToastMessage(`行 #${entry.lineNumber} のテキストをコピーしました`);
      setTimeout(() => {
        setCopiedLine((prev) => (prev === entry.lineNumber ? null : prev));
      }, 1800);
      setTimeout(() => {
        setToastMessage((prev) => (prev?.includes(`#${entry.lineNumber}`) ? null : prev));
      }, 2500);
    },
    [],
  );

  // Copy shareable URL link to clipboard
  const handleCopyLink = useCallback(
    (lineNumber: number, e?: React.MouseEvent) => {
      e?.stopPropagation();
      onSelectLine?.(lineNumber);
      const url = new URL(window.location.href);
      url.searchParams.set('log', String(lineNumber));
      navigator.clipboard.writeText(url.toString());
      setCopiedLinkLine(lineNumber);
      setToastMessage(`行 #${lineNumber} へのリンクをコピーしました`);
      setTimeout(() => {
        setCopiedLinkLine((prev) => (prev === lineNumber ? null : prev));
      }, 2000);
      setTimeout(() => {
        setToastMessage((prev) => (prev?.includes(`#${lineNumber}`) ? null : prev));
      }, 3000);
    },
    [onSelectLine],
  );

  // Open Context View for a specific line
  const handleOpenContext = useCallback((lineNumber: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setContextTargetLine(lineNumber);
  }, []);

  // Exit Context View
  const handleExitContext = useCallback(() => {
    setContextTargetLine(null);
  }, []);

  // Reset all filters
  const handleResetFilters = useCallback(() => {
    setLevel('ALL');
    setSelectedCategory('ALL');
    setKeyword('');
    setIsRegex(false);
    setCaseSensitive(false);
    setSearchCategory(false);
    setContextTargetLine(null);
    setRegexError(null);
  }, []);

  const hasActiveFilters =
    level !== 'ALL' ||
    selectedCategory !== 'ALL' ||
    keyword.trim() !== '' ||
    contextTargetLine !== null;

  // Memoized highlighted message renderer
  const renderMessageContent = useCallback(
    (msg: string) => {
      if (!keyword.trim() || regexError || contextTargetLine !== null) {
        return msg;
      }
      const chunks = splitTextByMatches(msg, keyword, isRegex, caseSensitive);
      return (
        <>
          {chunks.map((chunk, idx) =>
            chunk.match ? (
              <mark
                key={idx}
                className="bg-yellow-400/35 text-yellow-100 font-semibold px-0.5 rounded"
              >
                {chunk.text}
              </mark>
            ) : (
              <span key={idx}>{chunk.text}</span>
            ),
          )}
        </>
      );
    },
    [keyword, regexError, isRegex, caseSensitive, contextTargetLine],
  );

  return (
    <div
      className={`flex flex-col transition-all ${
        isExpanded
          ? 'fixed inset-4 z-50 rounded-xl border border-slate-700 bg-slate-950 p-5 shadow-2xl overflow-hidden'
          : 'h-full'
      }`}
    >
      {/* Top action bar: File upload & View customization */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          {isExpanded && (
            <span className="text-sm font-semibold text-slate-200 mr-2 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400"></span>
              Log Analyzer (Fullscreen)
            </span>
          )}
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
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {parsing ? <Loader2 size={14} className="animate-spin text-cyan-400" /> : <FileUp size={14} />}
            {parsing ? 'ログ解析中...' : 'ローカルのUEログを開く'}
          </button>

          {uploaded && uploadedFileName && (
            <span className="text-xs text-slate-400">
              <span className="text-cyan-400 font-semibold">{uploadedFileName}</span> (
              {uploadedEntryCount.toLocaleString()} 行)
            </span>
          )}
        </div>

        {/* View toggles: Word wrap & Expand/Fullscreen */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWordWrap(!wordWrap)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              wordWrap
                ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300'
                : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
            title={wordWrap ? '折り返し中 (クリックで横スクロール)' : '横スクロール中 (クリックで折り返し)'}
          >
            {wordWrap ? <WrapText size={14} /> : <AlignLeft size={14} />}
            <span>{wordWrap ? 'Wrap' : 'No Wrap'}</span>
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              isExpanded
                ? 'border-cyan-500/50 bg-cyan-950/40 text-cyan-300 font-semibold'
                : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
            title={isExpanded ? '通常表示に戻す' : '全画面に拡大表示'}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span>{isExpanded ? '縮小' : '拡大'}</span>
          </button>
        </div>
      </div>

      {parseError && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={15} className="text-red-400 shrink-0" />
          <span>解析エラー: {parseError}</span>
        </div>
      )}

      {/* Level statistics bar: Pill buttons */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-400 mr-1 font-medium select-none">Levels:</span>

        {/* ALL */}
        <button
          onClick={() => {
            setLevel('ALL');
            if (contextTargetLine !== null) setContextTargetLine(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
            level === 'ALL' && contextTargetLine === null
              ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500'
              : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          All
          <span className="rounded-full bg-slate-700/80 px-1.5 py-0.2 text-[10px] text-slate-300">
            {levelCounts.ALL.toLocaleString()}
          </span>
        </button>

        {/* FATAL */}
        <button
          onClick={() => {
            setLevel('FATAL');
            if (contextTargetLine !== null) setContextTargetLine(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
            level === 'FATAL' && contextTargetLine === null
              ? 'bg-red-950 text-red-200 ring-1 ring-red-500'
              : levelCounts.FATAL > 0
                ? 'bg-red-950/40 text-red-400 border border-red-500/30 hover:bg-red-900/40'
                : 'bg-slate-800/60 text-slate-500 hover:bg-slate-800 hover:text-slate-400'
          }`}
        >
          <ShieldAlert size={12} className={levelCounts.FATAL > 0 ? 'text-red-400' : ''} />
          Fatal
          <span
            className={`rounded-full px-1.5 py-0.2 text-[10px] ${
              levelCounts.FATAL > 0 ? 'bg-red-500/30 text-red-200 font-bold' : 'bg-slate-700/80 text-slate-400'
            }`}
          >
            {levelCounts.FATAL.toLocaleString()}
          </span>
        </button>

        {/* ERROR */}
        <button
          onClick={() => {
            setLevel('ERROR');
            if (contextTargetLine !== null) setContextTargetLine(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
            level === 'ERROR' && contextTargetLine === null
              ? 'bg-red-900/50 text-red-200 ring-1 ring-red-400'
              : levelCounts.ERROR > 0
                ? 'bg-red-950/30 text-red-400 border border-red-500/20 hover:bg-red-900/30'
                : 'bg-slate-800/60 text-slate-500 hover:bg-slate-800 hover:text-slate-400'
          }`}
        >
          <AlertCircle size={12} className={levelCounts.ERROR > 0 ? 'text-red-400' : ''} />
          Error
          <span
            className={`rounded-full px-1.5 py-0.2 text-[10px] ${
              levelCounts.ERROR > 0 ? 'bg-red-500/30 text-red-200 font-bold' : 'bg-slate-700/80 text-slate-400'
            }`}
          >
            {levelCounts.ERROR.toLocaleString()}
          </span>
        </button>

        {/* WARN */}
        <button
          onClick={() => {
            setLevel('WARN');
            if (contextTargetLine !== null) setContextTargetLine(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
            level === 'WARN' && contextTargetLine === null
              ? 'bg-yellow-950/60 text-yellow-200 ring-1 ring-yellow-400'
              : levelCounts.WARN > 0
                ? 'bg-yellow-950/30 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-900/30'
                : 'bg-slate-800/60 text-slate-500 hover:bg-slate-800 hover:text-slate-400'
          }`}
        >
          <AlertTriangle size={12} className={levelCounts.WARN > 0 ? 'text-yellow-400' : ''} />
          Warn
          <span
            className={`rounded-full px-1.5 py-0.2 text-[10px] ${
              levelCounts.WARN > 0 ? 'bg-yellow-500/30 text-yellow-200 font-semibold' : 'bg-slate-700/80 text-slate-400'
            }`}
          >
            {levelCounts.WARN.toLocaleString()}
          </span>
        </button>

        {/* INFO */}
        <button
          onClick={() => {
            setLevel('INFO');
            if (contextTargetLine !== null) setContextTargetLine(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all ${
            level === 'INFO' && contextTargetLine === null
              ? 'bg-blue-950/60 text-blue-300 ring-1 ring-blue-400'
              : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          <Info size={12} />
          Info
          <span className="rounded-full bg-slate-700/80 px-1.5 py-0.2 text-[10px] text-slate-300">
            {levelCounts.INFO.toLocaleString()}
          </span>
        </button>
      </div>

      {/* Filter and Search controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        {/* Category dropdown */}
        <div className="flex items-center gap-1.5">
          <Filter size={15} className="text-slate-400 shrink-0" />
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              if (contextTargetLine !== null) setContextTargetLine(null);
            }}
            className="bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 min-w-36 max-w-56"
            title="UEログのカテゴリで絞り込み"
          >
            <option value="ALL">All Categories ({categories.length})</option>
            {categories.map((cat) => (
              <option key={cat.category} value={cat.category}>
                {cat.category} ({cat.count})
              </option>
            ))}
          </select>
        </div>

        {/* Search Input with regex & case toggle */}
        <div className="relative flex-1 min-w-64">
          <label htmlFor={searchInputId} className="sr-only">
            メッセージまたはカテゴリを検索
          </label>
          <Search
            size={15}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            id={searchInputId}
            type="text"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              if (contextTargetLine !== null) setContextTargetLine(null);
            }}
            placeholder={
              isRegex
                ? 'Search with regular expression (e.g. Log.*Failed|Error)...'
                : 'Search messages...'
            }
            className={`w-full bg-slate-800 border rounded-md pl-8 pr-20 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none ${
              regexError
                ? 'border-red-500/80 focus:border-red-400 ring-1 ring-red-500/40'
                : 'border-slate-700 focus:border-cyan-500'
            }`}
          />

          {/* Inline toggles inside search input */}
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="p-1 text-slate-500 hover:text-slate-300 rounded"
                title="検索キーワードをクリア"
              >
                <X size={13} />
              </button>
            )}

            {/* Case Sensitivity toggle (Aa) */}
            <button
              type="button"
              onClick={() => setCaseSensitive(!caseSensitive)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold transition-colors ${
                caseSensitive
                  ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title={caseSensitive ? '大文字小文字を区別 (有効)' : '大文字小文字を無視 (無効)'}
            >
              Aa
            </button>

            {/* Regex toggle (.*) */}
            <button
              type="button"
              onClick={() => setIsRegex(!isRegex)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold transition-colors ${
                isRegex
                  ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title={isRegex ? '正規表現検索 (有効)' : '通常テキスト検索 (無効)'}
            >
              .*
            </button>
          </div>
        </div>

        {/* Search category checkbox */}
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={searchCategory}
            onChange={(e) => setSearchCategory(e.target.checked)}
            className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
          />
          <span>カテゴリも検索</span>
        </label>

        {/* Reset filters button */}
        {hasActiveFilters && (
          <button
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            title="すべてのフィルタと検索条件をリセット"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}

        <span className="text-xs text-slate-500 ml-auto whitespace-nowrap">
          {querying ? (
            <span className="inline-flex items-center gap-1 text-cyan-400">
              <Loader2 size={12} className="animate-spin" /> Querying...
            </span>
          ) : (
            `${rows.length.toLocaleString()} 行`
          )}
        </span>
      </div>

      {regexError && (
        <div className="mb-2 text-xs text-red-400 font-mono flex items-center gap-1.5">
          <AlertCircle size={13} className="shrink-0" />
          <span>正規表現エラー: {regexError}</span>
        </div>
      )}

      {/* Selected line banner with copy link button */}
      {targetLine !== null && targetLine !== undefined && targetLine > 0 && (
        <div className="mb-2.5 flex items-center justify-between rounded-md border border-cyan-500/35 bg-cyan-950/25 px-3 py-1.5 text-xs text-cyan-200">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            <span>
              行 <strong className="text-white font-mono font-semibold">#{targetLine}</strong> を選択中（URLに記録済み）
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => handleCopyLink(targetLine, e)}
              className="inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-900/50 px-2.5 py-1 text-xs font-medium text-cyan-100 hover:bg-cyan-800/80 hover:text-white transition-colors"
              title={`行 #${targetLine} への共有リンク (URL) をコピー`}
            >
              {copiedLinkLine === targetLine ? (
                <Check size={13} className="text-green-400" />
              ) : (
                <Link2 size={13} />
              )}
              <span>{copiedLinkLine === targetLine ? 'リンクコピー完了!' : 'この行のリンクをコピー'}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectLine?.(null)}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded"
              title="行の選択を解除"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Context mode active notification banner */}
      {contextTargetLine !== null && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-cyan-500/50 bg-cyan-950/40 px-3.5 py-2 text-xs text-cyan-200">
          <div className="flex items-center gap-2">
            <History size={16} className="text-cyan-400 shrink-0" />
            <span>
              行 <strong className="text-white font-mono">#{contextTargetLine}</strong> の前後{' '}
              {contextRadius} 行のコンテキストを表示中（合計 {rows.length} 行）
            </span>
            <div className="flex items-center gap-1 ml-3">
              <span className="text-slate-400">範囲:</span>
              {[15, 25, 50].map((radius) => (
                <button
                  key={radius}
                  onClick={() => setContextRadius(radius)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${
                    contextRadius === radius
                      ? 'bg-cyan-500/30 text-white font-bold'
                      : 'text-cyan-400/70 hover:text-cyan-200'
                  }`}
                >
                  ±{radius}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleExitContext}
            className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-900/60 px-2.5 py-1 text-xs text-cyan-100 hover:bg-cyan-800 transition-colors"
          >
            <X size={13} />
            コンテキスト終了
          </button>
        </div>
      )}

      {/* Log rows table */}
      <div
        ref={tableContainerRef}
        className={`overflow-y-auto overflow-x-auto rounded-md border border-slate-800 bg-slate-950/40 ${
          isExpanded ? 'flex-1 min-h-[500px]' : 'max-h-[520px]'
        }`}
      >
        <table className="w-full table-fixed text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-900 z-20 border-b border-slate-800 shadow-sm">
            <tr className="text-left text-slate-400 select-none">
              <th className="px-2 py-2 w-12 font-medium text-slate-500 text-right">#</th>
              <th className="hidden sm:table-cell px-2 py-2 w-14 font-medium text-center">Frame</th>
              <th className="hidden md:table-cell px-2.5 py-2 w-32 font-medium">Timestamp</th>
              <th className="px-2 py-2 w-16 font-medium text-center">Level</th>
              <th className="px-2.5 py-2 w-36 lg:w-44 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Message</th>
              <th className="sticky right-0 bg-slate-900 px-2 py-2 w-24 font-medium text-center shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.3)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40 font-mono">
            {rows.map((row) => {
              const isSelected = targetLine !== null && targetLine !== undefined && row.lineNumber === targetLine;
              const isContextCenter = contextTargetLine === row.lineNumber;
              const style = LEVEL_STYLES[row.level] ?? LEVEL_STYLES.INFO;

              return (
                <tr
                  key={row.lineNumber}
                  id={`log-row-${row.lineNumber}`}
                  onClick={() => onSelectLine?.(row.lineNumber)}
                  className={`group cursor-pointer transition-colors ${style.rowBorder ?? ''} ${
                    isContextCenter
                      ? 'bg-cyan-950/80 border-cyan-400 ring-2 ring-inset ring-cyan-400 text-white'
                      : isSelected
                        ? 'bg-cyan-950/60 border-cyan-500/80 ring-1 ring-inset ring-cyan-500/50 text-slate-100'
                        : 'hover:bg-slate-800/40'
                  }`}
                >
                  {/* Line Number */}
                  <td className="px-2 py-1.5 text-right text-slate-500 select-none tabular-nums text-[11px] truncate">
                    {row.lineNumber}
                  </td>

                  {/* Frame */}
                  <td className="hidden sm:table-cell px-2 py-1.5 text-center text-slate-400 tabular-nums truncate">
                    {row.frame ?? '-'}
                  </td>

                  {/* Timestamp */}
                  <td className="hidden md:table-cell px-2.5 py-1.5 text-slate-400 tabular-nums whitespace-nowrap text-[11px] truncate">
                    {row.timestamp}
                  </td>

                  {/* Level Badge */}
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] tracking-wider uppercase font-semibold ${style.badge}`}
                    >
                      {row.badgeLabel || row.level}
                    </span>
                  </td>

                  {/* Category */}
                  <td className="px-2.5 py-1.5 text-slate-300 text-xs">
                    <div className="truncate" title={row.category}>
                      <span className="text-cyan-400/90 hover:underline">{row.category}</span>
                    </div>
                  </td>

                  {/* Message */}
                  <td
                    className={`px-3 py-1.5 leading-relaxed text-xs break-all break-words ${
                      wordWrap ? 'whitespace-pre-wrap' : 'whitespace-nowrap'
                    } ${style.text}`}
                  >
                    {renderMessageContent(row.message)}
                  </td>

                  {/* Action buttons (Copy link, Context view & Copy text) */}
                  <td
                    className={`sticky right-0 px-2 py-1.5 text-center whitespace-nowrap shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.3)] transition-colors ${
                      isContextCenter
                        ? 'bg-cyan-950'
                        : isSelected
                          ? 'bg-cyan-950/90'
                          : 'bg-slate-950 group-hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                      {/* Copy Link Button */}
                      <button
                        type="button"
                        onClick={(e) => handleCopyLink(row.lineNumber, e)}
                        className={`p-1 rounded transition-colors ${
                          copiedLinkLine === row.lineNumber
                            ? 'text-green-400 bg-green-950/40'
                            : isSelected
                              ? 'text-cyan-300 hover:text-white hover:bg-cyan-900/60'
                              : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800'
                        }`}
                        title={`行 #${row.lineNumber} への共有リンク (URL) をコピー`}
                      >
                        {copiedLinkLine === row.lineNumber ? (
                          <Check size={14} className="text-green-400" />
                        ) : (
                          <Link2 size={14} />
                        )}
                      </button>

                      {/* Context View Button */}
                      <button
                        type="button"
                        onClick={(e) => handleOpenContext(row.lineNumber, e)}
                        className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
                        title={`行 #${row.lineNumber} の前後 ${contextRadius} 行を表示 (Context View)`}
                      >
                        <History size={14} />
                      </button>

                      {/* Copy Text Button */}
                      <button
                        type="button"
                        onClick={(e) => handleCopyLine(row, e)}
                        className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                        title="このログ行のテキストをコピー"
                      >
                        {copiedLine === row.lineNumber ? (
                          <Check size={14} className="text-green-400" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-slate-500 font-sans">
                  {ready
                    ? regexError
                      ? '正規表現の構文が正しくありません。'
                      : '条件に一致するログが見つかりませんでした。'
                    : 'サンプルデータまたはUEログファイルを読み込んでログを表示してください。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-cyan-500/50 bg-slate-900/95 px-4 py-2.5 text-xs font-medium text-cyan-200 shadow-2xl backdrop-blur animate-in fade-in">
          <Check size={14} className="text-green-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
