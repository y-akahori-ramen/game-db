import ReactECharts from 'echarts-for-react';
import type { MemoryMetric } from '../types';

interface Props {
  data: MemoryMetric[];
}

export default function MemoryChart({ data }: Props) {
  const timestamps = data.map((d) => d.timestamp);

  const series = [
    { key: 'vram_mb', name: 'VRAM (MB)', color: '#f97316' },
    { key: 'ram_mb', name: 'RAM (MB)', color: '#22c55e' },
    { key: 'heap_mb', name: 'Heap (MB)', color: '#3b82f6' },
  ].map(({ key, name, color }) => ({
    name,
    type: 'line',
    data: data.map((d) => d[key as keyof MemoryMetric]),
    showSymbol: false,
    lineStyle: { width: 1.5, color },
    itemStyle: { color },
    areaStyle: { opacity: 0.12, color },
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: {
      data: series.map((s) => s.name),
      textStyle: { color: '#94a3b8' },
    },
    grid: { left: 60, right: 30, top: 40, bottom: 60 },
    xAxis: {
      type: 'category',
      name: 'sec',
      data: timestamps,
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      name: 'MB',
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 18, bottom: 10 },
    ],
    series,
  };

  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}
