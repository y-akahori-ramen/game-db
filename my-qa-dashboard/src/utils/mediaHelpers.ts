import type { TestRunArtifact } from '../services/SearchService.ts';

export interface MediaItem {
  id: string;
  url: string;
  fileName: string;
  type: 'video' | 'screenshot';
  sizeBytes?: number;
}

export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'];

export function isVideoFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isImageFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function toMediaUrl(url: string, baseUrl = '/'): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const clean = url.replace(/^\/+/, '');
  return `${base}${clean}`;
}

export function extractMediaItems(
  artifacts: TestRunArtifact[] = [],
  videoUrl?: string,
): MediaItem[] {
  const items: MediaItem[] = [];
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();

  const addItem = (item: MediaItem) => {
    if (seenUrls.has(item.url) || seenNames.has(item.fileName)) return;
    seenUrls.add(item.url);
    seenNames.add(item.fileName);
    items.push(item);
  };

  // 1. Process explicit videoUrl if specified
  if (videoUrl) {
    const fileName = videoUrl.split('/').pop() || 'video.mp4';
    addItem({
      id: `main-video-${videoUrl}`,
      url: videoUrl,
      fileName,
      type: 'video',
    });
  }

  // 2. Process artifacts
  for (const art of artifacts) {
    if (art.type === 'video' || isVideoFile(art.fileName)) {
      addItem({
        id: `art-video-${art.url}`,
        url: art.url,
        fileName: art.fileName,
        type: 'video',
        sizeBytes: art.sizeBytes,
      });
    } else if (art.type === 'screenshot' || isImageFile(art.fileName)) {
      addItem({
        id: `art-shot-${art.url}`,
        url: art.url,
        fileName: art.fileName,
        type: 'screenshot',
        sizeBytes: art.sizeBytes,
      });
    }
  }

  // 3. Sort: Videos first, then Screenshots; secondary sort by fileName
  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'video' ? -1 : 1;
    }
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
  });
}
