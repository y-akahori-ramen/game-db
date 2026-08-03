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
