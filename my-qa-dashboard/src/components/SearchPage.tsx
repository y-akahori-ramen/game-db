import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { searchService } from '../services';
import type { TestRunSummary } from '../services';

const PLATFORMS = ['PS5', 'Windows', 'iOS'];
const STATUSES = ['PASSED', 'FAILED'];

interface Props {
  onOpenRun: (run: TestRunSummary) => void;
  onCompareRuns?: (runAId: string, runBId: string) => void;
}

export default function SearchPage({ onOpenRun, onCompareRuns }: Props) {
  const [gameVersion, setGameVersion] = useState('');
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState('');
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);

  const runSearch = useCallback(async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchService.searchRuns({
        gameVersion: gameVersion || undefined,
        platform: platform || undefined,
        status: status || undefined,
      });
      setRuns(results);
      setSearched(true);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [gameVersion, platform, status]);

  // Show all runs on first visit.
  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runSearch();
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

  return (
    <div className="p-6 space-y-6">
      {/* Search filter form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Game Version
            <input
              type="text"
              value={gameVersion}
              onChange={(e) => setGameVersion(e.target.value)}
              placeholder="v1.2.0"
              className="w-40 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </label>
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
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            検索
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

      {/* Results table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="px-3 py-2 w-10 text-center font-medium">#</th>
              <th className="px-3 py-2 font-medium">Run ID</th>
              <th className="px-3 py-2 font-medium">Timestamp</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Platform</th>
              <th className="px-3 py-2 font-medium">Test Name</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const isSelected = selectedRunIds.includes(run.runId);
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
                  <td className="px-3 py-2 text-slate-400 tabular-nums">{run.timestamp}</td>
                  <td className="px-3 py-2 text-slate-300">{run.gameVersion}</td>
                  <td className="px-3 py-2 text-slate-300">{run.platform}</td>
                  <td className="px-3 py-2 text-slate-300">{run.testName}</td>
                  <td className="px-3 py-2">
                    {run.status === 'PASSED' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                        <CheckCircle2 size={12} /> PASSED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                        <XCircle size={12} /> FAILED
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onOpenRun(run)}
                        className="inline-flex items-center gap-1 rounded-md border border-cyan-700 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10"
                      >
                        <FolderOpen size={13} /> 開く
                      </button>

                      {selectedRunIds.length === 1 && !isSelected ? (
                        <button
                          onClick={() => handleCompareWith(run.runId)}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-600/70 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20"
                          title={`${selectedRunIds[0]} とこのRunを比較`}
                        >
                          <ArrowLeftRight size={13} /> これと比較
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleSelectRun(run.runId)}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
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
    </div>
  );
}

