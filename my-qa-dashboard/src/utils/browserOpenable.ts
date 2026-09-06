import type { TestRunArtifact } from '../services';

/**
 * File extensions that modern web browsers can natively display
 * (text, structured data, web markup, standard images, audio, video, PDF).
 */
export const BROWSER_OPENABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Web documents & markup
  'html',
  'htm',
  'xhtml',
  'xml',
  'svg',
  // Text & data files
  'txt',
  'text',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'md',
  'markdown',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'diff',
  'patch',
  'sql',
  'css',
  'js',
  'mjs',
  'cjs',
  // Images
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'apng',
  // Audio
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'weba',
  // Video
  'mp4',
  'webm',
  'ogv',
  // PDF
  'pdf',
]);

/**
 * Extracts lowercase file extension from a file name or path.
 * Ignores URL query parameters and hashes.
 */
export function getFileExtension(fileName: string): string {
  const cleanName = fileName.split(/[?#]/)[0];
  const lastSlash = Math.max(cleanName.lastIndexOf('/'), cleanName.lastIndexOf('\\'));
  const nameOnly = lastSlash >= 0 ? cleanName.slice(lastSlash + 1) : cleanName;
  const dotIndex = nameOnly.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return nameOnly.slice(dotIndex + 1).toLowerCase();
}

/**
 * Determines whether the given artifact format can be natively opened/viewed in a browser window.
 * Checks both file extension and MIME type.
 */
export function isBrowserOpenable(
  artifact: Pick<TestRunArtifact, 'fileName'> & Partial<Pick<TestRunArtifact, 'mimeType'>>,
): boolean {
  const ext = getFileExtension(artifact.fileName);
  if (ext && BROWSER_OPENABLE_EXTENSIONS.has(ext)) {
    return true;
  }

  if (artifact.mimeType) {
    const mime = artifact.mimeType.toLowerCase();
    if (
      mime.startsWith('text/') ||
      mime.startsWith('image/') ||
      mime.startsWith('video/') ||
      mime.startsWith('audio/') ||
      mime === 'application/pdf' ||
      mime === 'application/json' ||
      mime === 'application/xml' ||
      mime === 'application/xhtml+xml' ||
      mime === 'application/javascript'
    ) {
      return true;
    }
  }

  return false;
}
