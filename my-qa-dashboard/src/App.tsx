import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Gauge,
  Loader2,
  MemoryStick,
  ScrollText,
  Video,
  XCircle,
} from 'lucide-react';
import { useDuckDB, FPS_CSV_FILE, MEMORY_CSV_FILE } from './hooks/useDuckDB';
import FpsChart from './components/FpsChart';
import MemoryChart from './components/MemoryChart';
import LogTable, { UE_LOG_TABLE } from './components/LogTable';
import SearchPage from './components/SearchPage';
import ArtifactsPanel from './components/ArtifactsPanel';
import { parseUeLogText } from './utils/ueLogParser';
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
  const { status, error, loadRemoteFile, executeQuery, loadRowsAsTable, loadLocalCsvFile } =
    useDuckDB();
  const [view, setView] = useState<'search' | 'dashboard'>('search');
  const [selectedRun, setSelectedRun] = useState<TestRunSummary | null>(null);
  const [fpsData, setFpsData] = useState<FpsMetric[]>([]);
  const [memoryData, setMemoryData] = useState<MemoryMetric[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  // A locally opened CSV overwrites the sample file registration but is queried identically.
  const fpsReady = dataLoaded || fpsUploaded;
  const memoryReady = dataLoaded || memoryUploaded;

  const handleOpenRun = useCallback(
    async (run: TestRunSummary) => {
      setSelectedRun(run);
      setView('dashboard');
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
        const fpsName = runFileName('run_fps', run.fpsDataUrl);
        const memoryName = runFileName('run_memory', run.memoryDataUrl);
        const [, , logText] = await Promise.all([
          loadRemoteFile(fpsName, `${base}${run.fpsDataUrl}`),
          loadRemoteFile(memoryName, `${base}${run.memoryDataUrl}`),
          fetch(`${base}${run.logsDataUrl}`).then((res) => {
            if (!res.ok) throw new Error(`Failed to fetch ${run.logsDataUrl}: ${res.status}`);
            return res.text();
          }),
        ]);
        const [fps, memory] = await Promise.all([
          executeQuery<FpsMetric>(
            `SELECT PersistentLevel, FPSMs, GameThread, RenderThread, GPUFrame, RHIThreadTime, ElapsedTime FROM ${fromClause(fpsName)} ORDER BY ElapsedTime`,
          ),
          executeQuery<MemoryMetric>(`SELECT * FROM ${fromClause(memoryName)}`),
          // Logs are a real UE log file, parsed through the same text -> table pipeline
          // as a user-uploaded log so both are queried identically.
          loadRowsAsTable(
            UE_LOG_TABLE,
            parseUeLogText(logText) as unknown as Record<string, unknown>[],
          ),
        ]);
        setFpsData(fps);
        setMemoryData(memory);
        setDataLoaded(true);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingData(false);
      }
    },
    [loadRemoteFile, executeQuery, loadRowsAsTable],
  );

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
            {view === 'dashboard' && (
              <button
                onClick={() => setView('search')}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                <ArrowLeft size={16} /> 検索に戻る
              </button>
            )}
            <Activity className="text-cyan-400" size={24} />
            <h1 className="text-lg font-semibold">
              {view === 'search' ? 'Test Run Search' : 'Game QA Analytics Dashboard'}
            </h1>
          </div>
          {view === 'dashboard' && selectedRun && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
              <span>
                Test Run: <span className="text-slate-200">{selectedRun.runId}</span>
              </span>
              <span>
                Game Version: <span className="text-slate-200">{selectedRun.gameVersion}</span>
              </span>
              <span>
                Platform: <span className="text-slate-200">{selectedRun.platform}</span>
              </span>
              {selectedRun.status === 'PASSED' ? (
                <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-green-400">
                  <CheckCircle2 size={14} /> PASSED
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-red-400">
                  <XCircle size={14} /> FAILED
                </span>
              )}
              {loadingData && (
                <span className="inline-flex items-center gap-1.5 text-cyan-400">
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

      {view === 'search' ? (
        <SearchPage onOpenRun={handleOpenRun} />
      ) : (
        <main className="p-6 space-y-6">
          {/* Artifacts produced by the run: fps/memory/log/video/screenshots etc. */}
          {selectedRun && (
            <ArtifactsPanel runId={selectedRun.runId} artifacts={selectedRun.artifacts} />
          )}

          {/* Gameplay video (only present for runs that captured one) */}
          {selectedRun?.videoUrl && (
            <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
                <Video size={16} className="text-purple-400" /> Gameplay Video
              </h2>
              <div className="flex justify-center bg-black rounded-md">
                <video
                  key={selectedRun.videoUrl}
                  controls
                  preload="metadata"
                  className="max-h-[480px] w-full max-w-3xl"
                  src={`${import.meta.env.BASE_URL}${selectedRun.videoUrl}`}
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
              {fpsReady ? (
                <FpsChart data={fpsData} />
              ) : (
                <Placeholder />
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
              {memoryReady ? (
                <MemoryChart data={memoryData} />
              ) : (
                <Placeholder />
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
            />
          </section>
        </main>
      )}
    </div>
  );
}

function Placeholder() {
  return (
    <div className="flex h-80 items-center justify-center text-sm text-slate-600">
      Open a test run or a local file to render chart.
    </div>
  );
}
