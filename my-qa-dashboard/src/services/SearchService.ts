export interface SearchFilter {
    gameVersion?: string;
    platform?: string;
    testName?: string;
    status?: string;
}

/** Kind of artifact produced during a test run, used for icons/grouping in the viewer. */
export type TestRunArtifactType =
    | 'fps'
    | 'memory'
    | 'log'
    | 'video'
    | 'screenshot'
    | 'crashdump'
    | 'trace'
    | 'report'
    | 'other';

export interface TestRunArtifact {
    /** BASE_URL-relative path to the artifact file. */
    url: string;
    /** Display / download file name (e.g. "fps_metrics.csv", "screenshot_001.png"). */
    fileName: string;
    /** Artifact kind, used for icons/grouping in the viewer. */
    type: TestRunArtifactType;
    /** Optional file size in bytes. */
    sizeBytes?: number;
    /** Optional MIME type. */
    mimeType?: string;
    /** Optional description. */
    description?: string;
}

export interface TestRunSummary {
    runId: string;
    gameVersion: string;
    platform: string;
    testName: string;
    status: 'PASSED' | 'FAILED';
    timestamp: string;
    /** Average FPS across the test run, if available. */
    avgFps?: number;
    /** Minimum FPS recorded during the run, if available. */
    minFps?: number;
    /** Peak memory usage in MB, if available. */
    peakMemoryMb?: number;
    /** BASE_URL-relative path to the FPS data file (.csv or .json). Absent if no FPS data. */
    fpsDataUrl?: string;
    /** BASE_URL-relative path to the memory data file (.csv or .json). Absent if no memory data. */
    memoryDataUrl?: string;
    /** BASE_URL-relative path to the UE log file (.log). Absent if no log data. */
    logsDataUrl?: string;
    /** BASE_URL-relative path to the run's gameplay video (.mp4). Absent if no video was captured. */
    videoUrl?: string;
    /** All files produced by the test run (includes fps/memory/log/video plus extras like screenshots). */
    artifacts: TestRunArtifact[];
}

export interface SearchService {
    searchRuns(filter: SearchFilter): Promise<TestRunSummary[]>;
    getRun(runId: string): Promise<TestRunSummary | null>;
}
