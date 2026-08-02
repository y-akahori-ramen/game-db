import ReactECharts from 'echarts-for-react';
import type { FpsMetric } from '../types';

interface Props {
  data: FpsMetric[];
}

export default function FpsChart({ data }: Props) {
  const fps = data.map((d) => [d.timestamp, d.fps]);
  const frameTimes = data.map((d) => [d.timestamp, d.frame_time_ms]);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      data: ['FPS', 'Frame Time (ms)'],
      textStyle: { color: '#94a3b8' },
    },
    grid: { left: 50, right: 60, top: 40, bottom: 60 },
    xAxis: {
      type: 'value',
      name: 'sec',
      max: 'dataMax',
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: [
      {
        type: 'value',
        name: 'FPS',
        min: 0,
        max: 70,
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      {
        type: 'value',
        name: 'ms',
        min: 0,
        axisLabel: { color: '#64748b' },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 18, bottom: 10 },
    ],
    visualMap: {
      show: false,
      type: 'piecewise',
      seriesIndex: 0,
      dimension: 1,
      pieces: [
        { gt: 0, lte: 30, color: '#ef4444' },
        { gt: 30, lte: 70, color: '#22d3ee' },
      ],
    },
    series: [
      {
        name: 'FPS',
        type: 'line',
        yAxisIndex: 0,
        data: fps,
        showSymbol: false,
        lineStyle: { width: 1.5 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#ef4444', type: 'dashed' },
          label: { formatter: '30fps', color: '#ef4444' },
          data: [{ yAxis: 30 }],
        },
      },
      {
        name: 'Frame Time (ms)',
        type: 'line',
        yAxisIndex: 1,
        data: frameTimes,
        showSymbol: false,
        lineStyle: { width: 1, color: '#a78bfa', opacity: 0.6 },
        itemStyle: { color: '#a78bfa' },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}
