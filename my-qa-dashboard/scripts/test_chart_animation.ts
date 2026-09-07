import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const componentsDir = path.resolve(__dirname, '../src/components');

console.log('--- 1. Testing FpsChart animation setting ---');
const fpsChartSource = fs.readFileSync(path.join(componentsDir, 'FpsChart.tsx'), 'utf-8');
assert.match(fpsChartSource, /animation:\s*false/, 'FpsChart must have animation: false');
console.log('✓ FpsChart has animation: false configured.');

console.log('--- 2. Testing MemoryChart animation setting ---');
const memoryChartSource = fs.readFileSync(path.join(componentsDir, 'MemoryChart.tsx'), 'utf-8');
assert.match(memoryChartSource, /animation:\s*false/, 'MemoryChart must have animation: false');
console.log('✓ MemoryChart has animation: false configured.');

console.log('--- 3. Testing FpsDiffChart animation setting ---');
const fpsDiffChartSource = fs.readFileSync(path.join(componentsDir, 'FpsDiffChart.tsx'), 'utf-8');
assert.match(fpsDiffChartSource, /animation:\s*false/, 'FpsDiffChart must have animation: false');
console.log('✓ FpsDiffChart has animation: false configured.');

console.log('--- 4. Testing MemoryDiffChart animation setting ---');
const memoryDiffChartSource = fs.readFileSync(path.join(componentsDir, 'MemoryDiffChart.tsx'), 'utf-8');
assert.match(memoryDiffChartSource, /animation:\s*false/, 'MemoryDiffChart must have animation: false');
console.log('✓ MemoryDiffChart has animation: false configured.');

console.log('--- 5. Testing TrendsPage animation setting ---');
const trendsPageSource = fs.readFileSync(path.join(componentsDir, 'TrendsPage.tsx'), 'utf-8');
assert.match(trendsPageSource, /animation:\s*false/, 'TrendsPage must have animation: false');
console.log('✓ TrendsPage has animation: false configured.');

console.log('========================================');
console.log('All Chart Animation unit verification tests PASSED!');
console.log('========================================');
