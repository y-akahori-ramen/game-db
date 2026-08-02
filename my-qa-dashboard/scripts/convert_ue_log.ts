#!/usr/bin/env node
/**
 * Convert an Unreal Engine log file (.log) into a Parquet file.
 *
 * Uses the same parser as the web app (../src/utils/ueLogParser.ts) so the
 * two never drift apart, and DuckDB itself (via @duckdb/node-api) to write
 * the Parquet file.
 *
 * Usage:
 *   node scripts/convert_ue_log.ts path/to/GameName.log
 *   node scripts/convert_ue_log.ts path/to/GameName.log -o output.parquet
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { parseUeLogText } from '../src/utils/ueLogParser.ts';

function parseArgs(argv: string[]): { logFile: string; output: string } {
    const args = argv.slice(2);
    const positional: string[] = [];
    let output: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-o' || arg === '--output') {
            output = args[++i];
        } else {
            positional.push(arg);
        }
    }

    const logFile = positional[0];
    if (!logFile) {
        console.error('Usage: node scripts/convert_ue_log.ts <log_file> [-o output.parquet]');
        process.exit(1);
    }

    const resolvedLog = resolve(logFile);
    const resolvedOutput = resolve(
        output ?? resolvedLog.slice(0, -extname(resolvedLog).length) + '.parquet',
    );
    return { logFile: resolvedLog, output: resolvedOutput };
}

async function main() {
    const { logFile, output } = parseArgs(process.argv);
    const text = readFileSync(logFile, 'utf-8');
    const entries = parseUeLogText(text);

    // DuckDB reads JSON from a real file, so stage the parsed entries as JSON Lines.
    const stagingDir = mkdtempSync(join(tmpdir(), 'ue-log-'));
    const stagingFile = join(stagingDir, 'entries.jsonl');
    writeFileSync(stagingFile, entries.map((e) => JSON.stringify(e)).join('\n'));

    try {
        const instance = await DuckDBInstance.create(':memory:');
        const connection = await instance.connect();
        try {
            await connection.run('CREATE TABLE ue_logs AS SELECT * FROM read_json_auto($path)', {
                path: stagingFile,
            });
            await connection.run(`COPY ue_logs TO '${output.replace(/'/g, "''")}' (FORMAT PARQUET)`);
        } finally {
            connection.closeSync();
        }
    } finally {
        rmSync(stagingDir, { recursive: true, force: true });
    }

    console.log(`wrote ${output} (${entries.length} rows)`);
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
