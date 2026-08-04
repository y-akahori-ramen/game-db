export interface SearchFilter {
    gameVersion?: string;
    platform?: string;
    testName?: string;
    status?: string;
}

/** Kind of artifact produced during a test run, used for icons/grouping in the viewer. */
export type TestRunArtifactType = 'fps' | 'memory' | 'log' | 'video' | 'screenshot' | 'other';

export interface TestRunArtifact {
    /** BASE_URL-relative path to the artifact file. */
    url: string;
    /** Display / download file name (e.g. "fps_metrics.csv", "screenshot_001.png"). */
    fileName: string;
    /** Artifact kind, used for icons/grouping in the viewer. */
    type: TestRunArtifactType;
}

export interface TestRunSummary {
    runId: string;
    gameVersion: string;
    platform: string;
    testName: string;
    status: 'PASSED' | 'FAILED';
    timestamp: string;
    /** BASE_URL-relative path to the FPS data file (.csv or .json). */
    fpsDataUrl: string;
    /** BASE_URL-relative path to the memory data file (.csv or .json). */
    memoryDataUrl: string;
    /** BASE_URL-relative path to the UE log file (.log). */
    logsDataUrl: string;
    /** BASE_URL-relative path to the run's gameplay video (.mp4). Absent if no video was captured. */
    videoUrl?: string;
    /** All files produced by the test run (includes fps/memory/log/video plus extras like screenshots). */
    artifacts: TestRunArtifact[];
}

export interface SearchService {
    searchRuns(filter: SearchFilter): Promise<TestRunSummary[]>;
}
