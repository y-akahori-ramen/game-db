import { useCallback, useState } from 'react';
import {
  Activity,
  Database,
  Gauge,
  Loader2,
  MemoryStick,
  ScrollText,
  XCircle,
} from 'lucide-react';
import { useDuckDB } from './hooks/useDuckDB';
import FpsChart from './components/FpsChart';
import MemoryChart from './components/MemoryChart';
import LogTable from './components/LogTable';
import type { FpsMetric, MemoryMetric } from './types';

export default function App() {
  const { status, error, loadParquetFiles, executeQuery, loadRowsAsParquetFile } = useDuckDB();
  const [fpsData, setFpsData] = useState<FpsMetric[]>([]);
  const [memoryData, setMemoryData] = useState<MemoryMetric[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleLoadData = useCallback(async () => {
    setLoadingData(true);
    setLoadError(null);
    try {
      await loadParquetFiles();
      const [fps, memory] = await Promise.all([
        executeQuery<FpsMetric>(
          "SELECT timestamp, fps, frame_time_ms FROM 'fps_metrics.parquet' ORDER BY timestamp",
        ),
        executeQuery<MemoryMetric>(
          "SELECT timestamp, vram_mb, ram_mb, heap_mb FROM 'memory_metrics.parquet' ORDER BY timestamp",
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
  }, [loadParquetFiles, executeQuery]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header / Test info panel */}
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="text-cyan-400" size={24} />
            <h1 className="text-lg font-semibold">Game QA Analytics Dashboard</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
            <span>
              Test Run: <span className="text-slate-200">#20260802-001</span>
            </span>
            <span>
              Game Version: <span className="text-slate-200">v1.2.0</span>
            </span>
            <span>
              Platform: <span className="text-slate-200">PS5</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-red-400">
              <XCircle size={14} /> FAILED
            </span>
          </div>
          <button
            onClick={handleLoadData}
            disabled={status !== 'ready' || loadingData}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'loading' || loadingData ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Database size={16} />
            )}
            {status === 'loading'
              ? 'Initializing DuckDB...'
              : loadingData
                ? 'Loading...'
                : dataLoaded
                  ? 'Reload Sample Data'
                  : 'サンプルデータをロード'}
          </button>
        </div>
        {status === 'error' && (
          <p className="mt-2 text-sm text-red-400">DuckDB init error: {error}</p>
        )}
        {loadError && (
          <p className="mt-2 text-sm text-red-400">Data load error: {loadError}</p>
        )}
      </header>

      <main className="p-6 space-y-6">
        {/* Metrics panels */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Gauge size={16} className="text-cyan-400" /> FPS / Frame Time
            </h2>
            {dataLoaded ? (
              <FpsChart data={fpsData} />
            ) : (
              <Placeholder />
            )}
          </section>
          <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <MemoryStick size={16} className="text-green-400" /> Memory Usage
            </h2>
            {dataLoaded ? (
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
            loadRowsAsParquetFile={loadRowsAsParquetFile}
            dataLoaded={dataLoaded}
            dbReady={status === 'ready'}
          />
        </section>
      </main>
    </div>
  );
}

function Placeholder() {
  return (
    <div className="flex h-80 items-center justify-center text-sm text-slate-600">
      Load sample data to render chart.
    </div>
  );
}
