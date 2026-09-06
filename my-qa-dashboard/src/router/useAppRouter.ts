import { useCallback, useEffect, useState } from 'react';

export interface RouteState {
  name: 'search' | 'dashboard';
  runId?: string;
}

export interface QueryParams {
  t?: number;
  log?: number;
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

  const params: QueryParams = {};
  if (tParam !== null && !isNaN(Number(tParam))) {
    params.t = Number(tParam);
  }
  if (logParam !== null && !isNaN(Number(logParam))) {
    params.log = Number(logParam);
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

  const navigateToSearch = useCallback(() => {
    const targetUrl = buildUrl('/');
    window.history.pushState(null, '', targetUrl);
    setRouteInfo({ route: { name: 'search' }, params: {} });
  }, []);

  const navigateToRun = useCallback((runId: string, params?: QueryParams) => {
    const targetUrl = buildUrl(`/runs/${encodeURIComponent(runId)}`, params);
    window.history.pushState(null, '', targetUrl);
    setRouteInfo({
      route: { name: 'dashboard', runId },
      params: params || {},
    });
  }, []);

  const updateQueryParams = useCallback(
    (newParams: Partial<QueryParams>, replace = true) => {
      setRouteInfo((prev) => {
        const mergedParams: QueryParams = {
          ...prev.params,
          ...newParams,
        };

        // Remove undefined / NaN
        if (newParams.t === undefined) delete mergedParams.t;
        if (newParams.log === undefined) delete mergedParams.log;

        const currentPath =
          prev.route.name === 'dashboard' && prev.route.runId
            ? `/runs/${encodeURIComponent(prev.route.runId)}`
            : '/';

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

  const getShareableUrl = useCallback((runId: string, params?: QueryParams): string => {
    const relativeUrl = buildUrl(`/runs/${encodeURIComponent(runId)}`, params);
    return `${window.location.origin}${relativeUrl}`;
  }, []);

  return {
    route: routeInfo.route,
    queryParams: routeInfo.params,
    navigateToSearch,
    navigateToRun,
    updateQueryParams,
    getShareableUrl,
  };
}
