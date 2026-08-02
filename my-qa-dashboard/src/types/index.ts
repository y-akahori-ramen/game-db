export interface FpsMetric {
  timestamp: number;
  fps: number;
  frame_time_ms: number;
}

export interface MemoryMetric {
  timestamp: number;
  vram_mb: number;
  ram_mb: number;
  heap_mb: number;
}

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
