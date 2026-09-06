import assert from 'node:assert/strict';
import {
  extractMediaItems,
  isImageFile,
  isVideoFile,
  toMediaUrl,
} from '../src/utils/mediaHelpers.ts';
import type { TestRunArtifact } from '../src/services/SearchService.ts';

console.log('--- 1. Testing isVideoFile and isImageFile ---');
assert.equal(isVideoFile('video.mp4'), true);
assert.equal(isVideoFile('cutscene.webm'), true);
assert.equal(isVideoFile('gameplay.MOV'), true);
assert.equal(isVideoFile('fps_metrics.csv'), false);
assert.equal(isVideoFile('crash.dmp'), false);

assert.equal(isImageFile('screenshot_001.png'), true);
assert.equal(isImageFile('PHOTO.JPEG'), true);
assert.equal(isImageFile('banner.webp'), true);
assert.equal(isImageFile('samplelog.log'), false);
assert.equal(isImageFile('test_report.html'), false);
console.log('✓ isVideoFile and isImageFile passed all checks.');

console.log('\n--- 2. Testing toMediaUrl ---');
assert.equal(toMediaUrl('https://cdn.example.com/video.mp4', '/'), 'https://cdn.example.com/video.mp4');
assert.equal(toMediaUrl('sample_data/run-001/video.mp4', '/my-app/'), '/my-app/sample_data/run-001/video.mp4');
assert.equal(toMediaUrl('/sample_data/run-001/shot.png', '/my-app'), '/my-app/sample_data/run-001/shot.png');
console.log('✓ toMediaUrl handled full URLs and relative base prefixes correctly.');

console.log('\n--- 3. Testing extractMediaItems with Multiple Videos & Screenshots ---');
const sampleArtifacts: TestRunArtifact[] = [
  { url: 'sample_data/run-001/fps_metrics.csv', fileName: 'fps_metrics.csv', type: 'fps' },
  { url: 'sample_data/run-001/memory_metrics.csv', fileName: 'memory_metrics.csv', type: 'memory' },
  { url: 'sample_data/run-001/samplelog.log', fileName: 'samplelog.log', type: 'log' },
  { url: 'sample_data/run-001/video.mp4', fileName: 'video.mp4', type: 'video' },
  { url: 'sample_data/run-001/video_boss_fight.mp4', fileName: 'video_boss_fight.mp4', type: 'video' },
  { url: 'sample_data/run-001/screenshot_001.png', fileName: 'screenshot_001.png', type: 'screenshot' },
  { url: 'sample_data/run-001/screenshot_002.png', fileName: 'screenshot_002.png', type: 'screenshot' },
  { url: 'sample_data/run-001/crash.dmp', fileName: 'crash.dmp', type: 'crashdump' },
];

const mediaItems = extractMediaItems(sampleArtifacts, 'sample_data/run-001/video.mp4');

console.log(`Total extracted media items: ${mediaItems.length}`);
assert.equal(mediaItems.length, 4, 'Should extract 2 videos and 2 screenshots (deduplicating videoUrl)');

const videos = mediaItems.filter((m) => m.type === 'video');
const screenshots = mediaItems.filter((m) => m.type === 'screenshot');

assert.equal(videos.length, 2, 'Should have 2 videos');
assert.equal(screenshots.length, 2, 'Should have 2 screenshots');

// Check order: videos first, then screenshots
assert.equal(mediaItems[0].type, 'video');
assert.equal(mediaItems[1].type, 'video');
assert.equal(mediaItems[2].type, 'screenshot');
assert.equal(mediaItems[3].type, 'screenshot');

console.log('Videos found:', videos.map((v) => v.fileName));
console.log('Screenshots found:', screenshots.map((s) => s.fileName));

console.log('\n--- 4. Testing extractMediaItems with No Media ---');
const emptyMedia = extractMediaItems([
  { url: 'sample_data/run-003/fps_metrics.json', fileName: 'fps_metrics.json', type: 'fps' },
  { url: 'sample_data/run-003/memory_metrics.json', fileName: 'memory_metrics.json', type: 'memory' },
]);
assert.equal(emptyMedia.length, 0, 'Runs with no videos/screenshots should return empty array');
console.log('✓ Run without media correctly returns 0 items.');

console.log('\n--- 5. Testing Web-optimized Video Priority Sorting ---');
const mixedArtifacts: TestRunArtifact[] = [
  { url: 'runs/r1/video.mp4', fileName: 'video.mp4', type: 'video' },
  { url: 'runs/r1/video_web.mp4', fileName: 'video_web.mp4', type: 'video' },
];
const mixedItems = extractMediaItems(mixedArtifacts);
assert.equal(mixedItems[0].fileName, 'video_web.mp4', 'Web-optimized video should be sorted before raw video');
assert.equal(mixedItems[1].fileName, 'video.mp4');
console.log('✓ Web-optimized video is correctly prioritized first.');

console.log('\n========================================');
console.log('All Media Viewer unit verification tests PASSED!');
console.log('========================================');
