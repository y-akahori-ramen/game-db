import { useCallback, useMemo, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Gauge,
  Image as ImageIcon,
  Loader2,
  MemoryStick,
  ScrollText,
  Video,
  Bug,
  Activity,
} from 'lucide-react';
import { downloadZip } from 'client-zip';
import type { TestRunArtifact, TestRunArtifactType } from '../services';
import { isBrowserOpenable } from '../utils/browserOpenable';

interface Props {
  runId: string;
  artifacts: TestRunArtifact[];
}

const TYPE_ICONS: Record<TestRunArtifactType, typeof Gauge> = {
  fps: Gauge,
  memory: MemoryStick,
  log: ScrollText,
  video: Video,
  screenshot: ImageIcon,
  crashdump: Bug,
  trace: Activity,
  report: FileText,
  other: FileArchive,
};

const TYPE_LABELS: Record<TestRunArtifactType, string> = {
  fps: 'FPS',
  memory: 'Memory',
  log: 'Log',
  video: 'Video',
  screenshot: 'Screenshot',
  crashdump: 'Crash Dump',
  trace: 'Trace',
  report: 'Report',
  other: 'Other',
};

/** Triggers a browser download of a same-origin Blob under the given file name. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ArtifactsPanel({ runId, artifacts }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Large files (such as videos or files > 100MB) are excluded from client-side zip to prevent OOM
  const isExcludedFromZip = useCallback((artifact: TestRunArtifact) => {
    if (artifact.type === 'video') return true;
    if (artifact.sizeBytes && artifact.sizeBytes > 100 * 1024 * 1024) return true;
    return false;
  }, []);

  const zipEligibleArtifacts = useMemo(() => {
    return artifacts.filter((a) => !isExcludedFromZip(a));
  }, [artifacts, isExcludedFromZip]);

  const excludedCount = artifacts.length - zipEligibleArtifacts.length;

  const artifactHref = useCallback((artifact: TestRunArtifact) => {
    if (/^https?:\/\//i.test(artifact.url)) {
      return artifact.url;
    }
    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const cleanUrl = artifact.url.replace(/^\/+/, '');
    return `${base}${cleanUrl}`;
  }, []);

  const handleOpenOne = useCallback(
    (artifact: TestRunArtifact) => {
      window.open(artifactHref(artifact), '_blank', 'noopener,noreferrer');
    },
    [artifactHref],
  );

  const handleDownloadOne = useCallback(
    (artifact: TestRunArtifact) => {
      // Trigger native direct browser download to avoid buffering large files in JS memory
      const link = document.createElement('a');
      link.href = artifactHref(artifact);
      link.download = artifact.fileName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [artifactHref],
  );

  const handleDownloadAll = useCallback(async () => {
    if (zipEligibleArtifacts.length === 0) return;
    setError(null);
    setDownloadingAll(true);
    try {
      const responses = await Promise.all(
        zipEligibleArtifacts.map(async (artifact) => {
          const res = await fetch(artifactHref(artifact));
          if (!res.ok) throw new Error(`Failed to fetch ${artifact.fileName}: ${res.status}`);
          return { name: artifact.fileName, input: res };
        }),
      );
      const blob = await downloadZip(responses).blob();
      saveBlob(blob, `${runId}_artifacts.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingAll(false);
    }
  }, [zipEligibleArtifacts, artifactHref, runId]);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-slate-100"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Archive size={16} className="text-orange-400" /> 成果物 (Artifacts)
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">
            {artifacts.length}
          </span>
        </button>
        <button
          onClick={handleDownloadAll}
          disabled={zipEligibleArtifacts.length === 0 || downloadingAll}
          title={
            excludedCount > 0
              ? `動画等の大容量ファイル (${excludedCount}件) を除いた ${zipEligibleArtifacts.length} 件をZIPでダウンロード`
              : '全成果物をZIPでダウンロード'
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloadingAll ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FileArchive size={14} />
          )}
          {downloadingAll
            ? 'ZIP作成中...'
            : excludedCount > 0
            ? `ZIPダウンロード (${zipEligibleArtifacts.length}件)`
            : '全成果物をZIPでダウンロード'}
        </button>
      </div>
      {expanded && (
        <div className="mt-3">
          {error && <p className="mb-2 text-xs text-red-400">エラー: {error}</p>}
          {excludedCount > 0 && (
            <div className="mb-3 rounded border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
              ※ 動画などの大容量ファイル（{excludedCount}件）はブラウザのメモリ保護のためZIP一括ダウンロードから除外されています。個別の「DL」ボタンから直接ダウンロードしてください。
            </div>
          )}
          {artifacts.length === 0 ? (
            <p className="text-sm text-slate-600">成果物がありません。</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {artifacts.map((artifact) => {
                const Icon = TYPE_ICONS[artifact.type] ?? FileArchive;
                const canOpen = isBrowserOpenable(artifact);
                return (
                  <li
                    key={artifact.url}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon size={16} className="shrink-0 text-slate-400" />
                      <span className="truncate text-slate-200">{artifact.fileName}</span>
                      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        {TYPE_LABELS[artifact.type] ?? artifact.type}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenOne(artifact)}
                        disabled={!canOpen}
                        title={canOpen ? 'ブラウザで開く' : 'この形式はブラウザで開けません'}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                      >
                        <ExternalLink size={12} />
                        開く
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadOne(artifact)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        <Download size={12} />
                        DL
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
