import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileUp,
  Gauge,
  Loader2,
  MemoryStick,
  ScrollText,
  Share2,
  Video,
  XCircle,
} from 'lucide-react';
import { useDuckDB, FPS_CSV_FILE, MEMORY_CSV_FILE } from './hooks/useDuckDB';
import FpsChart from './components/FpsChart';
import MemoryChart from './components/MemoryChart';
import LogTable, { UE_LOG_TABLE } from './components/LogTable';
import SearchPage from './components/SearchPage';
import ComparePage from './components/ComparePage';
import ArtifactsPanel from './components/ArtifactsPanel';
import { useAppRouter } from './router';
import { parseUeLogText } from './utils/ueLogParser';
import { searchService } from './services';
import type { TestRunSummary } from './services';
import type { FpsMetric, MemoryMetric } from './types';

/** Virtual-FS name for a run's data file, keeping the source extension for DuckDB. */
function runFileName(baseName: string, url: string): string {
  return `${baseName}.${url.endsWith('.json') ? 'json' : 'csv'}`;
}

/** DuckDB FROM clause matching the file format. */
function fromClause(name: string): string {
  return name.endsWith('.json') ? `read_json_auto('${name}')` : `read_csv_auto('${name}')`;
}

export default function App() {
  const {
    route,
    queryParams,
    navigateToSearch,
    navigateToRun,
    navigateToCompare,
    updateQueryParams,
    getShareableUrl,
  } = useAppRouter();

  const { status, error, loadRemoteFile, executeQuery, loadRowsAsTable, loadLocalCsvFile } =
    useDuckDB();

  const [selectedRun, setSelectedRun] = useState<TestRunSummary | null>(null);
  const [fpsData, setFpsData] = useState<FpsMetric[]>([]);
  const [memoryData, setMemoryData] = useState<MemoryMetric[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const fpsFileInputRef = useRef<HTMLInputElement>(null);
  const [fpsFileName, setFpsFileName] = useState<string | null>(null);
  const [fpsUploaded, setFpsUploaded] = useState(false);
  const [fpsFileLoading, setFpsFileLoading] = useState(false);
  const [fpsFileError, setFpsFileError] = useState<string | null>(null);

  const memoryFileInputRef = useRef<HTMLInputElement>(null);
  const [memoryFileName, setMemoryFileName] = useState<string | null>(null);
  const [memoryUploaded, setMemoryUploaded] = useState(false);
  const [memoryFileLoading, setMemoryFileLoading] = useState(false);
  const [memoryFileError, setMemoryFileError] = useState<string | null>(null);

  const fpsReady = dataLoaded || fpsUploaded;
  const memoryReady = dataLoaded || memoryUploaded;

  const loadRunData = useCallback(
    async (run: TestRunSummary) => {
      setSelectedRun(run);
      setDataLoaded(false);
      setLoadingData(true);
      setLoadError(null);
      setFpsUploaded(false);
      setFpsFileName(null);
      setFpsFileError(null);
      setMemoryUploaded(false);
      setMemoryFileName(null);
      setMemoryFileError(null);

      try {
        const base = import.meta.env.BASE_URL;

        // Load FPS if available
        let fpsResult: FpsMetric[] = [];
        if (run.fpsDataUrl) {
          const fpsName = runFileName('run_fps', run.fpsDataUrl);
          await loadRemoteFile(fpsName, `${base}${run.fpsDataUrl}`);
          fpsResult = await executeQuery<FpsMetric>(
            `SELECT PersistentLevel, FPSMs, GameThread, RenderThread, GPUFrame, RHIThreadTime, ElapsedTime FROM ${fromClause(fpsName)} ORDER BY ElapsedTime`,
          );
        }

        // Load Memory if available
        let memoryResult: MemoryMetric[] = [];
        if (run.memoryDataUrl) {
          const memoryName = runFileName('run_memory', run.memoryDataUrl);
          await loadRemoteFile(memoryName, `${base}${run.memoryDataUrl}`);
          memoryResult = await executeQuery<MemoryMetric>(
            `SELECT * FROM ${fromClause(memoryName)}`,
          );
        }

        // Load Logs if available
        if (run.logsDataUrl) {
          const res = await fetch(`${base}${run.logsDataUrl}`);
          if (!res.ok) throw new Error(`Failed to fetch ${run.logsDataUrl}: ${res.status}`);
          const logText = await res.text();
          await loadRowsAsTable(
            UE_LOG_TABLE,
            parseUeLogText(logText) as unknown as Record<string, unknown>[],
          );
        }

        setFpsData(fpsResult);
        setMemoryData(memoryResult);
        setDataLoaded(true);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingData(false);
      }
    },
    [loadRemoteFile, executeQuery, loadRowsAsTable],
  );

  // Sync route.runId with selectedRun
  useEffect(() => {
    if (route.name === 'dashboard' && route.runId) {
      if (selectedRun?.runId !== route.runId) {
        // Find run by ID
        void (async () => {
          try {
            setLoadingData(true);
            setLoadError(null);
            const allRuns = await searchService.searchRuns({});
            const targetRun = allRuns.find((r) => r.runId === route.runId);
            if (targetRun) {
              await loadRunData(targetRun);
            } else {
              setLoadError(`Run ID "${route.runId}" が見つかりませんでした。`);
              setLoadingData(false);
            }
          } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
            setLoadingData(false);
          }
        })();
      }
    } else {
      setSelectedRun(null);
    }
  }, [route, selectedRun?.runId, loadRunData]);

  // Video seeking sync with queryParams.t
  useEffect(() => {
    if (queryParams.t !== undefined && videoRef.current) {
      const diff = Math.abs(videoRef.current.currentTime - queryParams.t);
      if (diff > 0.5) {
        videoRef.current.currentTime = queryParams.t;
      }
    }
  }, [queryParams.t]);

  const handleOpenRun = useCallback(
    (run: TestRunSummary) => {
      navigateToRun(run.runId);
    },
    [navigateToRun],
  );

  const handleCopyLink = useCallback(async () => {
    if (!selectedRun) return;
    const url = getShareableUrl(selectedRun.runId, queryParams);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      prompt('共有URLをコピーしてください:', url);
    }
  }, [selectedRun, queryParams, getShareableUrl]);

  const handleFpsFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setFpsFileLoading(true);
      setFpsFileError(null);
      try {
        await loadLocalCsvFile(FPS_CSV_FILE, file);
        const fps = await executeQuery<FpsMetric>(
          `SELECT PersistentLevel, FPSMs, GameThread, RenderThread, GPUFrame, RHIThreadTime, ElapsedTime FROM ${fromClause(FPS_CSV_FILE)} ORDER BY ElapsedTime`,
        );
        setFpsData(fps);
        setFpsFileName(file.name);
        setFpsUploaded(true);
      } catch (err) {
        setFpsFileError(err instanceof Error ? err.message : String(err));
      } finally {
        setFpsFileLoading(false);
      }
    },
    [loadLocalCsvFile, executeQuery],
  );

  const handleMemoryFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setMemoryFileLoading(true);
      setMemoryFileError(null);
      try {
        await loadLocalCsvFile(MEMORY_CSV_FILE, file);
        const memory = await executeQuery<MemoryMetric>(
          `SELECT * FROM ${fromClause(MEMORY_CSV_FILE)}`,
        );
        setMemoryData(memory);
        setMemoryFileName(file.name);
        setMemoryUploaded(true);
      } catch (err) {
        setMemoryFileError(err instanceof Error ? err.message : String(err));
      } finally {
        setMemoryFileLoading(false);
      }
    },
    [loadLocalCsvFile, executeQuery],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header / Test info panel */}
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {(route.name === 'dashboard' || route.name === 'compare') && (
              <button
                onClick={() => navigateToSearch()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <ArrowLeft size={16} /> 検索に戻る
              </button>
            )}
            <Activity className="text-cyan-400" size={24} />
            <h1 className="text-lg font-semibold">
              {route.name === 'search'
                ? 'Test Run Search'
                : route.name === 'compare'
                  ? 'Test Run Comparison (Diff)'
                  : 'Game QA Analytics Dashboard'}
            </h1>
          </div>
          {route.name === 'dashboard' && selectedRun && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
              <span>
                Test Run: <span className="text-slate-200 font-medium">{selectedRun.runId}</span>
              </span>
              <span>
                Game Version: <span className="text-slate-200">{selectedRun.gameVersion}</span>
              </span>
              <span>
                Platform: <span className="text-slate-200">{selectedRun.platform}</span>
              </span>
              {selectedRun.status === 'PASSED' ? (
                <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-green-400 font-medium text-xs">
                  <CheckCircle2 size={14} /> PASSED
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-red-400 font-medium text-xs">
                  <XCircle size={14} /> FAILED
                </span>
              )}

              {/* Share / Copy Link Button */}
              <button
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 transition-colors"
                title="現在の秒数や選択行を含めてURLをコピー"
              >
                {copied ? <Check size={13} className="text-green-400" /> : <Share2 size={13} />}
                {copied ? 'コピー完了!' : 'リンクをコピー'}
              </button>

              {loadingData && (
                <span className="inline-flex items-center gap-1.5 text-cyan-400 text-xs">
                  <Loader2 size={14} className="animate-spin" /> Loading...
                </span>
              )}
            </div>
          )}
          {status === 'loading' && (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Initializing DuckDB...
            </span>
          )}
        </div>
        {status === 'error' && (
          <p className="mt-2 text-sm text-red-400">DuckDB init error: {error}</p>
        )}
        {loadError && (
          <p className="mt-2 text-sm text-red-400">Data load error: {loadError}</p>
        )}
      </header>

      {route.name === 'search' ? (
        <SearchPage
          onOpenRun={handleOpenRun}
          onCompareRuns={navigateToCompare}
          initialFilters={{
            testName: queryParams.testName,
            gameVersion: queryParams.gameVersion,
            platform: queryParams.platform,
            status: queryParams.status,
          }}
          onFilterChange={(filters) => updateQueryParams(filters, true)}
        />
      ) : route.name === 'compare' && route.compareRunIds ? (
        <ComparePage
          runAId={route.compareRunIds[0]}
          runBId={route.compareRunIds[1]}
          onBackToSearch={navigateToSearch}
          onSwapRuns={() =>
            navigateToCompare(route.compareRunIds![1], route.compareRunIds![0])
          }
          loadRemoteFile={loadRemoteFile}
          executeQuery={executeQuery}
          duckDbStatus={status}
          getShareableUrl={(ids) => getShareableUrl(ids)}
        />
      ) : (
        <main className="p-6 space-y-6">
          {/* Artifacts produced by the run */}
          {selectedRun && (
            <ArtifactsPanel runId={selectedRun.runId} artifacts={selectedRun.artifacts} />
          )}

          {/* Gameplay video (only present for runs that captured one) */}
          {selectedRun?.videoUrl && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                  <Video size={16} className="text-purple-400" /> Gameplay Video
                </h2>
                {queryParams.t !== undefined && (
                  <span className="text-xs text-slate-400 font-mono">
                    Time: {queryParams.t.toFixed(1)}s
                  </span>
                )}
              </div>
              <div className="flex justify-center bg-black rounded-md">
                <video
                  ref={videoRef}
                  key={selectedRun.videoUrl}
                  controls
                  preload="metadata"
                  className="max-h-[480px] w-full max-w-3xl"
                  src={`${import.meta.env.BASE_URL}${selectedRun.videoUrl}`}
                  onLoadedMetadata={() => {
                    if (queryParams.t && videoRef.current) {
                      videoRef.current.currentTime = queryParams.t;
                    }
                  }}
                  onSeeked={() => {
                    if (videoRef.current) {
                      updateQueryParams({ t: videoRef.current.currentTime }, true);
                    }
                  }}
                >
                  お使いのブラウザは動画再生に対応していません。
                </video>
              </div>
            </section>
          )}

          {/* Metrics panels */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                  <Gauge size={16} className="text-cyan-400" /> FPS / Frame Time
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    ref={fpsFileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFpsFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => fpsFileInputRef.current?.click()}
                    disabled={status !== 'ready' || fpsFileLoading}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {fpsFileLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <FileUp size={14} />
                    )}
                    {fpsFileLoading ? '読み込み中...' : 'ローカルのFPSログを開く'}
                  </button>
                </div>
              </div>
              {fpsFileError && <p className="mb-2 text-xs text-red-400">読み込みエラー: {fpsFileError}</p>}
              {fpsUploaded && fpsFileName && (
                <p className="mb-2 text-xs text-slate-500">{fpsFileName}</p>
              )}
              {fpsReady && fpsData.length > 0 ? (
                <FpsChart data={fpsData} />
              ) : (
                <Placeholder message={selectedRun && !selectedRun.fpsDataUrl && !fpsUploaded ? 'このテスト実行には FPS データがありません。' : 'Open a test run or a local file to render chart.'} />
              )}
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                  <MemoryStick size={16} className="text-green-400" /> Memory Usage
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    ref={memoryFileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleMemoryFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => memoryFileInputRef.current?.click()}
                    disabled={status !== 'ready' || memoryFileLoading}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {memoryFileLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <FileUp size={14} />
                    )}
                    {memoryFileLoading ? '読み込み中...' : 'ローカルのメモリログを開く'}
                  </button>
                </div>
              </div>
              {memoryFileError && (
                <p className="mb-2 text-xs text-red-400">読み込みエラー: {memoryFileError}</p>
              )}
              {memoryUploaded && memoryFileName && (
                <p className="mb-2 text-xs text-slate-500">{memoryFileName}</p>
              )}
              {memoryReady && memoryData.length > 0 ? (
                <MemoryChart data={memoryData} />
              ) : (
                <Placeholder message={selectedRun && !selectedRun.memoryDataUrl && !memoryUploaded ? 'このテスト実行には メモリデータがありません。' : 'Open a test run or a local file to render chart.'} />
              )}
            </section>
          </div>

          {/* Log analyzer panel */}
          <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <ScrollText size={16} className="text-yellow-400" /> Log Analyzer
            </h2>
            <LogTable
              executeQuery={executeQuery}
              loadRowsAsTable={loadRowsAsTable}
              logsReady={dataLoaded}
              dbReady={status === 'ready'}
              targetLine={queryParams.log}
              onSelectLine={(line) => updateQueryParams({ log: line ?? undefined }, true)}
            />
          </section>
        </main>
      )}
    </div>
  );
}

function Placeholder({ message = 'Open a test run or a local file to render chart.' }: { message?: string }) {
  return (
    <div className="flex h-80 items-center justify-center text-sm text-slate-600">
      {message}
    </div>
  );
}
