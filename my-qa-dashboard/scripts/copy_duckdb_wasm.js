#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourceDir = path.join(projectRoot, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const targetDir = path.join(projectRoot, 'public', 'duckdb-wasm');

const FILES = [
  'duckdb-mvp.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-eh.wasm',
  'duckdb-browser-eh.worker.js',
];

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

let copiedCount = 0;
for (const file of FILES) {
  const src = path.join(sourceDir, file);
  const dest = path.join(targetDir, file);
  if (!fs.existsSync(src)) {
    console.error(`Source file not found: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  copiedCount++;
}

console.log(`Successfully copied ${copiedCount} DuckDB-WASM files to ${targetDir}`);
