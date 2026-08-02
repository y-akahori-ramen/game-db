export interface SearchFilter {
    gameVersion?: string;
    platform?: string;
    testName?: string;
    status?: string;
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
}

export interface SearchService {
    searchRuns(filter: SearchFilter): Promise<TestRunSummary[]>;
}
