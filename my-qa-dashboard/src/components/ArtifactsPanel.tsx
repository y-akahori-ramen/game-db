import { useCallback, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
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
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ArtifactsPanel({ runId, artifacts }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const artifactHref = useCallback(
    (artifact: TestRunArtifact) => `${import.meta.env.BASE_URL}${artifact.url}`,
    [],
  );

  const handleDownloadOne = useCallback(
    async (artifact: TestRunArtifact) => {
      setError(null);
      setDownloadingUrl(artifact.url);
      try {
        const res = await fetch(artifactHref(artifact));
        if (!res.ok) throw new Error(`Failed to fetch ${artifact.fileName}: ${res.status}`);
        saveBlob(await res.blob(), artifact.fileName);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDownloadingUrl(null);
      }
    },
    [artifactHref],
  );

  const handleDownloadAll = useCallback(async () => {
    setError(null);
    setDownloadingAll(true);
    try {
      const responses = await Promise.all(
        artifacts.map(async (artifact) => {
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
  }, [artifacts, artifactHref, runId]);

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
          disabled={artifacts.length === 0 || downloadingAll}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloadingAll ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FileArchive size={14} />
          )}
          {downloadingAll ? 'ZIP作成中...' : '全成果物をZIPでダウンロード'}
        </button>
      </div>
      {expanded && (
        <div className="mt-3">
          {error && <p className="mb-2 text-xs text-red-400">エラー: {error}</p>}
          {artifacts.length === 0 ? (
            <p className="text-sm text-slate-600">成果物がありません。</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {artifacts.map((artifact) => {
                const Icon = TYPE_ICONS[artifact.type] ?? FileArchive;
                const isDownloading = downloadingUrl === artifact.url;
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
                    <button
                      onClick={() => handleDownloadOne(artifact)}
                      disabled={isDownloading}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDownloading ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      DL
                    </button>
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
