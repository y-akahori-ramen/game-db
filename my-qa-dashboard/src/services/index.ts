import { MockSearchService } from './MockSearchService';
import { ApiSearchService } from './ApiSearchService';
import type { SearchService } from './SearchService';
import { MockApiKeyService, ApiApiKeyService } from './ApiKeyService';
import type { ApiKeyService } from './ApiKeyService';

export type {
    SearchFilter,
    SearchService,
    TestRunSummary,
    TestRunArtifact,
    TestRunArtifactType,
} from './SearchService';

export type {
    ApiKeyItem,
    CreatedApiKeyResponse,
    ApiKeyService,
} from './ApiKeyService';

// Mock unless explicitly disabled (VITE_USE_MOCK=false).
export const searchService: SearchService =
    import.meta.env.VITE_USE_MOCK === 'false' ? new ApiSearchService() : new MockSearchService();

export const apiKeyService: ApiKeyService =
    import.meta.env.VITE_USE_MOCK === 'false' ? new ApiApiKeyService() : new MockApiKeyService();

