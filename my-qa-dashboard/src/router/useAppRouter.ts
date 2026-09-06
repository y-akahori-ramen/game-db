import { useCallback, useEffect, useState } from 'react';

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
}

function getNormalizedPathname(): string {
  const base = import.meta.env.BASE_URL || '/';
  let path = window.location.pathname;
  if (base !== '/' && path.startsWith(base)) {
    path = path.slice(base.length);
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path;
}

function parseRoute(): { route: RouteState; params: QueryParams } {
  const path = getNormalizedPathname();
  const searchParams = new URLSearchParams(window.location.search);

  const tParam = searchParams.get('t');
  const logParam = searchParams.get('log') || searchParams.get('line');
  const testNameParam = searchParams.get('testName') || searchParams.get('test');
  const gameVersionParam = searchParams.get('gameVersion') || searchParams.get('version');
  const platformParam = searchParams.get('platform');
  const statusParam = searchParams.get('status');

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

  // Matches /runs/:runId
  const match = /^\/runs\/([^/?#]+)/.exec(path);
  if (match) {
    return {
      route: { name: 'dashboard', runId: decodeURIComponent(match[1]) },
      params,
    };
  }

  return {
    route: { name: 'search' },
    params,
  };
}

function buildUrl(path: string, params?: QueryParams): string {
  const base = import.meta.env.BASE_URL || '/';
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullPath = `${cleanBase}${cleanPath}`;

  const searchParams = new URLSearchParams();
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

  const query = searchParams.toString();
  return query ? `${fullPath}?${query}` : fullPath;
}

export function useAppRouter() {
  const [routeInfo, setRouteInfo] = useState(parseRoute);

  useEffect(() => {
    const handlePopState = () => {
      setRouteInfo(parseRoute());
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const navigateToSearch = useCallback((params?: QueryParams) => {
    const targetUrl = buildUrl('/', params);
    window.history.pushState(null, '', targetUrl);
    setRouteInfo({ route: { name: 'search' }, params: params || {} });
  }, []);

  const navigateToRun = useCallback((runId: string, params?: QueryParams) => {
    const targetUrl = buildUrl(`/runs/${encodeURIComponent(runId)}`, params);
    window.history.pushState(null, '', targetUrl);
    setRouteInfo({
      route: { name: 'dashboard', runId },
      params: params || {},
    });
  }, []);

  const navigateToCompare = useCallback((runA: string, runB: string) => {
    const base = import.meta.env.BASE_URL || '/';
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const targetUrl = `${cleanBase}/compare?a=${encodeURIComponent(runA)}&b=${encodeURIComponent(runB)}`;
    window.history.pushState(null, '', targetUrl);
    setRouteInfo({
      route: { name: 'compare', compareRunIds: [runA, runB] },
      params: {},
    });
  }, []);

  const updateQueryParams = useCallback(
    (newParams: Partial<QueryParams>, replace = true) => {
      setRouteInfo((prev) => {
        const mergedParams: QueryParams = {
          ...prev.params,
          ...newParams,
        };

        // Remove undefined / NaN / empty strings
        if (newParams.t === undefined) delete mergedParams.t;
        if (newParams.log === undefined) delete mergedParams.log;
        if (!mergedParams.testName) delete mergedParams.testName;
        if (!mergedParams.gameVersion) delete mergedParams.gameVersion;
        if (!mergedParams.platform) delete mergedParams.platform;
        if (!mergedParams.status) delete mergedParams.status;

        let currentPath = '/';
        if (prev.route.name === 'dashboard' && prev.route.runId) {
          currentPath = `/runs/${encodeURIComponent(prev.route.runId)}`;
        } else if (prev.route.name === 'compare' && prev.route.compareRunIds) {
          currentPath = `/compare?a=${encodeURIComponent(prev.route.compareRunIds[0])}&b=${encodeURIComponent(prev.route.compareRunIds[1])}`;
        }

        const targetUrl = buildUrl(currentPath, mergedParams);
        if (replace) {
          window.history.replaceState(null, '', targetUrl);
        } else {
          window.history.pushState(null, '', targetUrl);
        }

        return {
          route: prev.route,
          params: mergedParams,
        };
      });
    },
    [],
  );


  const getShareableUrl = useCallback(
    (runIdOrRunIds: string | [string, string], params?: QueryParams): string => {
      if (Array.isArray(runIdOrRunIds)) {
        const base = import.meta.env.BASE_URL || '/';
        const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
        const relativeUrl = `${cleanBase}/compare?a=${encodeURIComponent(runIdOrRunIds[0])}&b=${encodeURIComponent(runIdOrRunIds[1])}`;
        return `${window.location.origin}${relativeUrl}`;
      }
      const relativeUrl = buildUrl(`/runs/${encodeURIComponent(runIdOrRunIds)}`, params);
      return `${window.location.origin}${relativeUrl}`;
    },
    [],
  );

  return {
    route: routeInfo.route,
    queryParams: routeInfo.params,
    navigateToSearch,
    navigateToRun,
    navigateToCompare,
    updateQueryParams,
    getShareableUrl,
  };
}
