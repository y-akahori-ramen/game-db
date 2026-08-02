import type { SearchFilter, SearchService, TestRunSummary } from './SearchService';

/** Stub for the future S3/Athena-backed API. Enabled via VITE_USE_MOCK=false. */
export class ApiSearchService implements SearchService {
    searchRuns(_filter: SearchFilter): Promise<TestRunSummary[]> {
        return Promise.reject(new Error('ApiSearchService is not implemented yet'));
    }
}
