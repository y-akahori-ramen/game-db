import type { LogLevel, UeLogEntry } from '../types/index.ts';

const LOG_LINE_REGEX =
    /^(?:\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\])?(?:\[\s*(\d+)\])?(?:([A-Za-z0-9_]+):\s*)?(?:(Fatal|Error|Warning|Display|Log|Verbose|VeryVerbose):\s*)?(.*)$/;

const TIMESTAMP_REGEX =
    /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})$/;

const VERBOSITY_TO_LEVEL: Record<string, LogLevel> = {
    Fatal: 'FATAL',
    Error: 'ERROR',
    Warning: 'WARN',
    Display: 'INFO',
    Log: 'INFO',
    Verbose: 'INFO',
    VeryVerbose: 'INFO',
};

/** Parse a UE timestamp like "2022.05.02-04.01.53:149" into epoch milliseconds (UTC). */
function parseUeTimestampMs(raw: string): number | null {
    const m = TIMESTAMP_REGEX.exec(raw);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, ms] = m;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms));
}

/**
 * Parse the full text of an Unreal Engine .log file into structured entries.
 * Handles header/footer meta lines, pre-timestamp init lines, indented
 * continuation lines, and the standard "[timestamp][frame]Category: Verbosity: message" lines.
 */
export function parseUeLogText(text: string): UeLogEntry[] {
    const lines = text.split(/\r\n|\r|\n/);
    const entries: UeLogEntry[] = [];
    let current: UeLogEntry | null = null;
    let baseMs: number | null = null;

    const flush = () => {
        if (current) entries.push(current);
        current = null;
    };

    lines.forEach((line, idx) => {
        const lineNumber = idx + 1;
        if (line.length === 0) return;

        if (line.startsWith('Log file open,') || line.startsWith('Log file closed,')) {
            flush();
            entries.push({
                line_number: lineNumber,
                type: 'meta',
                phase: null,
                timestamp_raw: null,
                timestamp: null,
                frame: null,
                category: 'System',
                verbosity: 'Log',
                level: 'INFO',
                message: line,
            });
            return;
        }

        // Indented lines are a continuation of the previous entry's message.
        if (line.startsWith(' ') || line.startsWith('\t')) {
            if (current) current.message += `\n${line}`;
            return;
        }

        const [, timestampRaw, frameStr, category, verbosity, message] =
            LOG_LINE_REGEX.exec(line) ?? [];

        // No category/timestamp matched at all: treat as a continuation too.
        if (!category && !timestampRaw && current) {
            current.message += `\n${line}`;
            return;
        }

        flush();

        let timestamp: number | null = null;
        if (timestampRaw) {
            const ms = parseUeTimestampMs(timestampRaw);
            if (ms !== null) {
                if (baseMs === null) baseMs = ms;
                timestamp = (ms - baseMs) / 1000;
            }
        }

        const verb = verbosity || 'Log';
        current = {
            line_number: lineNumber,
            type: 'log',
            phase: timestampRaw ? 'execution' : 'init',
            timestamp_raw: timestampRaw ?? null,
            timestamp,
            frame: frameStr ? Number(frameStr) : null,
            category: category || 'System',
            verbosity: verb,
            level: VERBOSITY_TO_LEVEL[verb] ?? 'INFO',
            message: message ?? '',
        };
    });

    flush();
    return entries;
}
