export interface ApiKeyItem {
  keyId: string;
  name: string;
  email: string;
  createdAt: string;
  prefix: string;
}

export interface CreatedApiKeyResponse extends ApiKeyItem {
  apiKey: string;
}

export interface ApiKeyService {
  listKeys(): Promise<ApiKeyItem[]>;
  createKey(name: string): Promise<CreatedApiKeyResponse>;
  deleteKey(keyId: string): Promise<void>;
}

const LOCAL_STORAGE_KEY = 'game_qa_mock_api_keys';

/**
 * Mock API Key Service using browser localStorage.
 * Enables zero-dependency local development with `npm run dev` (Stage 1).
 */
export class MockApiKeyService implements ApiKeyService {
  private getStoredKeys(): ApiKeyItem[] {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private saveStoredKeys(keys: ApiKeyItem[]): void {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // Ignore storage write errors in private mode
    }
  }

  async listKeys(): Promise<ApiKeyItem[]> {
    // Simulate slight network delay
    await new Promise((resolve) => setTimeout(resolve, 80));
    return this.getStoredKeys();
  }

  async createKey(name: string): Promise<CreatedApiKeyResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const randomHex = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const apiKey = `gqa_live_mock_${randomHex}`;
    const keyId = `key_mock_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const newItem: ApiKeyItem = {
      keyId,
      name: name.trim() || 'CLI Key',
      email: 'local-dev@internal',
      createdAt: nowIso,
      prefix: `${apiKey.substring(0, 12)}...`,
    };

    const keys = this.getStoredKeys();
    keys.unshift(newItem);
    this.saveStoredKeys(keys);

    return {
      ...newItem,
      apiKey,
    };
  }

  async deleteKey(keyId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 60));
    const keys = this.getStoredKeys().filter((k) => k.keyId !== keyId);
    this.saveStoredKeys(keys);
  }
}

/**
 * Backend API Key Service connecting to on-premises FastAPI backend (/api/keys).
 */
export class ApiApiKeyService implements ApiKeyService {
  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      if (text.includes('<!doctype') || text.includes('<html')) {
        throw new Error(
          'バックエンドAPIから予期せぬHTMLが返されました。オンプレミスサーバー（Docker Compose）が起動しているか確認してください。',
        );
      }
      throw new Error(`Invalid response format: ${contentType || 'unknown'}`);
    }
    return (await response.json()) as T;
  }

  async listKeys(): Promise<ApiKeyItem[]> {
    const res = await fetch(`${import.meta.env.BASE_URL}api/keys`, {
      credentials: 'include',
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('ログインセッションが切れています。画面を再読み込みしてログインしてください。');
      }
      throw new Error(`APIキーの取得に失敗しました (${res.status})`);
    }
    return this.parseJsonResponse<ApiKeyItem[]>(res);
  }

  async createKey(name: string): Promise<CreatedApiKeyResponse> {
    const res = await fetch(`${import.meta.env.BASE_URL}api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('ログインセッションが切れています。');
      }
      throw new Error(`APIキーの発行に失敗しました (${res.status})`);
    }
    return this.parseJsonResponse<CreatedApiKeyResponse>(res);
  }

  async deleteKey(keyId: string): Promise<void> {
    const res = await fetch(`${import.meta.env.BASE_URL}api/keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(`APIキーの削除に失敗しました (${res.status})`);
    }
  }
}
