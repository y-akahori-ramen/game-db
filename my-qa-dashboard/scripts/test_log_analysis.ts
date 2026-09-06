import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseUeLogText } from '../src/utils/ueLogParser.ts';
import {
  buildLogSearchCondition,
  escapeSql,
  splitTextByMatches,
} from '../src/utils/logQueryHelpers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleLogPath = path.resolve(__dirname, '../public/sample_data/samplelog.log');

console.log('--- 1. Testing UE Log Parser with Sample Data ---');
const rawLog = fs.readFileSync(sampleLogPath, 'utf8');
const entries = parseUeLogText(rawLog);

console.log(`Total parsed entries: ${entries.length}`);
if (entries.length < 600) {
  throw new Error(`Expected at least 600 entries, got ${entries.length}`);
}

const levelCounts: Record<string, number> = {};
entries.forEach((e) => {
  levelCounts[e.level] = (levelCounts[e.level] || 0) + 1;
});
console.log('Parsed level distribution:', levelCounts);

if (!levelCounts.FATAL || levelCounts.FATAL < 1) {
  throw new Error('FATAL log entry missing from parsed sample log');
}
if (!levelCounts.ERROR || levelCounts.ERROR < 3) {
  throw new Error(`Expected >= 3 ERROR entries, got ${levelCounts.ERROR}`);
}
if (!levelCounts.WARN || levelCounts.WARN < 4) {
  throw new Error(`Expected >= 4 WARN entries, got ${levelCounts.WARN}`);
}
console.log('✓ Parser successfully parsed INFO, WARN, ERROR, and FATAL entries.');

console.log('\n--- 2. Testing escapeSql ---');
const unescaped = "O'Reilly's test 'string'";
const escaped = escapeSql(unescaped);
if (escaped !== "O''Reilly''s test ''string''") {
  throw new Error(`escapeSql failed: got ${escaped}`);
}
console.log('✓ escapeSql correctly escapes single quotes.');

console.log('\n--- 3. Testing buildLogSearchCondition ---');
// Case A: Empty keyword
const condEmpty = buildLogSearchCondition({
  keyword: '',
  isRegex: false,
  caseSensitive: false,
  searchCategory: false,
});
if (condEmpty.sqlCondition !== '1=1' || !condEmpty.isValid) {
  throw new Error(`Empty keyword test failed: ${JSON.stringify(condEmpty)}`);
}

// Case B: Simple keyword, case-insensitive
const condIlike = buildLogSearchCondition({
  keyword: 'shader error',
  isRegex: false,
  caseSensitive: false,
  searchCategory: false,
});
if (condIlike.sqlCondition !== "message ILIKE '%shader error%'" || !condIlike.isValid) {
  throw new Error(`ILIKE test failed: ${JSON.stringify(condIlike)}`);
}

// Case C: Keyword with case-sensitive and search category
const condCaseCat = buildLogSearchCondition({
  keyword: 'LogRenderer',
  isRegex: false,
  caseSensitive: true,
  searchCategory: true,
});
if (
  condCaseCat.sqlCondition !== "(message LIKE '%LogRenderer%' OR category LIKE '%LogRenderer%')" ||
  !condCaseCat.isValid
) {
  throw new Error(`Case+Category test failed: ${JSON.stringify(condCaseCat)}`);
}

// Case D: Regex search
const condRegex = buildLogSearchCondition({
  keyword: 'DXGI_ERROR_[A-Z]+',
  isRegex: true,
  caseSensitive: false,
  searchCategory: false,
});
if (
  condRegex.sqlCondition !== "regexp_matches(message, 'DXGI_ERROR_[A-Z]+', 'i')" ||
  !condRegex.isValid
) {
  throw new Error(`Regex test failed: ${JSON.stringify(condRegex)}`);
}

// Case E: Invalid Regex handling
const condInvalidRegex = buildLogSearchCondition({
  keyword: '[unclosed(bracket',
  isRegex: true,
  caseSensitive: false,
  searchCategory: false,
});
if (condInvalidRegex.isValid !== false || !condInvalidRegex.errorMessage) {
  throw new Error(`Invalid regex test failed: ${JSON.stringify(condInvalidRegex)}`);
}
console.log('✓ buildLogSearchCondition passed all unit test cases.');

console.log('\n--- 4. Testing splitTextByMatches (Highlighter) ---');
const sampleMsg = 'LogRenderer: Error: Failed to compile shader /Engine/Private/PostProcessDOF.usf';
const chunks = splitTextByMatches(sampleMsg, 'shader', false, false);
console.log('Highlight chunks for "shader":', chunks);

if (chunks.length !== 3 || chunks[1].text !== 'shader' || !chunks[1].match) {
  throw new Error(`Highlight test failed: ${JSON.stringify(chunks)}`);
}

// Case-insensitive match check
const chunksCaseInsensitive = splitTextByMatches(sampleMsg, 'ERROR', false, false);
if (chunksCaseInsensitive[1]?.text !== 'Error' || !chunksCaseInsensitive[1]?.match) {
  throw new Error(`Case-insensitive highlight failed: ${JSON.stringify(chunksCaseInsensitive)}`);
}

// Regex match check
const chunksRegex = splitTextByMatches(sampleMsg, 'Failed.*shader', true, false);
if (chunksRegex[1]?.text !== 'Failed to compile shader' || !chunksRegex[1]?.match) {
  throw new Error(`Regex highlight failed: ${JSON.stringify(chunksRegex)}`);
}
console.log('✓ splitTextByMatches correctly segments text for highlighting.');

console.log('\n========================================');
console.log('All Log Analysis unit verification tests PASSED!');
console.log('========================================\n');
