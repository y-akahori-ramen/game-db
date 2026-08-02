import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Search, XCircle } from 'lucide-react';
import { searchService } from '../services';
import type { TestRunSummary } from '../services';

const PLATFORMS = ['PS5', 'Windows', 'iOS'];
const STATUSES = ['PASSED', 'FAILED'];

interface Props {
    onOpenRun: (run: TestRunSummary) => void;
}

export default function SearchPage({ onOpenRun }: Props) {
    const [gameVersion, setGameVersion] = useState('');
    const [platform, setPlatform] = useState('');
    const [status, setStatus] = useState('');
    const [runs, setRuns] = useState<TestRunSummary[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searched, setSearched] = useState(false);

    const runSearch = useCallback(async () => {
        setSearching(true);
        setSearchError(null);
        try {
            const results = await searchService.searchRuns({
                gameVersion: gameVersion || undefined,
                platform: platform || undefined,
                status: status || undefined,
            });
            setRuns(results);
            setSearched(true);
        } catch (e) {
            setSearchError(e instanceof Error ? e.message : String(e));
        } finally {
            setSearching(false);
        }
    }, [gameVersion, platform, status]);

    // Show all runs on first visit.
    useEffect(() => {
        void runSearch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        void runSearch();
    };

    return (
        <div className="p-6 space-y-6">
            {/* Search filter form */}
            <form
                onSubmit={handleSubmit}
                className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
            >
                <div className="flex flex-wrap items-end gap-4">
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                        Game Version
                        <input
                            type="text"
                            value={gameVersion}
                            onChange={(e) => setGameVersion(e.target.value)}
                            placeholder="v1.2.0"
                            className="w-40 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                        Platform
                        <select
                            value={platform}
                            onChange={(e) => setPlatform(e.target.value)}
                            className="w-36 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                        >
                            <option value="">All Platforms</option>
                            {PLATFORMS.map((p) => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                        Status
                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                            className="w-32 bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                        >
                            <option value="">All</option>
                            {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="submit"
                        disabled={searching}
                        className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                        検索
                    </button>
                </div>
                {searchError && <p className="mt-3 text-sm text-red-400">検索エラー: {searchError}</p>}
            </form>

            {/* Results table */}
            <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                    <thead className="bg-slate-900">
                        <tr className="text-left text-slate-400 border-b border-slate-800">
                            <th className="px-3 py-2 font-medium">Run ID</th>
                            <th className="px-3 py-2 font-medium">Timestamp</th>
                            <th className="px-3 py-2 font-medium">Version</th>
                            <th className="px-3 py-2 font-medium">Platform</th>
                            <th className="px-3 py-2 font-medium">Test Name</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map((run) => (
                            <tr key={run.runId} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                                <td className="px-3 py-2 text-slate-200 font-medium">{run.runId}</td>
                                <td className="px-3 py-2 text-slate-400 tabular-nums">{run.timestamp}</td>
                                <td className="px-3 py-2 text-slate-300">{run.gameVersion}</td>
                                <td className="px-3 py-2 text-slate-300">{run.platform}</td>
                                <td className="px-3 py-2 text-slate-300">{run.testName}</td>
                                <td className="px-3 py-2">
                                    {run.status === 'PASSED' ? (
                                        <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-400">
                                            <CheckCircle2 size={12} /> PASSED
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                                            <XCircle size={12} /> FAILED
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2">
                                    <button
                                        onClick={() => onOpenRun(run)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-cyan-700 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10"
                                    >
                                        <FolderOpen size={14} /> 開く
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {runs.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                                    {searching
                                        ? 'Searching...'
                                        : searched
                                            ? '条件に一致するテストランがありません。'
                                            : ''}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
