import { memo, useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MemoryMetric } from '../types';

interface Props {
  data: MemoryMetric[];
}

const TRACKED_TOTAL_KEY = 'TrackedTotal';
const TRACKED_TOTAL_COLOR = '#22c55e';

// Palette cycled through for user-selected columns (TrackedTotal keeps its own fixed color).
const PALETTE = [
  '#f97316',
  '#3b82f6',
  '#f472b6',
  '#facc15',
  '#a78bfa',
  '#34d399',
  '#22d3ee',
  '#ef4444',
  '#eab308',
  '#14b8a6',
];

function MemoryChart({ data }: Props) {
  // Columns are not known ahead of time: they vary by platform, so they are
  // derived from whatever keys are present on the first row of the loaded data.
  const columns = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0]).filter((key) => key !== TRACKED_TOTAL_KEY);
  }, [data]);

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  // Reset the user's selection whenever a new dataset is loaded (new run / new file).
  useEffect(() => {
    setSelectedColumns([]);
  }, [data]);

  // Peak (max) value per item, independent of which columns are plotted on the chart.
  const peaks = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0])
      .map((key) => ({
        key,
        max: data.reduce((acc, row) => Math.max(acc, row[key]), -Infinity),
      }))
      .sort((a, b) => b.max - a.max);
  }, [data]);

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const option = useMemo(() => {
    const sampleIndices = data.map((_, i) => i);

    const series = [
      { key: TRACKED_TOTAL_KEY, name: TRACKED_TOTAL_KEY, color: TRACKED_TOTAL_COLOR },
      ...selectedColumns.map((key, i) => ({
        key,
        name: key,
        color: PALETTE[i % PALETTE.length],
      })),
    ].map(({ key, name, color }) => ({
      name,
      type: 'line',
      data: data.map((d) => d[key]),
      showSymbol: false,
      lineStyle: { width: 1.5, color },
      itemStyle: { color },
      areaStyle: { opacity: 0.12, color },
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: {
        data: series.map((s) => s.name),
        textStyle: { color: '#94a3b8' },
      },
      grid: { left: 60, right: 30, top: 40, bottom: 60 },
      xAxis: {
        type: 'category',
        name: 'sample',
        data: sampleIndices,
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
  }, [data, selectedColumns]);

  return (
    <div>
      {columns.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1.5 rounded-md border border-slate-800 bg-slate-950/40 p-2">
          <span className="text-xs text-slate-500">項目を追加:</span>
          {columns.map((col) => (
            <label
              key={col}
              className="flex cursor-pointer items-center gap-1 text-xs text-slate-300"
            >
              <input
                type="checkbox"
                checked={selectedColumns.includes(col)}
                onChange={() => toggleColumn(col)}
                className="h-3 w-3 accent-cyan-500"
              />
              {col}
            </label>
          ))}
        </div>
      )}
      <ReactECharts option={option} style={{ height: 320 }} notMerge />
      {peaks.length > 0 && (
        <div className="mt-2 rounded-md border border-slate-800 bg-slate-950/40 p-2">
          <span className="mb-1.5 block text-xs text-slate-500">ピーク値 (MB):</span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {peaks.map(({ key, max }) => (
              <div key={key} className="flex items-baseline justify-between gap-2 text-xs">
                <span
                  className="truncate text-slate-300"
                  style={{ color: key === TRACKED_TOTAL_KEY ? TRACKED_TOTAL_COLOR : undefined }}
                  title={key}
                >
                  {key}
                </span>
                <span className="shrink-0 font-mono text-slate-200">{max.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(MemoryChart);
