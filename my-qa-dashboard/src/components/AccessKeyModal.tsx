import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Key, Loader2, Plus, Trash2, X } from 'lucide-react';
import { apiKeyService } from '../services';
import type { ApiKeyItem, CreatedApiKeyResponse } from '../services';

interface AccessKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AccessKeyModal({ isOpen, onClose }: AccessKeyModalProps) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New key creation state
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreatedApiKeyResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);

  const isMock = import.meta.env.VITE_USE_MOCK !== 'false';

  // Fetch user keys
  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiKeyService.listKeys();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchKeys();
      setNewlyCreatedKey(null);
      setKeyName('');
    }
  }, [isOpen, fetchKeys]);

  // Handle creation
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const data = await apiKeyService.createKey(keyName.trim());
      setNewlyCreatedKey(data);
      setKeyName('');
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  // Handle deletion
  const handleDeleteKey = async (keyId: string) => {
    if (!confirm('このAPIキーを無効化（削除）しますか？\nこのキーを使用したCLIアップロードはできなくなります。')) {
      return;
    }

    try {
      await apiKeyService.deleteKey(keyId);
      if (newlyCreatedKey?.keyId === keyId) {
        setNewlyCreatedKey(null);
      }
      await fetchKeys();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('コピーしてください:', text);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl p-6 text-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Key size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-100">CLI アップロード用 API キー管理</h2>
                {isMock && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    ローカル開発モック
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                テスト結果や大容量動画をアップロードするための個人用キーを発行・管理します。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-5 pr-1">
          {error && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Newly Created Key Alert */}
          {newlyCreatedKey && (
            <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-amber-300">
                  新しいAPIキーが発行されました（再表示されません）
                </span>
                <span className="text-xs text-amber-400/80">必ず安全にコピーしてください</span>
              </div>

              <div className="flex items-center gap-2 bg-slate-950 p-2.5 rounded border border-slate-800">
                <code className="flex-1 font-mono text-xs text-cyan-300 break-all select-all">
                  {newlyCreatedKey.apiKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newlyCreatedKey.apiKey, setCopiedKey)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-xs font-medium text-white transition-colors cursor-pointer"
                >
                  {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey ? 'コピー完了' : 'コピー'}
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>環境変数の設定例 (ターミナル / CI):</span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `export QA_SERVER_URL="${window.location.origin}"\nexport QA_API_KEY="${newlyCreatedKey.apiKey}"`,
                        setCopiedEnv,
                      )
                    }
                    className="text-cyan-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedEnv ? <Check size={12} /> : <Copy size={12} />}
                    {copiedEnv ? 'コピー済み' : 'コマンドをコピー'}
                  </button>
                </div>
                <pre className="bg-slate-950 p-2 rounded text-xs font-mono text-slate-300 overflow-x-auto border border-slate-800/80">
                  export QA_SERVER_URL=&quot;{window.location.origin}&quot;{'\n'}
                  export QA_API_KEY=&quot;{newlyCreatedKey.apiKey}&quot;
                </pre>
              </div>
            </div>
          )}

          {/* Issue New Key Form */}
          <form onSubmit={handleCreateKey} className="flex gap-2">
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="キーの用途や端末名（例: CI Runner, ローカル開発PC）"
              className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
              disabled={creating}
              maxLength={50}
            />
            <button
              type="submit"
              disabled={creating || !keyName.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              発行
            </button>
          </form>

          {/* Key List */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              有効な API キー一覧 ({keys.length})
            </h3>

            {loading ? (
              <div className="flex items-center justify-center p-8 text-slate-500">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : keys.length === 0 ? (
              <div className="p-6 rounded-lg border border-dashed border-slate-800 text-center text-sm text-slate-500">
                有効なAPIキーがありません。上のフォームから新しく発行してください。
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60 rounded-lg border border-slate-800 bg-slate-950/40">
                {keys.map((k) => (
                  <div key={k.keyId} className="flex items-center justify-between p-3.5 hover:bg-slate-800/20 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">{k.name}</span>
                        <code className="text-xs font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          {k.prefix}
                        </code>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        発行日時: {new Date(k.createdAt).toLocaleString('ja-JP')}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteKey(k.keyId)}
                      title="このキーを削除・失効"
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 pt-3 mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md border border-slate-700 bg-slate-800 text-sm text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
