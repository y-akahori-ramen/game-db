export interface RouteState {
  name: 'search' | 'dashboard' | 'compare' | 'trends';
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
  range?: string;
  view?: string;
}

export function buildUrl(path: string, params?: QueryParams, base: string = '/'): string {
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const [rawPathname, rawSearch] = path.split('?');
  const cleanPath = rawPathname.startsWith('/') ? rawPathname : `/${rawPathname}`;
  const fullPath = `${cleanBase}${cleanPath}`;

  const searchParams = new URLSearchParams(rawSearch || '');
  if (params?.t !== undefined && !isNaN(params.t)) {
    searchParams.set('t', params.t.toFixed(params.t % 1 === 0 ? 0 : 2));
  }
  if (params?.log !== undefined && !isNaN(params.log)) {
    searchParams.set('log', String(Math.round(params.log)));
  }
  if (params?.testName) searchParams.set('testName', params.testName);
  if (params?.gameVersion) searchParams.set('gameVersion', params.gameVersion);
  if (params?.platform) searchParams.set('platform', params.platform);
  if (params?.status) searchParams.set('status', params.status);
  if (params?.media) searchParams.set('media', params.media);
  if (params?.range) searchParams.set('range', params.range);
  if (params?.view) searchParams.set('view', params.view);

  const query = searchParams.toString();
  return query ? `${fullPath}?${query}` : fullPath;
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
  const rangeParam = searchParams.get('range');
  const viewParam = searchParams.get('view');

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
  if (rangeParam) params.range = rangeParam;
  if (viewParam) params.view = viewParam;

  // Matches /trends
  if (path === '/trends' || path.startsWith('/trends/')) {
    return {
      route: { name: 'trends' },
      params,
    };
  }

  // Matches ?view=trends
  if (viewParam === 'trends') {
    return {
      route: { name: 'trends' },
      params,
    };
  }

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
