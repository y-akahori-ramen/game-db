import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Film,
  Image as ImageIcon,
  Grid,
  List,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Download,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Play,
  FileVideo,
  FileImage,
  Folder,
  SlidersHorizontal,
} from 'lucide-react';
import type { TestRunArtifact } from '../services';
import {
  extractMediaItems,
  toMediaUrl,
  type MediaItem,
} from '../utils/mediaHelpers';

export type { MediaItem };

interface MediaViewerProps {
  runId: string;
  artifacts?: TestRunArtifact[];
  videoUrl?: string;
  currentTime?: number;
  selectedMediaFileName?: string;
  onSeekTime?: (time: number) => void;
  onSelectMedia?: (fileName: string) => void;
}

type ViewMode = 'grid' | 'list';
type CategoryFilter = 'all' | 'video' | 'screenshot';

export default function MediaViewer({
  runId,
  artifacts = [],
  videoUrl,
  currentTime,
  selectedMediaFileName,
  onSeekTime,
  onSelectMedia,
}: MediaViewerProps) {
  // Collect all media items from artifacts and videoUrl
  const mediaItems = useMemo<MediaItem[]>(() => {
    return extractMediaItems(artifacts, videoUrl);
  }, [artifacts, videoUrl]);

  // View preferences
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoElementRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Selected media item state
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (selectedMediaFileName) {
      const match = mediaItems.find((item) => item.fileName === selectedMediaFileName);
      if (match) return match.id;
    }
    return mediaItems[0]?.id ?? null;
  });

  // Sync selectedId with selectedMediaFileName prop if changed
  useEffect(() => {
    if (selectedMediaFileName) {
      const match = mediaItems.find((item) => item.fileName === selectedMediaFileName);
      if (match) {
        setSelectedId(match.id);
        return;
      }
    }
    // If current selectedId is invalid or absent, fall back to first item
    if (!selectedId || !mediaItems.some((item) => item.id === selectedId)) {
      if (mediaItems.length > 0) {
        setSelectedId(mediaItems[0].id);
      }
    }
  }, [selectedMediaFileName, mediaItems, selectedId]);

  const selectedItem = useMemo(() => {
    return mediaItems.find((item) => item.id === selectedId) ?? mediaItems[0] ?? null;
  }, [mediaItems, selectedId]);

  // Filtered items based on category and search query
  const filteredItems = useMemo(() => {
    return mediaItems.filter((item) => {
      if (categoryFilter !== 'all' && item.type !== categoryFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return item.fileName.toLowerCase().includes(q);
      }
      return true;
    });
  }, [mediaItems, categoryFilter, searchQuery]);

  // Video seeking sync with currentTime prop
  useEffect(() => {
    if (
      selectedItem?.type === 'video' &&
      currentTime !== undefined &&
      videoElementRef.current
    ) {
      const diff = Math.abs(videoElementRef.current.currentTime - currentTime);
      if (diff > 0.5) {
        videoElementRef.current.currentTime = currentTime;
      }
    }
  }, [currentTime, selectedItem]);

  // Update playback rate when changed
  useEffect(() => {
    if (videoElementRef.current) {
      videoElementRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, selectedItem]);

  // Reset zoom when selecting a new item
  useEffect(() => {
    setZoomLevel(1);
  }, [selectedItem?.id]);

  const handleSelectItem = useCallback(
    (item: MediaItem) => {
      setSelectedId(item.id);
      onSelectMedia?.(item.fileName);
    },
    [onSelectMedia],
  );

  // Prev / Next item navigation
  const currentIndex = useMemo(() => {
    if (!selectedItem) return -1;
    return filteredItems.findIndex((item) => item.id === selectedItem.id);
  }, [filteredItems, selectedItem]);

  const handlePrev = useCallback(() => {
    if (filteredItems.length === 0) return;
    const newIdx = currentIndex <= 0 ? filteredItems.length - 1 : currentIndex - 1;
    handleSelectItem(filteredItems[newIdx]);
  }, [filteredItems, currentIndex, handleSelectItem]);

  const handleNext = useCallback(() => {
    if (filteredItems.length === 0) return;
    const newIdx = currentIndex >= filteredItems.length - 1 ? 0 : currentIndex + 1;
    handleSelectItem(filteredItems[newIdx]);
  }, [filteredItems, currentIndex, handleSelectItem]);

  // Keyboard navigation (Left / Right arrow keys)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    },
    [handlePrev, handleNext],
  );

  const resolveUrl = useCallback(
    (url: string) => toMediaUrl(url, import.meta.env.BASE_URL),
    [],
  );

  // Download media
  const handleDownload = useCallback(
    (item: MediaItem) => {
      const link = document.createElement('a');
      link.href = resolveUrl(item.url);
      link.download = item.fileName;
      link.target = '_blank';
      link.click();
      link.remove();
    },
    [resolveUrl],
  );

  // Fullscreen toggle for container
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        // Fullscreen not supported or blocked
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const videoCount = mediaItems.filter((i) => i.type === 'video').length;
  const screenshotCount = mediaItems.filter((i) => i.type === 'screenshot').length;

  if (mediaItems.length === 0) {
    return null;
  }

  return (
    <section
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className={`rounded-lg border border-slate-800 bg-slate-900/60 shadow-xl backdrop-blur-sm transition-all focus:outline-none focus:ring-1 focus:ring-cyan-500/50 ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none bg-slate-950 p-4' : 'p-4'
      }`}
    >
      {/* OS File Explorer Window Title Bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          {/* Section Title */}
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
            <Film size={17} className="text-purple-400" />
            Media Viewer
          </h2>

          <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-400">
            {mediaItems.length} items
          </span>
        </div>

        {/* Explorer Breadcrumb / Address Bar */}
        <div className="hidden lg:flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs text-slate-400 font-mono">
          <Folder size={13} className="text-cyan-400" />
          <span>runs</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-300">{runId}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">media</span>
          {selectedItem && (
            <>
              <span className="text-slate-600">/</span>
              <span className="text-cyan-300 font-medium">{selectedItem.fileName}</span>
            </>
          )}
        </div>

        {/* View Controls & Fullscreen Toggle */}
        <div className="flex items-center gap-2">
          {/* Grid / List View Toggle */}
          <div className="flex items-center rounded-md border border-slate-800 bg-slate-950/80 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="グリッド表示 (Grid View)"
              className={`rounded p-1 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-slate-800 text-cyan-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title="リスト表示 (List View)"
              className={`rounded p-1 transition-colors ${
                viewMode === 'list'
                  ? 'bg-slate-800 text-cyan-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <List size={15} />
            </button>
          </div>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? '全画面終了' : '全画面表示'}
            className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950/80 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Media Viewer Main Container: Split Layout (Explorer Left + Preview Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: File Explorer Pane */}
        <div className="lg:col-span-4 xl:col-span-4 flex flex-col rounded-lg border border-slate-800/80 bg-slate-950/50 overflow-hidden">
          {/* Explorer Filter Toolbar */}
          <div className="border-b border-slate-800/80 p-2.5 space-y-2 bg-slate-900/40">
            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-all ${
                  categoryFilter === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                すべて ({mediaItems.length})
              </button>
              {videoCount > 0 && (
                <button
                  type="button"
                  onClick={() => setCategoryFilter('video')}
                  className={`flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-all ${
                    categoryFilter === 'video'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <Film size={12} />
                  動画 ({videoCount})
                </button>
              )}
              {screenshotCount > 0 && (
                <button
                  type="button"
                  onClick={() => setCategoryFilter('screenshot')}
                  className={`flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-all ${
                    categoryFilter === 'screenshot'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <ImageIcon size={12} />
                  スクショ ({screenshotCount})
                </button>
              )}
            </div>

            {/* Quick Search Input */}
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="text"
                placeholder="ファイル名で絞り込み..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 pl-7 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Explorer File List / Grid Content */}
          <div className="flex-1 overflow-y-auto max-h-[460px] p-2">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-slate-500">
                <Folder size={28} className="mb-2 stroke-1 text-slate-600" />
                <p>該当するメディアファイルがありません</p>
              </div>
            ) : viewMode === 'grid' ? (
              /* Grid View with Thumbnails */
              <div className="grid grid-cols-2 gap-2">
                {filteredItems.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  const isVideo = item.type === 'video';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      className={`group relative flex flex-col rounded-md border p-2 text-left transition-all ${
                        isSelected
                          ? 'border-cyan-400 bg-cyan-950/40 ring-2 ring-cyan-500/50 shadow-md shadow-cyan-950/50'
                          : 'border-slate-800/80 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/60'
                      }`}
                    >
                      {/* Thumbnail Container */}
                      <div className="relative mb-2 aspect-video w-full overflow-hidden rounded bg-slate-950 flex items-center justify-center border border-slate-800/50">
                        {isVideo ? (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-950/40 to-slate-950 text-purple-400">
                            <FileVideo size={24} className="group-hover:scale-110 transition-transform" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play size={20} className="text-white drop-shadow" />
                            </div>
                          </div>
                        ) : (
                          <img
                            src={resolveUrl(item.url)}
                            alt={item.fileName}
                            loading="lazy"
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                          />
                        )}

                        {/* File Format Badge */}
                        <span
                          className={`absolute bottom-1 right-1 rounded px-1 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider backdrop-blur-xs ${
                            isVideo
                              ? 'bg-purple-900/80 text-purple-200'
                              : 'bg-slate-900/80 text-cyan-300'
                          }`}
                        >
                          {isVideo ? 'MP4' : 'PNG'}
                        </span>
                      </div>

                      {/* File Name */}
                      <span
                        className={`truncate text-xs font-medium ${
                          isSelected
                            ? 'text-cyan-300 font-semibold'
                            : 'text-slate-300 group-hover:text-slate-100'
                        }`}
                        title={item.fileName}
                      >
                        {item.fileName}
                      </span>

                      {/* Sub-label */}
                      <span className="text-[10px] text-slate-500">
                        {isVideo ? '動画ファイル' : 'スクリーンショット'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* List / Details View */
              <div className="divide-y divide-slate-800/60">
                {filteredItems.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  const isVideo = item.type === 'video';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors rounded-md ${
                        isSelected
                          ? 'bg-cyan-950/40 text-cyan-300 font-semibold ring-1 ring-cyan-500/40'
                          : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                      }`}
                    >
                      {isVideo ? (
                        <FileVideo size={16} className="shrink-0 text-purple-400" />
                      ) : (
                        <FileImage size={16} className="shrink-0 text-emerald-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.fileName}>
                        {item.fileName}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${
                          isVideo
                            ? 'bg-purple-950 text-purple-300 border border-purple-800/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isVideo ? 'VIDEO' : 'IMG'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Explorer Status Bar Footer */}
          <div className="border-t border-slate-800/80 px-3 py-1.5 text-[11px] text-slate-500 bg-slate-900/30 flex items-center justify-between">
            <span>
              {filteredItems.length} 個のファイル
            </span>
            {selectedItem && (
              <span className="truncate max-w-[160px] text-slate-400 font-mono text-[10px]">
                {selectedItem.fileName}
              </span>
            )}
          </div>
        </div>

        {/* Right Column: Active Media Preview Viewer */}
        <div className="lg:col-span-8 xl:col-span-8 flex flex-col rounded-lg border border-slate-800/80 bg-slate-950/70 overflow-hidden">
          {/* Preview Header / Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/40 px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              {/* Previous / Next buttons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePrev}
                  title="前へ (Left Arrow)"
                  disabled={filteredItems.length <= 1}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-mono text-slate-500">
                  {currentIndex >= 0 ? currentIndex + 1 : 0} / {filteredItems.length}
                </span>
                <button
                  type="button"
                  onClick={handleNext}
                  title="次へ (Right Arrow)"
                  disabled={filteredItems.length <= 1}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="h-4 w-px bg-slate-800 mx-1" />

              {/* Active Media File Title */}
              {selectedItem && (
                <div className="flex items-center gap-2 truncate">
                  {selectedItem.type === 'video' ? (
                    <FileVideo size={16} className="shrink-0 text-purple-400" />
                  ) : (
                    <FileImage size={16} className="shrink-0 text-emerald-400" />
                  )}
                  <span className="truncate text-xs font-semibold text-slate-200">
                    {selectedItem.fileName}
                  </span>
                </div>
              )}
            </div>

            {/* Preview Actions & Time/Zoom info */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Video Specific: Timestamp sync badge & Playback rate */}
              {selectedItem?.type === 'video' && (
                <>
                  {currentTime !== undefined && (
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-cyan-300 font-mono">
                      Time: {currentTime.toFixed(1)}s
                    </span>
                  )}

                  {/* Playback speed selector */}
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <SlidersHorizontal size={12} />
                    <select
                      value={playbackRate}
                      onChange={(e) => setPlaybackRate(Number(e.target.value))}
                      className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-300 focus:outline-none"
                    >
                      <option value={0.5}>0.5x</option>
                      <option value={1}>1.0x</option>
                      <option value={1.25}>1.25x</option>
                      <option value={1.5}>1.5x</option>
                      <option value={2}>2.0x</option>
                    </select>
                  </div>
                </>
              )}

              {/* Screenshot Specific: Zoom controls */}
              {selectedItem?.type === 'screenshot' && (
                <div className="flex items-center gap-1 border border-slate-800 rounded bg-slate-900/70 p-0.5">
                  <button
                    type="button"
                    onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                    title="縮小"
                    className="rounded p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span className="px-1 text-[11px] font-mono text-slate-400">
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                    title="拡大"
                    className="rounded p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  >
                    <ZoomIn size={13} />
                  </button>
                  {zoomLevel !== 1 && (
                    <button
                      type="button"
                      onClick={() => setZoomLevel(1)}
                      title="等倍に戻す"
                      className="rounded p-1 text-cyan-400 hover:bg-slate-800"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
              )}

              {/* Open in new window */}
              {selectedItem && (
                <a
                  href={resolveUrl(selectedItem.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="新しいタブで開く"
                  className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <ExternalLink size={13} />
                  <span className="hidden sm:inline">開く</span>
                </a>
              )}

              {/* Download */}
              {selectedItem && (
                <button
                  type="button"
                  onClick={() => handleDownload(selectedItem)}
                  title="ダウンロード"
                  className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  <Download size={13} />
                  <span className="hidden sm:inline">DL</span>
                </button>
              )}
            </div>
          </div>

          {/* Preview Main Display Area */}
          <div className="relative flex min-h-[380px] max-h-[560px] flex-1 items-center justify-center overflow-auto bg-black/90 p-2">
            {!selectedItem ? (
              <div className="text-center text-sm text-slate-500">
                ファイルを選択してプレビュー
              </div>
            ) : selectedItem.type === 'video' ? (
              /* Video Player Display */
              <video
                ref={videoElementRef}
                key={selectedItem.url}
                controls
                preload="metadata"
                className="max-h-[520px] w-full max-w-4xl rounded object-contain shadow-2xl"
                src={resolveUrl(selectedItem.url)}
                onLoadedMetadata={() => {
                  if (currentTime !== undefined && videoElementRef.current) {
                    videoElementRef.current.currentTime = currentTime;
                  }
                  if (videoElementRef.current) {
                    videoElementRef.current.playbackRate = playbackRate;
                  }
                }}
                onSeeked={() => {
                  if (videoElementRef.current && onSeekTime) {
                    onSeekTime(videoElementRef.current.currentTime);
                  }
                }}
              >
                お使いのブラウザは動画再生に対応していません。
              </video>
            ) : (
              /* Screenshot Viewer Display */
              <div className="flex h-full w-full items-center justify-center overflow-auto">
                <img
                  src={resolveUrl(selectedItem.url)}
                  alt={selectedItem.fileName}
                  style={{ transform: `scale(${zoomLevel})` }}
                  className="max-h-[520px] max-w-full rounded object-contain shadow-2xl transition-transform duration-150 ease-out"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
