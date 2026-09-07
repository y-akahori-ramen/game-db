import { memo, useCallback, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { FpsMetric } from '../types';
import { useChartResize } from '../hooks/useChartResize';

interface Props {

  data: FpsMetric[];
  isFullscreen?: boolean;
  currentTime?: number;
  onSeek?: (time: number) => void;
}

const SERIES: { key: keyof FpsMetric; name: string; color: string }[] = [
  { key: 'FPSMs', name: 'FPSMs', color: '#22d3ee' },
  { key: 'GameThread', name: 'GameThread', color: '#a78bfa' },
  { key: 'RenderThread', name: 'RenderThread', color: '#f472b6' },
  { key: 'GPUFrame', name: 'GPUFrame', color: '#facc15' },
  { key: 'RHIThreadTime', name: 'RHIThreadTime', color: '#34d399' },
];

function FpsChart({ data, isFullscreen = false, currentTime, onSeek }: Props) {
  const { containerRef, onChartReady: onResizeChartReady } = useChartResize<HTMLDivElement>();

  // ElapsedTime is the shared x-axis; PersistentLevel is looked up per-point
  // for the tooltip rather than plotted as its own series.
  const option = useMemo(() => {
    const levelByElapsed = new Map(data.map((d) => [d.ElapsedTime, d.PersistentLevel]));
    const seriesData = SERIES.map(({ key }) => data.map((d) => [d.ElapsedTime, d[key] as number]));

    const markLineData: {
      yAxis?: number;
      xAxis?: number;
      lineStyle?: { color: string; width?: number; type?: 'dashed' | 'solid' };
      label?: { formatter: string; color: string; position?: 'insideEndTop' | 'end' };
    }[] = [
      {
        yAxis: 1000 / 30,
        lineStyle: { color: '#ef4444', type: 'dashed' },
        label: { formatter: '30fps (33.3ms)', color: '#ef4444' },
      },
    ];

    if (currentTime !== undefined && currentTime !== null && !isNaN(currentTime)) {
      markLineData.push({
        xAxis: currentTime,
        lineStyle: { color: '#22d3ee', width: 2, type: 'solid' },
        label: {
          formatter: `再生位置: ${currentTime.toFixed(1)}s`,
          color: '#22d3ee',
          position: 'insideEndTop',
        },
      });
    }

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: { axisValue: number; marker: string; seriesName: string; value: [number, number] }[]) => {
          if (!params.length) return '';
          const elapsed = params[0].value[0];
          const level = levelByElapsed.get(elapsed);
          const lines = params.map(
            (p) => `${p.marker}${p.seriesName}: ${p.value[1].toFixed(2)} ms`,
          );
          return [`ElapsedTime: ${elapsed.toFixed(3)}s`, `Level: ${level ?? '-'}`, ...lines].join(
            '<br/>',
          );
        },
      },
      legend: {
        data: SERIES.map((s) => s.name),
        textStyle: { color: '#94a3b8' },
      },
      grid: { left: 50, right: 20, top: 40, bottom: 60 },
      xAxis: {
        type: 'value',
        name: 'sec',
        max: 'dataMax',
        axisLabel: { color: '#64748b' },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      yAxis: {
        type: 'value',
        name: 'ms',
        min: 0,
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0 },
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 10 },
      ],
      series: SERIES.map(({ name, color }, i) => ({
        name,
        type: 'line',
        data: seriesData[i],
        showSymbol: false,
        lineStyle: { width: name === 'FPSMs' ? 1.5 : 1, color, opacity: name === 'FPSMs' ? 1 : 0.7 },
        itemStyle: { color },
        ...(name === 'FPSMs'
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                data: markLineData,
              },
            }
          : {}),
      })),
    };
  }, [data, currentTime]);

  const handleChartReady = useCallback(
    (instance: any) => {
      onResizeChartReady(instance);
      const zr = instance.getZr();
      zr.off('click');
      zr.on('click', (params: any) => {
        if (!onSeek) return;
        const pointInPixel = [params.offsetX, params.offsetY];
        if (instance.containPixel({ gridIndex: 0 }, pointInPixel)) {
          const pointInGrid = instance.convertFromPixel({ gridIndex: 0 }, pointInPixel);
          if (pointInGrid && typeof pointInGrid[0] === 'number') {
            const seekTime = Math.max(0, Number(pointInGrid[0].toFixed(2)));
            onSeek(seekTime);
          }
        }
      });
    },
    [onSeek, onResizeChartReady],
  );

  const onEvents = useMemo(
    () => ({
      click: (params: any) => {
        if (!onSeek) return;
        if (Array.isArray(params.value) && typeof params.value[0] === 'number') {
          onSeek(Math.max(0, Number(params.value[0].toFixed(2))));
        }
      },
    }),
    [onSeek],
  );

  return (
    <div ref={containerRef} className={isFullscreen ? 'flex-1 min-h-0 w-full' : 'w-full'}>
      <ReactECharts
        option={option}
        style={{ height: isFullscreen ? 'calc(100vh - 100px)' : 320, width: '100%' }}
        onChartReady={handleChartReady}
        onEvents={onEvents}
        notMerge
      />
    </div>
  );
}

export default memo(FpsChart);
