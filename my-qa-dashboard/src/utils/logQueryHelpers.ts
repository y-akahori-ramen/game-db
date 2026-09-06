/**
 * Utility functions for building SQL search conditions for DuckDB-WASM UE log analysis,
 * and text highlighting helpers for matched keywords/regex patterns.
 */

export interface SearchFilterConfig {
  keyword: string;
  isRegex: boolean;
  caseSensitive: boolean;
  searchCategory: boolean;
}

/**
 * Escapes single quotes in user input for safe SQL interpolation in DuckDB.
 */
export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export interface SearchQueryConditionResult {
  sqlCondition: string;
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Builds a SQL WHERE condition for DuckDB based on user search configurations.
 */
export function buildLogSearchCondition(
  config: SearchFilterConfig,
  messageColumn = 'message',
  categoryColumn = 'category',
): SearchQueryConditionResult {
  const kw = config.keyword.trim();
  if (!kw) {
    return { sqlCondition: '1=1', isValid: true };
  }

  if (config.isRegex) {
    // Validate regex in JS to prevent DuckDB SQL syntax/runtime errors
    try {
      new RegExp(kw, config.caseSensitive ? undefined : 'i');
    } catch (err) {
      return {
        sqlCondition: '1=1',
        isValid: false,
        errorMessage: err instanceof Error ? err.message : 'Invalid Regular Expression',
      };
    }

    const escapedPattern = escapeSql(kw);
    const flags = config.caseSensitive ? 'c' : 'i';
    if (config.searchCategory) {
      return {
        sqlCondition: `(regexp_matches(${messageColumn}, '${escapedPattern}', '${flags}') OR regexp_matches(${categoryColumn}, '${escapedPattern}', '${flags}'))`,
        isValid: true,
      };
    }

    return {
      sqlCondition: `regexp_matches(${messageColumn}, '${escapedPattern}', '${flags}')`,
      isValid: true,
    };
  }

  // Standard substring match (ILIKE for case-insensitive, LIKE for case-sensitive)
  const escapedKw = escapeSql(kw);
  const op = config.caseSensitive ? 'LIKE' : 'ILIKE';

  if (config.searchCategory) {
    return {
      sqlCondition: `(${messageColumn} ${op} '%${escapedKw}%' OR ${categoryColumn} ${op} '%${escapedKw}%')`,
      isValid: true,
    };
  }

  return {
    sqlCondition: `${messageColumn} ${op} '%${escapedKw}%'`,
    isValid: true,
  };
}

export interface TextHighlightChunk {
  text: string;
  match: boolean;
}

/**
 * Splits text into matched and non-matched chunks for rendering <mark> tags.
 */
export function splitTextByMatches(
  text: string,
  keyword: string,
  isRegex: boolean,
  caseSensitive: boolean,
): TextHighlightChunk[] {
  const kw = keyword.trim();
  if (!kw || !text) {
    return [{ text, match: false }];
  }

  try {
    let regex: RegExp;
    if (isRegex) {
      regex = new RegExp(kw, caseSensitive ? 'g' : 'gi');
    } else {
      // Escape regex special chars for literal search
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
    }

    const chunks: TextHighlightChunk[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Prevent infinite loop with zero-width matches
    let safetyCounter = 0;
    while ((match = regex.exec(text)) !== null && safetyCounter++ < 500) {
      if (match.index > lastIndex) {
        chunks.push({
          text: text.slice(lastIndex, match.index),
          match: false,
        });
      }
      if (match[0].length > 0) {
        chunks.push({
          text: match[0],
          match: true,
        });
        lastIndex = match.index + match[0].length;
      } else {
        // Zero-length match: advance manually
        regex.lastIndex++;
      }
    }

    if (lastIndex < text.length) {
      chunks.push({
        text: text.slice(lastIndex),
        match: false,
      });
    }

    return chunks.length > 0 ? chunks : [{ text, match: false }];
  } catch {
    // If regex parsing fails, return text as-is
    return [{ text, match: false }];
  }
}
