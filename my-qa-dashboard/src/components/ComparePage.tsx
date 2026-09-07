import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileBox,
  Gauge,
  Loader2,
  MemoryStick,
  Minus,
  Share2,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { searchService } from '../services';
import type { TestRunSummary } from '../services';
import type { ComparisonSummary, DuckDBStatus, FpsDiffMetric } from '../types';
import {
  computeComparisonSummary,
  queryFpsComparison,
  queryMemoryComparison,
  type MemoryComparisonResult,
} from '../utils/diffQueries';
import {
  loadRegressionThresholds,
  type RegressionThresholdValues,
} from '../config/thresholds';
import FpsDiffChart from './FpsDiffChart';
import MemoryDiffChart from './MemoryDiffChart';

interface Props {
  runAId: string;
  runBId: string;
  onBackToSearch: () => void;
  onSwapRuns: () => void;
  loadRemoteFile: (name: string, url: string) => Promise<void>;
  executeQuery: <T>(sql: string) => Promise<T[]>;
  duckDbStatus: DuckDBStatus;
  getShareableUrl: (runIds: [string, string]) => string;
}

function getExt(url: string): string {
  return url.endsWith('.json') ? 'json' : 'csv';
}

export default function ComparePage({
  runAId,
  runBId,
  onBackToSearch,
  onSwapRuns,
  loadRemoteFile,
  executeQuery,
  duckDbStatus,
  getShareableUrl,
}: Props) {
  const [runA, setRunA] = useState<TestRunSummary | null>(null);
  const [runB, setRunB] = useState<TestRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fpsDiffData, setFpsDiffData] = useState<FpsDiffMetric[]>([]);
  const [memoryDiffData, setMemoryDiffData] = useState<MemoryComparisonResult | null>(null);
  const [summary, setSummary] = useState<ComparisonSummary | null>(null);
  const [thresholds, setThresholds] = useState<RegressionThresholdValues | null>(null);
  const [activeTab, setActiveTab] = useState<'fps' | 'memory' | 'artifacts'>('fps');
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    if (duckDbStatus !== 'ready') return;
    setLoading(true);
    setLoadError(null);

    try {
      const [summaryA, summaryB, loadedThresholds] = await Promise.all([
        searchService.getRun(runAId),
        searchService.getRun(runBId),
        loadRegressionThresholds(),
      ]);
      setThresholds(loadedThresholds);

      if (!summaryA) throw new Error(`Run A (${runAId}) が見つかりませんでした。`);
      if (!summaryB) throw new Error(`Run B (${runBId}) が見つかりませんでした。`);

      setRunA(summaryA);
      setRunB(summaryB);

      const base = import.meta.env.BASE_URL;

      // 1. Load and query FPS diff
      let fpsDiffs: FpsDiffMetric[] = [];
      if (summaryA.fpsDataUrl && summaryB.fpsDataUrl) {
        const fileAName = `compare_${runAId}_fps.${getExt(summaryA.fpsDataUrl)}`;
        const fileBName = `compare_${runBId}_fps.${getExt(summaryB.fpsDataUrl)}`;

        await Promise.all([
          loadRemoteFile(fileAName, `${base}${summaryA.fpsDataUrl}`),
          loadRemoteFile(fileBName, `${base}${summaryB.fpsDataUrl}`),
        ]);

        fpsDiffs = await queryFpsComparison(executeQuery, fileAName, fileBName);
        setFpsDiffData(fpsDiffs);
      } else {
        setFpsDiffData([]);
      }

      // 2. Load and query Memory diff
      let memoryResult: MemoryComparisonResult | null = null;
      if (summaryA.memoryDataUrl && summaryB.memoryDataUrl) {
        const memAName = `compare_${runAId}_mem.${getExt(summaryA.memoryDataUrl)}`;
        const memBName = `compare_${runBId}_mem.${getExt(summaryB.memoryDataUrl)}`;

        await Promise.all([
          loadRemoteFile(memAName, `${base}${summaryA.memoryDataUrl}`),
          loadRemoteFile(memBName, `${base}${summaryB.memoryDataUrl}`),
        ]);

        memoryResult = await queryMemoryComparison(executeQuery, memAName, memBName);
        setMemoryDiffData(memoryResult);
      } else {
        setMemoryDiffData(null);
      }

      // 3. Compute high-level summary and regression evaluation with external thresholds
      if (fpsDiffs.length > 0) {
        const computedSummary = computeComparisonSummary(
          fpsDiffs,
          memoryResult ? memoryResult.peakDiffs : [],
          loadedThresholds,
        );
        setSummary(computedSummary);
      } else {
        setSummary(null);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [duckDbStatus, runAId, runBId, loadRemoteFile, executeQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCopyLink = async () => {
    const url = getShareableUrl([runAId, runBId]);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('共有URLをコピーしてください:', url);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToSearch}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft size={16} /> 検索に戻る
          </button>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Gauge size={20} className="text-cyan-400" /> Test Run 比較 (Diff)
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSwapRuns}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 transition-colors"
            title="基準 (Run A) と ターゲット (Run B) を入れ替えます"
          >
            <ArrowLeftRight size={14} className="text-cyan-400" /> A ⇄ B を入れ替える
          </button>

          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 transition-colors"
            title="この比較結果のURLをコピー"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Share2 size={14} />}
            {copied ? 'コピー完了!' : '比較リンクをコピー'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex h-64 items-center justify-center gap-2 text-cyan-400 text-sm">
          <Loader2 size={24} className="animate-spin" />
          <span>DuckDB-WASM でメトリクスを突合中...</span>
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/40 p-4 text-sm text-red-300">
          比較データの読み込みエラー: {loadError}
        </div>
      )}

      {!loading && !loadError && runA && runB && (
        <>
          {/* Side-by-side metadata cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Run A (Baseline) Card */}
            <div className="rounded-lg border border-cyan-500/30 bg-slate-900/50 p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-cyan-500/20 text-cyan-400 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase rounded-bl">
                Run A (Baseline)
              </div>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="text-base font-bold text-slate-100">{runA.runId}</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{runA.testName}</p>
                </div>
                {runA.status === 'PASSED' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-400 font-medium">
                    <CheckCircle2 size={12} /> PASSED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400 font-medium">
                    <XCircle size={12} /> FAILED
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
                <div>
                  <span className="block text-[11px] text-slate-500">Version</span>
                  <span className="text-slate-200 font-medium">{runA.gameVersion}</span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">Platform</span>
                  <span className="text-slate-200 font-medium">{runA.platform}</span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">Timestamp</span>
                  <span className="text-slate-200 tabular-nums">{runA.timestamp.split('T')[0]}</span>
                </div>
              </div>
            </div>

            {/* Run B (Target) Card */}
            <div className="rounded-lg border border-amber-500/30 bg-slate-900/50 p-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-amber-500/20 text-amber-400 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase rounded-bl">
                Run B (Target / Compare)
              </div>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="text-base font-bold text-slate-100">{runB.runId}</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{runB.testName}</p>
                </div>
                {runB.status === 'PASSED' ? (
                  <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-400 font-medium">
                    <CheckCircle2 size={12} /> PASSED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400 font-medium">
                    <XCircle size={12} /> FAILED
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
                <div>
                  <span className="block text-[11px] text-slate-500">Version</span>
                  <span className="text-slate-200 font-medium">{runB.gameVersion}</span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">Platform</span>
                  <span className="text-slate-200 font-medium">{runB.platform}</span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">Timestamp</span>
                  <span className="text-slate-200 tabular-nums">{runB.timestamp.split('T')[0]}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Regression Verdict Banner */}
          {summary && (
            <div
              className={`rounded-lg border p-4 ${
                summary.verdict === 'REGRESSION'
                  ? 'border-red-500/50 bg-red-950/20 text-red-200'
                  : summary.verdict === 'WARNING'
                    ? 'border-yellow-500/50 bg-yellow-950/20 text-yellow-200'
                    : summary.verdict === 'IMPROVED'
                      ? 'border-green-500/50 bg-green-950/20 text-green-200'
                      : 'border-slate-700 bg-slate-900/40 text-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-sm mb-1.5">
                <div className="flex items-center gap-2">
                  {summary.verdict === 'REGRESSION' && <AlertTriangle size={18} className="text-red-400" />}
                  {summary.verdict === 'WARNING' && <AlertTriangle size={18} className="text-yellow-400" />}
                  {summary.verdict === 'IMPROVED' && <TrendingUp size={18} className="text-green-400" />}
                  {summary.verdict === 'EQUIVALENT' && <CheckCircle2 size={18} className="text-slate-400" />}
                  <span>
                    {summary.verdict === 'REGRESSION' && '性能リグレッションを検知 (Regression Detected)'}
                    {summary.verdict === 'WARNING' && '性能低下の警告 (Performance Warning)'}
                    {summary.verdict === 'IMPROVED' && '性能向上が確認されました (Performance Improved)'}
                    {summary.verdict === 'EQUIVALENT' && '性能に有意な変動なし (Equivalent Performance)'}
                  </span>
                </div>
                {thresholds && (
                  <span
                    className="text-[11px] font-normal text-slate-400 bg-slate-800/80 border border-slate-700/80 rounded px-2 py-0.5"
                    title="public/config/thresholds.json より読み込まれた判定閾値"
                  >
                    判定基準: FPS -{thresholds.fps.warningDropPercent}% / -{thresholds.fps.criticalDropPercent}%, RT +{thresholds.renderThread.warningDeltaMs}ms / +{thresholds.renderThread.criticalDeltaMs}ms
                  </span>
                )}
              </div>
              <ul className="text-xs space-y-1 list-disc list-inside text-slate-300 ml-1">
                {summary.verdictReasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {/* KPI Cards */}
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Avg FPS */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <span className="text-xs text-slate-400">平均 FPS</span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-100">{summary.avgFpsB}</span>
                  <span className="text-xs text-slate-500">vs {summary.avgFpsA}</span>
                </div>
                <div className="mt-2 flex items-center text-xs font-semibold">
                  <span
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                      summary.deltaFps > 0
                        ? 'bg-green-500/15 text-green-400'
                        : summary.deltaFps < 0
                          ? 'bg-red-500/15 text-red-400'
                          : 'text-slate-400'
                    }`}
                  >
                    {summary.deltaFps > 0 ? (
                      <ArrowUpRight size={13} />
                    ) : summary.deltaFps < 0 ? (
                      <ArrowDownRight size={13} />
                    ) : (
                      <Minus size={13} />
                    )}
                    {summary.deltaFps > 0 ? `+${summary.deltaFps}` : summary.deltaFps} FPS ({summary.deltaFpsPercent > 0 ? `+${summary.deltaFpsPercent}` : summary.deltaFpsPercent}%)
                  </span>
                </div>
              </div>

              {/* RenderThread */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <span className="text-xs text-slate-400">平均 RenderThread</span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-100">{summary.avgRenderThreadB}ms</span>
                  <span className="text-xs text-slate-500">vs {summary.avgRenderThreadA}ms</span>
                </div>
                <div className="mt-2 flex items-center text-xs font-semibold">
                  <span
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                      summary.deltaRenderThread > 0
                        ? 'bg-red-500/15 text-red-400'
                        : summary.deltaRenderThread < 0
                          ? 'bg-green-500/15 text-green-400'
                          : 'text-slate-400'
                    }`}
                  >
                    {summary.deltaRenderThread > 0 ? `+${summary.deltaRenderThread}ms (負荷増)` : `${summary.deltaRenderThread}ms`}
                  </span>
                </div>
              </div>

              {/* GameThread */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <span className="text-xs text-slate-400">平均 GameThread</span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-100">{summary.avgGameThreadB}ms</span>
                  <span className="text-xs text-slate-500">vs {summary.avgGameThreadA}ms</span>
                </div>
                <div className="mt-2 flex items-center text-xs font-semibold">
                  <span
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                      summary.deltaGameThread > 0
                        ? 'bg-red-500/15 text-red-400'
                        : summary.deltaGameThread < 0
                          ? 'bg-green-500/15 text-green-400'
                          : 'text-slate-400'
                    }`}
                  >
                    {summary.deltaGameThread > 0 ? `+${summary.deltaGameThread}ms (負荷増)` : `${summary.deltaGameThread}ms`}
                  </span>
                </div>
              </div>

              {/* Peak Memory */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <span className="text-xs text-slate-400">ピークメモリ (TrackedTotal)</span>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-100">
                    {summary.peakMemoryB !== undefined ? `${summary.peakMemoryB}MB` : '-'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {summary.peakMemoryA !== undefined ? `vs ${summary.peakMemoryA}MB` : ''}
                  </span>
                </div>
                <div className="mt-2 flex items-center text-xs font-semibold">
                  {summary.deltaPeakMemory !== undefined ? (
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                        summary.deltaPeakMemory > 0
                          ? 'bg-red-500/15 text-red-400'
                          : summary.deltaPeakMemory < 0
                            ? 'bg-green-500/15 text-green-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {summary.deltaPeakMemory > 0 ? `+${summary.deltaPeakMemory}MB` : `${summary.deltaPeakMemory}MB`}
                    </span>
                  ) : (
                    <span className="text-slate-500">メモリデータなし</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="border-b border-slate-800 flex gap-2">
            <button
              onClick={() => setActiveTab('fps')}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === 'fps'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Gauge size={16} /> FPS & フレームタイム差分
              {fpsDiffData.length > 0 && (
                <span className="rounded-full bg-cyan-950 px-2 py-0.5 text-xs text-cyan-300 font-mono">
                  {fpsDiffData.length}s
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('memory')}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === 'memory'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <MemoryStick size={16} /> メモリ消費差分
              {memoryDiffData && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300 font-mono">
                  {memoryDiffData.peakDiffs.length} tags
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('artifacts')}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === 'artifacts'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileBox size={16} /> 成果物 & テスト結果比較
            </button>
          </div>

          {/* Tab Content */}
          <div className="pt-2">
            {activeTab === 'fps' && (
              <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Gauge size={16} className="text-cyan-400" /> FPS タイムライン比較 & 差分
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    DuckDB-WASM 上で 1 秒バケットに集約し、Run A (基準: {runA.runId}) と Run B (比較: {runB.runId}) の推移を突合しています。
                  </p>
                </div>
                {fpsDiffData.length > 0 ? (
                  <FpsDiffChart data={fpsDiffData} runAId={runA.runId} runBId={runB.runId} />
                ) : (
                  <div className="py-16 text-center text-sm text-slate-500">
                    両方の Run に FPS データが存在しないため、差分を計算できませんでした。
                  </div>
                )}
              </section>
            )}

            {activeTab === 'memory' && (
              <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <MemoryStick size={16} className="text-green-400" /> メモリ消費推移 & ピーク比較
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    UE LLM (Low-Level Memory Tracker) の各タグごとの最大消費量を比較し、メモリリークや増加要因を特定します。
                  </p>
                </div>
                {memoryDiffData ? (
                  <MemoryDiffChart
                    timeline={memoryDiffData.timeline}
                    peakDiffs={memoryDiffData.peakDiffs}
                    runAId={runA.runId}
                    runBId={runB.runId}
                  />
                ) : (
                  <div className="py-16 text-center text-sm text-slate-500">
                    両方の Run にメモリメトリクスが存在しないため、差分を計算できませんでした。
                  </div>
                )}
              </section>
            )}

            {activeTab === 'artifacts' && (
              <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-2">
                    <FileBox size={16} className="text-yellow-400" /> 成果物ファイル比較 (Artifacts Comparison)
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    クラッシュダンプ (.dmp) やプロファイルトレース (.utrace) の生成有無などを比較できます。
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Run A artifacts */}
                    <div className="rounded border border-slate-800 p-3 bg-slate-900/60">
                      <div className="text-xs font-semibold text-cyan-400 mb-2">
                        Run A ({runA.runId}) 成果物: {runA.artifacts.length} 件
                      </div>
                      <ul className="text-xs divide-y divide-slate-800/60 font-mono">
                        {runA.artifacts.map((art) => (
                          <li key={art.fileName} className="py-1.5 flex justify-between items-center">
                            <span className="text-slate-300">{art.fileName}</span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 uppercase">
                              {art.type}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Run B artifacts */}
                    <div className="rounded border border-slate-800 p-3 bg-slate-900/60">
                      <div className="text-xs font-semibold text-amber-400 mb-2">
                        Run B ({runB.runId}) 成果物: {runB.artifacts.length} 件
                      </div>
                      <ul className="text-xs divide-y divide-slate-800/60 font-mono">
                        {runB.artifacts.map((art) => (
                          <li key={art.fileName} className="py-1.5 flex justify-between items-center">
                            <span className="text-slate-300">{art.fileName}</span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 uppercase">
                              {art.type}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
