export interface RouteState {
  name: 'search' | 'dashboard' | 'compare';
  runId?: string;
  compareRunIds?: [string, string];
}

export interface QueryParams {
  t?: number;
  log?: number;
  testName?: string;
  gameVersion?: string;
  platform?: string;
  status?: string;
  media?: string;
}

export function normalizePathname(pathname: string, base: string = '/'): string {
  let path = pathname;
  if (base !== '/' && path.startsWith(base)) {
    path = path.slice(base.length);
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path;
}

export function parseRouteFromLocation(
  pathname: string,
  search: string,
  base: string = '/',
): { route: RouteState; params: QueryParams } {
  const path = normalizePathname(pathname, base);
  const searchParams = new URLSearchParams(search);

  const tParam = searchParams.get('t');
  const logParam = searchParams.get('log') || searchParams.get('line');
  const testNameParam = searchParams.get('testName') || searchParams.get('test');
  const gameVersionParam = searchParams.get('gameVersion') || searchParams.get('version');
  const platformParam = searchParams.get('platform');
  const statusParam = searchParams.get('status');
  const mediaParam = searchParams.get('media');

  const params: QueryParams = {};
  if (tParam !== null && !isNaN(Number(tParam))) {
    params.t = Number(tParam);
  }
  if (logParam !== null && !isNaN(Number(logParam))) {
    params.log = Number(logParam);
  }
  if (testNameParam) params.testName = testNameParam;
  if (gameVersionParam) params.gameVersion = gameVersionParam;
  if (platformParam) params.platform = platformParam;
  if (statusParam) params.status = statusParam;
  if (mediaParam) params.media = mediaParam;

  // Matches /compare/:runA/:runB
  const compareMatch = /^\/compare\/([^/?#]+)\/([^/?#]+)/.exec(path);
  if (compareMatch) {
    return {
      route: {
        name: 'compare',
        compareRunIds: [decodeURIComponent(compareMatch[1]), decodeURIComponent(compareMatch[2])],
      },
      params,
    };
  }

  // Matches /compare?a=run-001&b=run-002 or ?runs=run-001,run-002
  if (path === '/compare' || path.startsWith('/compare/')) {
    const aParam = searchParams.get('a');
    const bParam = searchParams.get('b');
    const runsParam = searchParams.get('runs');
    let runA = aParam;
    let runB = bParam;
    if (!runA && !runB && runsParam) {
      const parts = runsParam.split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        runA = parts[0];
        runB = parts[1];
      }
    }
    if (runA && runB) {
      return {
        route: {
          name: 'compare',
          compareRunIds: [runA, runB],
        },
        params,
      };
    }
  }

  // Matches ?compare=run-001,run-002
  const compareParam = searchParams.get('compare');
  if (compareParam) {
    const parts = compareParam.split(',').map((p) => p.trim());
    if (parts.length >= 2) {
      return {
        route: {
          name: 'compare',
          compareRunIds: [parts[0], parts[1]],
        },
        params,
      };
    }
  }

  // Matches /runs/:runId
  const match = /^\/runs\/([^/?#]+)/.exec(path);
  if (match) {
    return {
      route: { name: 'dashboard', runId: decodeURIComponent(match[1]) },
      params,
    };
  }

  // Matches ?run=:runId or ?runId=:runId
  const runParam = searchParams.get('run') || searchParams.get('runId');
  if (runParam) {
    return {
      route: { name: 'dashboard', runId: decodeURIComponent(runParam) },
      params,
    };
  }

  return {
    route: { name: 'search' },
    params,
  };
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
