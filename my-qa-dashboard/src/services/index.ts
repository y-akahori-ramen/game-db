import { MockSearchService } from './MockSearchService';
import { ApiSearchService } from './ApiSearchService';
import type { SearchService } from './SearchService';

export type { SearchFilter, SearchService, TestRunSummary } from './SearchService';

// Mock unless explicitly disabled (VITE_USE_MOCK=false).
export const searchService: SearchService =
    import.meta.env.VITE_USE_MOCK === 'false' ? new ApiSearchService() : new MockSearchService();
