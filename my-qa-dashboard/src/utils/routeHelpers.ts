export interface QueryParams {
  t?: number;
  log?: number;
  testName?: string;
  gameVersion?: string;
  platform?: string;
  status?: string;
  media?: string;
}

/**
 * Safely merge new query parameters into previous query parameters.
 * Only keys explicitly specified in `newParams` are updated or deleted.
 * Keys not mentioned in `newParams` are preserved as-is.
 */
export function mergeQueryParams(
  prevParams: QueryParams,
  newParams: Partial<QueryParams>,
): QueryParams {
  const merged: QueryParams = { ...prevParams };

  for (const [key, val] of Object.entries(newParams) as [keyof QueryParams, unknown][]) {
    if (val === undefined || val === null || val === '') {
      delete merged[key];
    } else if (typeof val === 'number' && isNaN(val)) {
      delete merged[key];
    } else {
      (merged as Record<string, unknown>)[key] = val;
    }
  }

  return merged;
}
