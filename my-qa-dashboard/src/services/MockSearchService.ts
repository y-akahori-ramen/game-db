import type { SearchFilter, SearchService, TestRunSummary } from './SearchService';

function matches(run: TestRunSummary, filter: SearchFilter): boolean {
    if (filter.gameVersion && !run.gameVersion.toLowerCase().includes(filter.gameVersion.toLowerCase())) {
        return false;
    }
    if (filter.platform && run.platform !== filter.platform) return false;
    if (filter.testName && !run.testName.toLowerCase().includes(filter.testName.toLowerCase())) {
        return false;
    }
    if (filter.status && run.status !== filter.status) return false;
    return true;
}

/** Local mock backed by public/mock_data/runs.json; filtering happens client-side. */
export class MockSearchService implements SearchService {
    private runsPromise: Promise<TestRunSummary[]> | null = null;

    private fetchRuns(): Promise<TestRunSummary[]> {
        if (!this.runsPromise) {
            this.runsPromise = fetch(`${import.meta.env.BASE_URL}mock_data/runs.json`).then((res) => {
                if (!res.ok) {
                    this.runsPromise = null;
                    throw new Error(`Failed to fetch runs.json: ${res.status}`);
                }
                return res.json() as Promise<TestRunSummary[]>;
            });
        }
        return this.runsPromise;
    }

    async searchRuns(filter: SearchFilter): Promise<TestRunSummary[]> {
        const runs = await this.fetchRuns();
        return runs.filter((run) => matches(run, filter));
    }

    async getRun(runId: string): Promise<TestRunSummary | null> {
        const runs = await this.fetchRuns();
        return runs.find((run) => run.runId === runId) ?? null;
    }
}
