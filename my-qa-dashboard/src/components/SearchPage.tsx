import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  FolderOpen,
  Loader2,
  RotateCcw,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { searchService } from '../services';
import type { SearchFilter, TestRunSummary } from '../services';

const PLATFORMS = ['PS5', 'Windows', 'iOS'];
const STATUSES = ['PASSED', 'FAILED', 'ABORTED'];

type SortField = 'timestamp' | 'runId' | 'gameVersion' | 'platform' | 'testName' | 'status';
type SortOrder = 'asc' | 'desc';

interface Props {
  onOpenRun: (run: TestRunSummary) => void;
  onCompareRuns?: (runAId: string, runBId: string) => void;
  initialFilters?: {
    testName?: string;
    gameVersion?: string;
    platform?: string;
    status?: string;
  };
  onFilterChange?: (filters: {
    testName?: string;
    gameVersion?: string;
    platform?: string;
    status?: string;
  }) => void;
}

export default function SearchPage({
  onOpenRun,
  onCompareRuns,
  initialFilters,
  onFilterChange,
}: Props) {
  const [testName, setTestName] = useState(initialFilters?.testName || '');
  const [gameVersion, setGameVersion] = useState(initialFilters?.gameVersion || '');
  const [platform, setPlatform] = useState(initialFilters?.platform || '');
  const [status, setStatus] = useState(initialFilters?.status || '');

  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);

  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const runSearchWith = useCallback(
    async (filters: SearchFilter) => {
      setSearching(true);
      setSearchError(null);
      try {
        const results = await searchService.searchRuns({
          limit: 500,
          ...filters,
        });
        setRuns(results);
        setSearched(true);
        setCurrentPage(1);
        onFilterChange?.(filters);
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : String(e));
      } finally {
        setSearching(false);
      }
    },
    [onFilterChange],
  );

  const runSearch = useCallback(() => {
    return runSearchWith({
      testName: testName || undefined,
      gameVersion: gameVersion || undefined,
      platform: platform || undefined,
      status: status || undefined,
    });
  }, [runSearchWith, testName, gameVersion, platform, status]);

  const handleQuickStatus = (newStatus: string) => {
    setStatus(newStatus);
    void runSearchWith({
      testName: testName || undefined,
      gameVersion: gameVersion || undefined,
      platform: platform || undefined,
      status: newStatus || undefined,
    });
  };

  // Sync form inputs and execute search when initialFilters change (including browser back/forward)
  useEffect(() => {
    const nextTestName = initialFilters?.testName || '';
    const nextGameVersion = initialFilters?.gameVersion || '';
    const nextPlatform = initialFilters?.platform || '';
    const nextStatus = initialFilters?.status || '';

    setTestName(nextTestName);
    setGameVersion(nextGameVersion);
    setPlatform(nextPlatform);
    setStatus(nextStatus);

    void runSearchWith({
      testName: nextTestName || undefined,
      gameVersion: nextGameVersion || undefined,
      platform: nextPlatform || undefined,
      status: nextStatus || undefined,
    });
  }, [
    initialFilters?.testName,
    initialFilters?.gameVersion,
    initialFilters?.platform,
    initialFilters?.status,
    runSearchWith,
  ]);


  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runSearch();
  };

  const handleReset = () => {
    setTestName('');
    setGameVersion('');
    setPlatform('');
    setStatus('');
    void runSearchWith({});
  };

  const handleFilterByTestName = (name: string) => {
    setTestName(name);
    void runSearchWith({
      testName: name,
      gameVersion: gameVersion || undefined,
      platform: platform || undefined,
      status: status || undefined,
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'timestamp') {
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else {
        const valA = a[sortField] || '';
        const valB = b[sortField] || '';
        cmp = valA.localeCompare(valB);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [runs, sortField, sortOrder]);

  const totalItems = sortedRuns.length;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = pageSize > 0 ? (safeCurrentPage - 1) * pageSize : 0;
  const endIndex = pageSize > 0 ? Math.min(startIndex + pageSize, totalItems) : totalItems;

  const paginatedRuns = useMemo(() => {
    return pageSize > 0 ? sortedRuns.slice(startIndex, endIndex) : sortedRuns;
  }, [sortedRuns, startIndex, endIndex, pageSize]);

  const isAllPageSelected = useMemo(() => {
    if (paginatedRuns.length === 0) return false;
    return paginatedRuns.every((r) => selectedRunIds.includes(r.runId));
  }, [paginatedRuns, selectedRunIds]);

  const isSomePageSelected = useMemo(() => {
    return !isAllPageSelected && paginatedRuns.some((r) => selectedRunIds.includes(r.runId));
  }, [paginatedRuns, selectedRunIds, isAllPageSelected]);

  const toggleSelectAllPage = () => {
    if (isAllPageSelected) {
      const pageRunIds = new Set(paginatedRuns.map((r) => r.runId));
      setSelectedRunIds((prev) => prev.filter((id) => !pageRunIds.has(id)));
    } else {
      const newIds = new Set([...selectedRunIds, ...paginatedRuns.map((r) => r.runId)]);
      setSelectedRunIds(Array.from(newIds));
    }
  };

  const toggleSelectRun = (runId: string) => {
    setSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId],
    );
  };

  const clearSelection = () => setSelectedRunIds([]);

  const handleCompareSelected = () => {
    if (selectedRunIds.length === 2 && onCompareRuns) {
      onCompareRuns(selectedRunIds[0], selectedRunIds[1]);
    }
  };

  const handleCompareWith = (targetRunId: string) => {
    if (selectedRunIds.length === 1 && onCompareRuns) {
      onCompareRuns(selectedRunIds[0], targetRunId);
    } else {
      setSelectedRunIds([targetRunId]);
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} className="text-slate-600 group-hover:text-slate-400 ml-1" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp size={12} className="text-cyan-400 ml-1" />
    ) : (
      <ArrowDown size={12} className="text-cyan-400 ml-1" />
    );
  };

  const hasActiveFilters = Boolean(testName || gameVersion || platform || status);

  return (
    <div className="p-6 space-y-6">
      {/* Search filter form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3"
      >
        <div className="flex flex-wrap items-end gap-4">
          {/* Test Name Filter */}
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            <span className="flex items-center gap-1 font-medium text-slate-300">
              <Filter size={12} className="text-cyan-400" /> Test Name (テストケース)
            </span>
            <input
              type="text"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder="Level1_Playthrough"
              className="w-56 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            />
          </label>

          {/* Game Version */}
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Game Version
            <input
              type="text"
              value={gameVersion}
              onChange={(e) => setGameVersion(e.target.value)}
              placeholder="v1.2.0"
              className="w-36 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </label>

          {/* Platform */}
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Platform
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-36 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">All Platforms</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          {/* Status */}
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-32 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={searching}
              className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              検索
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleReset}
                disabled={searching}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                title="フィルタをクリア"
              >
                <RotateCcw size={14} /> クリア
              </button>
            )}
          </div>
        </div>

        {/* Quick status filter chips */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60 text-xs">
          <span className="text-slate-500">クイック絞り込み:</span>
          <button
            type="button"
            onClick={() => handleQuickStatus('')}
            className={`rounded px-2 py-0.5 transition-colors cursor-pointer ${
              status === ''
                ? 'bg-slate-700 text-white font-medium'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => handleQuickStatus('PASSED')}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors cursor-pointer ${
              status === 'PASSED'
                ? 'bg-green-600/30 text-green-300 border border-green-500/50 font-medium'
                : 'bg-slate-800/80 text-slate-400 hover:text-green-400 hover:bg-slate-700/60'
            }`}
          >
            <CheckCircle2 size={11} className="text-green-400" /> PASSED のみ
          </button>
          <button
            type="button"
            onClick={() => handleQuickStatus('FAILED')}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors cursor-pointer ${
              status === 'FAILED'
                ? 'bg-red-600/30 text-red-300 border border-red-500/50 font-medium'
                : 'bg-slate-800/80 text-slate-400 hover:text-red-400 hover:bg-slate-700/60'
            }`}
          >
            <XCircle size={11} className="text-red-400" /> FAILED のみ
          </button>
          <button
            type="button"
            onClick={() => handleQuickStatus('ABORTED')}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors cursor-pointer ${
              status === 'ABORTED'
                ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50 font-medium'
                : 'bg-slate-800/80 text-slate-400 hover:text-amber-400 hover:bg-slate-700/60'
            }`}
          >
            <AlertTriangle size={11} className="text-amber-400" /> ABORTED のみ
          </button>
        </div>

        {searchError && <p className="mt-3 text-sm text-red-400">検索エラー: {searchError}</p>}
      </form>

      {/* Floating or sticky selection action bar */}
      {selectedRunIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-700/60 bg-cyan-950/40 px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-cyan-300">{selectedRunIds.length} 件選択中</span>
            {selectedRunIds.length === 1 && (
              <span className="text-xs text-slate-400">
                比較したいもう1件のテストランを選択してください
              </span>
            )}
            {selectedRunIds.length === 2 && (
              <span className="text-xs text-slate-300 font-mono">
                {selectedRunIds[0]} ⇄ {selectedRunIds[1]}
              </span>
            )}
            {selectedRunIds.length > 2 && (
              <span className="text-xs text-amber-400">
                比較は2件まで選択できます (現在 {selectedRunIds.length} 件選択)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X size={14} /> 選択解除
            </button>
            <button
              onClick={handleCompareSelected}
              disabled={selectedRunIds.length !== 2}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowLeftRight size={14} /> 2件のテストを比較 (Compare)
            </button>
          </div>
        </div>
      )}

      {/* Results summary & table */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 px-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-300">
              全 {totalItems} 件のテストラン
            </span>
            {totalItems > 0 && (
              <span className="text-slate-500">
                ({startIndex + 1}〜{endIndex} 件目を表示)
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* 1ページあたりの件数セレクタ */}
            <div className="flex items-center gap-1.5">
              <span>表示件数:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs"
              >
                <option value={25}>25件</option>
                <option value={50}>50件</option>
                <option value={100}>100件</option>
                <option value={0}>全件</option>
              </select>
            </div>

            {/* ページネーションコントロール */}
            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage(1)}
                  disabled={safeCurrentPage <= 1}
                  className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                  title="最初のページ"
                >
                  <ChevronsLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safeCurrentPage <= 1}
                  className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                  title="前のページ"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-2 text-slate-300 font-medium">
                  {safeCurrentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage >= totalPages}
                  className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                  title="次のページ"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safeCurrentPage >= totalPages}
                  className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                  title="最後のページ"
                >
                  <ChevronsRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900">
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="px-3 py-2 w-10 text-center font-medium">
                  <input
                    type="checkbox"
                    checked={isAllPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isSomePageSelected;
                    }}
                    onChange={toggleSelectAllPage}
                    title="このページの全件を選択 / 解除"
                    className="rounded border-slate-700 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                  />
                </th>
                <th
                  onClick={() => handleSort('runId')}
                  className="px-3 py-2 font-medium cursor-pointer hover:text-slate-200 group transition-colors"
                >
                  <span className="inline-flex items-center">
                    Run ID {renderSortIcon('runId')}
                  </span>
                </th>
                <th
                  onClick={() => handleSort('timestamp')}
                  className="px-3 py-2 font-medium cursor-pointer hover:text-slate-200 group transition-colors"
                >
                  <span className="inline-flex items-center">
                    Timestamp (実行日時) {renderSortIcon('timestamp')}
                  </span>
                </th>
                <th
                  onClick={() => handleSort('gameVersion')}
                  className="px-3 py-2 font-medium cursor-pointer hover:text-slate-200 group transition-colors"
                >
                  <span className="inline-flex items-center">
                    Version {renderSortIcon('gameVersion')}
                  </span>
                </th>
                <th
                  onClick={() => handleSort('platform')}
                  className="px-3 py-2 font-medium cursor-pointer hover:text-slate-200 group transition-colors"
                >
                  <span className="inline-flex items-center">
                    Platform {renderSortIcon('platform')}
                  </span>
                </th>
                <th
                  onClick={() => handleSort('testName')}
                  className="px-3 py-2 font-medium cursor-pointer hover:text-slate-200 group transition-colors"
                >
                  <span className="inline-flex items-center">
                    Test Name (テストケース) {renderSortIcon('testName')}
                  </span>
                </th>
                <th
                  onClick={() => handleSort('status')}
                  className="px-3 py-2 font-medium cursor-pointer hover:text-slate-200 group transition-colors"
                >
                  <span className="inline-flex items-center">
                    Status {renderSortIcon('status')}
                  </span>
                </th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRuns.map((run) => {
                const isSelected = selectedRunIds.includes(run.runId);
                const isCurrentFilteredTestName = testName === run.testName;

                return (
                  <tr
                    key={run.runId}
                    className={`border-b border-slate-800/60 transition-colors ${
                      isSelected ? 'bg-cyan-950/40 border-cyan-800/50' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectRun(run.runId)}
                        className="rounded border-slate-700 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-200 font-medium font-mono">{run.runId}</td>
                    <td className="px-3 py-2 text-slate-400 tabular-nums">
                      <span className="text-slate-200 font-mono">
                        {run.timestamp.replace('T', ' ').replace('Z', '')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{run.gameVersion}</td>
                    <td className="px-3 py-2 text-slate-300">
                      <div>{run.platform}</div>
                      {run.deviceModel && (
                        <div className="text-[10px] text-slate-500 font-mono" title={run.deviceModel}>
                          {run.deviceModel}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-200 font-medium">{run.testName}</span>
                        {!isCurrentFilteredTestName && (
                          <button
                            type="button"
                            onClick={() => handleFilterByTestName(run.testName)}
                            title="このテストケースで絞り込む"
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-cyan-300 hover:bg-slate-800 border border-slate-700/60 transition-colors cursor-pointer"
                          >
                            <Filter size={9} />
                            絞り込み
                          </button>
                        )}
                      </div>
                      {run.durationSeconds !== undefined && (
                        <div className="text-[10px] text-slate-500">
                          {Math.floor(run.durationSeconds / 60)}m {Math.round(run.durationSeconds % 60)}s
                          {run.triggeredBy && ` (${run.triggeredBy})`}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {run.status === 'PASSED' && (
                        <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                          <CheckCircle2 size={12} /> PASSED
                        </span>
                      )}
                      {run.status === 'FAILED' && (
                        <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                          <XCircle size={12} /> FAILED
                        </span>
                      )}
                      {run.status === 'ABORTED' && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
                          <AlertTriangle size={12} /> ABORTED
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => onOpenRun(run)}
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-700 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                        >
                          <FolderOpen size={13} /> 開く
                        </button>

                        {selectedRunIds.length === 1 && !isSelected ? (
                          <button
                            onClick={() => handleCompareWith(run.runId)}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-600/70 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
                            title={`${selectedRunIds[0]} とこのRunを比較`}
                          >
                            <ArrowLeftRight size={13} /> これと比較
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleSelectRun(run.runId)}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? 'border-cyan-500 bg-cyan-900/40 text-cyan-300'
                                : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {isSelected ? '選択解除' : '比較対象'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    {searching
                      ? 'Searching...'
                      : searched
                        ? '条件に一致するテストランがありません。'
                        : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom pagination bar */}
        {pageSize > 0 && totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 px-1 pt-1">
            <span>
              {safeCurrentPage} / {totalPages} ページ ({totalItems} 件中 {startIndex + 1}〜{endIndex} 件目を表示)
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={safeCurrentPage <= 1}
                className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                title="最初のページ"
              >
                <ChevronsLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
                className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                title="前のページ"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 text-slate-300 font-medium">
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages}
                className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                title="次のページ"
              >
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safeCurrentPage >= totalPages}
                className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                title="最後のページ"
              >
                <ChevronsRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


