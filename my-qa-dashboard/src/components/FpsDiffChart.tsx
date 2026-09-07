import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { FpsDiffMetric } from '../types';
import { useChartResize } from '../hooks/useChartResize';

interface Props {
  data: FpsDiffMetric[];
  runAId: string;
  runBId: string;
}

export default function FpsDiffChart({ data, runAId, runBId }: Props) {
  const [diffMode, setDiffMode] = useState<'fps' | 'threads'>('fps');
  const { containerRef, onChartReady } = useChartResize<HTMLDivElement>();

  const option = useMemo(() => {
    const seconds = data.map((d) => d.second);
    const fpsA = data.map((d) => d.fpsA);
    const fpsB = data.map((d) => d.fpsB);
    const deltaFps = data.map((d) => d.deltaFps);
    const deltaRt = data.map((d) => d.deltaRenderThread);
    const deltaGt = data.map((d) => d.deltaGameThread);
    const deltaGpu = data.map((d) => d.deltaGpuFrame);

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#475569' } },
        formatter: (params: Array<{ axisValue: string | number; seriesName: string; value: number | null; color: string }>) => {
          if (!params.length) return '';
          const secIndex = Number(params[0].axisValue);
          const item = data.find((d) => d.second === secIndex);
          if (!item) return '';

          const signFps = (item.deltaFps ?? 0) >= 0 ? '+' : '';
          const fpsColor = (item.deltaFps ?? 0) >= 0 ? '#4ade80' : '#f87171';

          const lines = [
            `<div class="font-bold border-b border-slate-700 pb-1 mb-1 text-slate-200">Elapsed: ${item.second}s</div>`,
            `<div class="flex justify-between gap-4 text-xs"><span class="text-cyan-400 font-medium">Run A (${runAId}):</span><span>${item.fpsA?.toFixed(1) ?? '-'} FPS (${item.frametimeA?.toFixed(1) ?? '-'}ms)</span></div>`,
            `<div class="flex justify-between gap-4 text-xs"><span class="text-amber-400 font-medium">Run B (${runBId}):</span><span>${item.fpsB?.toFixed(1) ?? '-'} FPS (${item.frametimeB?.toFixed(1) ?? '-'}ms)</span></div>`,
            `<div class="flex justify-between gap-4 text-xs border-t border-slate-700/60 pt-1 mt-1 font-semibold" style="color: ${fpsColor}"><span>Δ FPS (B - A):</span><span>${signFps}${item.deltaFps?.toFixed(1) ?? '-'} FPS</span></div>`,
          ];

          if (item.deltaRenderThread !== null || item.deltaGameThread !== null || item.deltaGpuFrame !== null) {
            lines.push(
              `<div class="border-t border-slate-700/60 pt-1 mt-1 text-[11px] text-slate-300">` +
                `<div>Δ RenderThread: <span class="${(item.deltaRenderThread ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}">${(item.deltaRenderThread ?? 0) > 0 ? '+' : ''}${item.deltaRenderThread?.toFixed(2) ?? '-'}ms</span></div>` +
                `<div>Δ GameThread: <span class="${(item.deltaGameThread ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}">${(item.deltaGameThread ?? 0) > 0 ? '+' : ''}${item.deltaGameThread?.toFixed(2) ?? '-'}ms</span></div>` +
                `<div>Δ GPUFrame: <span class="${(item.deltaGpuFrame ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}">${(item.deltaGpuFrame ?? 0) > 0 ? '+' : ''}${item.deltaGpuFrame?.toFixed(2) ?? '-'}ms</span></div>` +
                `</div>`,
            );
          }

          return lines.join('');
        },
      },
    legend: {
      data:
        diffMode === 'fps'
          ? [`Run A: ${runAId} (FPS)`, `Run B: ${runBId} (FPS)`, 'Δ FPS (B - A)']
          : [
              `Run A: ${runAId} (FPS)`,
              `Run B: ${runBId} (FPS)`,
              'Δ RenderThread (ms)',
              'Δ GameThread (ms)',
              'Δ GPUFrame (ms)',
            ],
      textStyle: { color: '#94a3b8', fontSize: 12 },
      top: 0,
    },
    grid: [
      { left: 55, right: 25, top: 40, height: '44%' },
      { left: 55, right: 25, top: '56%', height: '32%' },
    ],
    xAxis: [
      {
        gridIndex: 0,
        type: 'category',
        data: seconds,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      {
        gridIndex: 1,
        type: 'category',
        data: seconds,
        name: 'sec',
        nameLocation: 'end',
        nameTextStyle: { color: '#64748b' },
        axisLabel: { color: '#64748b' },
        axisLine: { lineStyle: { color: '#334155' } },
      },
    ],
    yAxis: [
      {
        gridIndex: 0,
        type: 'value',
        name: 'FPS',
        nameTextStyle: { color: '#64748b' },
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      {
        gridIndex: 1,
        type: 'value',
        name: diffMode === 'fps' ? 'Δ FPS' : 'Δ ms',
        nameTextStyle: { color: '#64748b' },
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1] },
      { type: 'slider', xAxisIndex: [0, 1], height: 16, bottom: 0 },
    ],
    series: [
      // Top grid: Run A and Run B FPS overlay
      {
        name: `Run A: ${runAId} (FPS)`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: fpsA,
        showSymbol: false,
        lineStyle: { width: 2, color: '#22d3ee' },
        itemStyle: { color: '#22d3ee' },
      },
      {
        name: `Run B: ${runBId} (FPS)`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: fpsB,
        showSymbol: false,
        lineStyle: { width: 2, color: '#f59e0b' },
        itemStyle: { color: '#f59e0b' },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#ef4444', type: 'dashed' },
          label: { formatter: '30fps', color: '#ef4444', position: 'insideEndTop' },
          data: [{ yAxis: 30 }],
        },
      },
      // Bottom grid: Delta series
      ...(diffMode === 'fps'
        ? [
            {
              name: 'Δ FPS (B - A)',
              type: 'bar',
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: deltaFps.map((val) => ({
                value: val,
                itemStyle: {
                  color: val !== null && val >= 0 ? '#22c55e' : '#ef4444',
                  borderRadius: val !== null && val >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2],
                },
              })),
            },
          ]
        : [
            {
              name: 'Δ RenderThread (ms)',
              type: 'line',
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: deltaRt,
              showSymbol: false,
              lineStyle: { width: 1.5, color: '#f472b6' },
              itemStyle: { color: '#f472b6' },
            },
            {
              name: 'Δ GameThread (ms)',
              type: 'line',
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: deltaGt,
              showSymbol: false,
              lineStyle: { width: 1.5, color: '#a78bfa' },
              itemStyle: { color: '#a78bfa' },
            },
            {
              name: 'Δ GPUFrame (ms)',
              type: 'line',
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: deltaGpu,
              showSymbol: false,
              lineStyle: { width: 1.5, color: '#facc15' },
              itemStyle: { color: '#facc15' },
            },
          ]),
    ],
  };
  }, [data, runAId, runBId, diffMode]);

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex justify-end gap-2 text-xs">
        <span className="text-slate-400 self-center">下段差分表示:</span>
        <button
          onClick={() => setDiffMode('fps')}
          className={`px-2.5 py-1 rounded transition-colors ${
            diffMode === 'fps'
              ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-600'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
          }`}
        >
          Δ FPS (棒グラフ)
        </button>
        <button
          onClick={() => setDiffMode('threads')}
          className={`px-2.5 py-1 rounded transition-colors ${
            diffMode === 'threads'
              ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-600'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
          }`}
        >
          Δ スレッド時間 (折れ線)
        </button>
      </div>
      <ReactECharts option={option} style={{ height: 380 }} onChartReady={onChartReady} notMerge />
    </div>
  );
}
