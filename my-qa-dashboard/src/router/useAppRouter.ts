import { useCallback, useEffect, useState } from 'react';

import {
  mergeQueryParams,
  normalizePathname,
  parseRouteFromLocation,
  type QueryParams,
  type RouteState,
} from '../utils/routeHelpers';
export type { QueryParams, RouteState };
export { mergeQueryParams, normalizePathname, parseRouteFromLocation };

function parseRoute(): { route: RouteState; params: QueryParams } {
  const base = import.meta.env.BASE_URL || '/';
  return parseRouteFromLocation(window.location.pathname, window.location.search, base);
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
  if (params?.media) searchParams.set('media', params.media);
  if (params?.range) searchParams.set('range', params.range);
  if (params?.view) searchParams.set('view', params.view);

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

  const navigateToTrends = useCallback((params?: QueryParams) => {
    const targetUrl = buildUrl('/trends', params);
    window.history.pushState(null, '', targetUrl);
    setRouteInfo({ route: { name: 'trends' }, params: params || {} });
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
        const mergedParams = mergeQueryParams(prev.params, newParams);

        // Avoid re-render and redundant history navigation if params did not change
        const prevKeys = Object.keys(prev.params) as (keyof QueryParams)[];
        const nextKeys = Object.keys(mergedParams) as (keyof QueryParams)[];
        if (
          prevKeys.length === nextKeys.length &&
          prevKeys.every((k) => prev.params[k] === mergedParams[k])
        ) {
          return prev;
        }

        let currentPath = '/';
        if (prev.route.name === 'trends') {
          currentPath = '/trends';
        } else if (prev.route.name === 'dashboard' && prev.route.runId) {
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
    navigateToTrends,
    navigateToRun,
    navigateToCompare,
    updateQueryParams,
    getShareableUrl,
  };
}
