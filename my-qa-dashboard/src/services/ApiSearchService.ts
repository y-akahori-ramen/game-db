import type { SearchFilter, SearchService, TestRunArtifact, TestRunSummary } from './SearchService';

interface SearchApiRun {
    runId: string;
    gameVersion: string;
    platform: string;
    testName: string;
    status: 'PASSED' | 'FAILED';
    timestamp: string;
    fpsDataUrl?: string;
    memoryDataUrl?: string;
    logsDataUrl?: string;
    videoUrl?: string;
    artifacts: TestRunArtifact[];
}

function stripLeadingSlash(path: string): string {
    return path.replace(/^\/+/, '');
}

/** API-backed search service. Enabled via VITE_USE_MOCK=false. */
export class ApiSearchService implements SearchService {
    async searchRuns(filter: SearchFilter): Promise<TestRunSummary[]> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        const response = await fetch(`${import.meta.env.BASE_URL}api/search`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(filter),
        });

        if (!response.ok) {
            throw new Error(`Search API request failed with status ${response.status}.`);
        }

        const runs = (await response.json()) as SearchApiRun[];
        return runs.map((run) => ({
            ...run,
            fpsDataUrl: run.fpsDataUrl ? stripLeadingSlash(run.fpsDataUrl) : undefined,
            memoryDataUrl: run.memoryDataUrl ? stripLeadingSlash(run.memoryDataUrl) : undefined,
            logsDataUrl: run.logsDataUrl ? stripLeadingSlash(run.logsDataUrl) : undefined,
            videoUrl: run.videoUrl ? stripLeadingSlash(run.videoUrl) : undefined,
            artifacts: (run.artifacts || []).map((artifact) => ({ ...artifact, url: stripLeadingSlash(artifact.url) })),
        }));
    }

    async getRun(runId: string): Promise<TestRunSummary | null> {
        const response = await fetch(`${import.meta.env.BASE_URL}api/runs/${encodeURIComponent(runId)}`, {
            credentials: 'include',
        });
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`Run detail API request failed with status ${response.status}.`);
        }
        const run = (await response.json()) as SearchApiRun;
        return {
            ...run,
            fpsDataUrl: run.fpsDataUrl ? stripLeadingSlash(run.fpsDataUrl) : undefined,
            memoryDataUrl: run.memoryDataUrl ? stripLeadingSlash(run.memoryDataUrl) : undefined,
            logsDataUrl: run.logsDataUrl ? stripLeadingSlash(run.logsDataUrl) : undefined,
            videoUrl: run.videoUrl ? stripLeadingSlash(run.videoUrl) : undefined,
            artifacts: (run.artifacts || []).map((artifact) => ({ ...artifact, url: stripLeadingSlash(artifact.url) })),
        };
    }
}
