import { useEffect, useState } from 'react';
import { handleCallback } from './login';

export default function CallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void handleCallback().catch((callbackError) => {
      if (!active) return;
      setError(callbackError instanceof Error ? callbackError.message : String(callbackError));
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-6 py-5 text-center">
        <p className="text-sm font-medium text-slate-200">
          {error ? 'ログインに失敗しました。' : 'ログイン中...'}
        </p>
        <p className={`mt-2 text-sm ${error ? 'text-red-400' : 'text-slate-400'}`}>
          {error ?? 'Cognito からの認証結果を処理しています。'}
        </p>
      </div>
    </div>
  );
}
