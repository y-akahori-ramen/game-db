import type { SearchFilter, SearchService, TestRunArtifact, TestRunSummary } from './SearchService';

interface SearchApiRun {
    runId: string;
    gameVersion: string;
    platform: string;
    testName: string;
    status: 'PASSED' | 'FAILED' | 'ABORTED';
    timestamp: string;
    avgFps?: number;
    minFps?: number;
    peakMemoryMb?: number;
    durationSeconds?: number;
    deviceModel?: string;
    triggeredBy?: string;
    totalSizeBytes?: number;
    updatedAt?: string;
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
    private async parseJsonResponse<T>(response: Response): Promise<T> {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await response.text();
            if (text.includes('<!doctype') || text.includes('<html')) {
                throw new Error(
                    'バックエンドAPIから予期せぬHTMLが返されました。ログインセッションが有効か、またはオンプレミスサーバー（Docker Compose）が起動しているか確認してください。',
                );
            }
            throw new Error(`Invalid response format: ${contentType || 'unknown'}`);
        }
        return (await response.json()) as T;
    }

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

        if (response.status === 401) {
            throw new Error('認証が必要です。ログインセッションを確認してください。');
        }

        if (!response.ok) {
            throw new Error(`Search API request failed with status ${response.status}.`);
        }

        const runs = await this.parseJsonResponse<SearchApiRun[]>(response);
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
        if (response.status === 401) {
            throw new Error('認証が必要です。ログインセッションを確認してください。');
        }
        if (!response.ok) {
            throw new Error(`Run detail API request failed with status ${response.status}.`);
        }
        const run = await this.parseJsonResponse<SearchApiRun>(response);
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
