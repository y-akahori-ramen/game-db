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
