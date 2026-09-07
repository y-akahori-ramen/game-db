import { useCallback, useEffect, useRef } from 'react';

/**
 * Hook to automatically resize an ECharts instance whenever its container element changes dimensions.
 * Handles window resize, CSS layout reflows, sidebar toggles, and fullscreen transitions.
 */
export function useChartResize<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T>(null);
  const chartInstanceRef = useRef<any>(null);
  const chartInstancesRef = useRef<Set<any>>(new Set());

  const onChartReady = useCallback((instance: any) => {
    chartInstanceRef.current = instance;
    chartInstancesRef.current.add(instance);
  }, []);

  const registerChart = useCallback((instance: any) => {
    chartInstancesRef.current.add(instance);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (chartInstanceRef.current && !chartInstanceRef.current.isDisposed()) {
          chartInstanceRef.current.resize();
        }
        for (const inst of chartInstancesRef.current) {
          if (inst && !inst.isDisposed() && inst !== chartInstanceRef.current) {
            inst.resize();
          }
        }
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return { containerRef, chartInstanceRef, onChartReady, registerChart };
}
