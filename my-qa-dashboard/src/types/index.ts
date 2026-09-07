/**
 * FPS metric row. Columns match the common subset of UE's Stat/CSV FPS output
 * (see my-qa-dashboard/sample/fpssample.csv); a project's actual file may
 * contain additional columns (e.g. FPS, X/Y/Z, ActorName) which are ignored.
 */
export interface FpsMetric {
  PersistentLevel: string;
  FPSMs: number;
  GameThread: number;
  RenderThread: number;
  GPUFrame: number;
  RHIThreadTime: number;
  ElapsedTime: number;
}

/**
 * Memory metric row from UE's LLM (Low-Level Memory Tracker) CSV output
 * (see my-qa-dashboard/sample/llmsample.csv). Columns vary by platform/project
 * (e.g. Audio/Wwise tags on some platforms, not others), so this is treated as
 * an open record rather than a fixed shape. `TrackedTotal` is the one column
 * guaranteed to be present on every platform. There is no timestamp column;
 * rows are ordered as they appear in the source file and charted by row index.
 */
export type MemoryMetric = Record<string, number>;

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type LogLevelFilter = 'ALL' | LogLevel;

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
}

export type DuckDBStatus = 'loading' | 'ready' | 'error';

/** A single parsed entry from an Unreal Engine log file (see ../utils/ueLogParser). */
export interface UeLogEntry {
  line_number: number;
  type: 'meta' | 'log';
  phase: 'init' | 'execution' | null;
  timestamp_raw: string | null;
  /** Elapsed seconds since the first timestamped entry in the log. */
  timestamp: number | null;
  frame: number | null;
  category: string;
  verbosity: string;
  level: LogLevel;
  message: string;
}

/** Second-bucketed diff metrics between two runs (Run A baseline vs Run B target). */
export interface FpsDiffMetric {
  second: number;
  fpsA: number | null;
  fpsB: number | null;
  deltaFps: number | null;
  frametimeA: number | null;
  frametimeB: number | null;
  deltaFrametime: number | null;
  gameThreadA: number | null;
  gameThreadB: number | null;
  deltaGameThread: number | null;
  renderThreadA: number | null;
  renderThreadB: number | null;
  deltaRenderThread: number | null;
  gpuFrameA: number | null;
  gpuFrameB: number | null;
  deltaGpuFrame: number | null;
}

/** Memory peak comparison item per LLM tag / column. */
export interface MemoryDiffItem {
  category: string;
  peakA: number;
  peakB: number;
  deltaPeak: number;
  deltaPercent: number;
}

export type RegressionVerdict =
  | 'REGRESSION'
  | 'WARNING'
  | 'IMPROVED'
  | 'EQUIVALENT'
  | 'INCONCLUSIVE';

/** High-level KPIs and automated regression assessment comparing Run A and Run B. */
export interface ComparisonSummary {
  avgFpsA: number;
  avgFpsB: number;
  deltaFps: number;
  deltaFpsPercent: number;
  avgFrametimeA: number;
  avgFrametimeB: number;
  avgRenderThreadA: number;
  avgRenderThreadB: number;
  deltaRenderThread: number;
  avgGameThreadA: number;
  avgGameThreadB: number;
  deltaGameThread: number;
  avgGpuFrameA: number;
  avgGpuFrameB: number;
  deltaGpuFrame: number;
  peakMemoryA?: number;
  peakMemoryB?: number;
  deltaPeakMemory?: number;
  verdict: RegressionVerdict;
  verdictReasons: string[];
}

/** A point in the time-series trend of test runs. */
export interface TrendDataPoint {
  runId: string;
  timestamp: string;
  formattedDate: string;
  gameVersion: string;
  platform: string;
  testName: string;
  status: 'PASSED' | 'FAILED';
  avgFps: number | null;
  minFps: number | null;
  peakMemoryMb: number | null;
}

export type TrendTimeRange = '7d' | '14d' | '30d' | 'all';

/** High-level trend statistics and KPIs calculated across selected runs. */
export interface TrendSummaryStats {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number; // Percentage 0 - 100
  latestAvgFps: number | null;
  overallAvgFps: number | null;
  deltaFps: number | null; // latestAvgFps - overallAvgFps
  latestPeakMemory: number | null;
  overallPeakMemory: number | null;
  deltaPeakMemory: number | null; // latestPeakMemory - overallPeakMemory
}

