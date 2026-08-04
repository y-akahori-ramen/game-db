import { getIdToken } from '../auth';
import type { SearchFilter, SearchService, TestRunArtifact, TestRunSummary } from './SearchService';

interface SearchApiRun {
    runId: string;
    gameVersion: string;
    platform: string;
    testName: string;
    status: 'PASSED' | 'FAILED';
    timestamp: string;
    fpsDataUrl: string;
    memoryDataUrl: string;
    logsDataUrl: string;
    videoUrl?: string;
    artifacts: TestRunArtifact[];
}

function stripLeadingSlash(path: string): string {
    return path.replace(/^\/+/, '');
}

/** API-backed search service. Enabled via VITE_USE_MOCK=false. */
export class ApiSearchService implements SearchService {
    async searchRuns(filter: SearchFilter): Promise<TestRunSummary[]> {
        const idToken = getIdToken();
        if (!idToken) {
            throw new Error('Not logged in: missing ID token for /api/search request.');
        }

        const response = await fetch(`${import.meta.env.BASE_URL}api/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify(filter),
        });

        if (!response.ok) {
            throw new Error(`Search API request failed with status ${response.status}.`);
        }

        const runs = (await response.json()) as SearchApiRun[];
        return runs.map((run) => ({
            ...run,
            fpsDataUrl: stripLeadingSlash(run.fpsDataUrl),
            memoryDataUrl: stripLeadingSlash(run.memoryDataUrl),
            logsDataUrl: stripLeadingSlash(run.logsDataUrl),
            videoUrl: run.videoUrl ? stripLeadingSlash(run.videoUrl) : undefined,
            artifacts: run.artifacts.map((artifact) => ({ ...artifact, url: stripLeadingSlash(artifact.url) })),
        }));
    }
}
