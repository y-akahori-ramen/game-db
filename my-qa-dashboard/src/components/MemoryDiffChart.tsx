import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MemoryDiffItem } from '../types';
import type { MemoryTimelinePoint } from '../utils/diffQueries';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useChartResize } from '../hooks/useChartResize';

interface Props {
  timeline: MemoryTimelinePoint[];
  peakDiffs: MemoryDiffItem[];
  runAId: string;
  runBId: string;
}

export default function MemoryDiffChart({ timeline, peakDiffs, runAId, runBId }: Props) {
  const [showAll, setShowAll] = useState(false);
  const { containerRef, onChartReady } = useChartResize<HTMLDivElement>();

  const option = useMemo(() => {
    const indices = timeline.map((d) => d.index);
    const memA = timeline.map((d) => d.memA);
    const memB = timeline.map((d) => d.memB);

    return {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#475569' } },
        formatter: (params: Array<{ axisValue: string | number; seriesName: string; value: number | null }>) => {
          if (!params.length) return '';
          const idx = Number(params[0].axisValue);
          const item = timeline[idx];
          if (!item) return '';

          const sign = (item.deltaMem ?? 0) >= 0 ? '+' : '';
          const deltaColor = (item.deltaMem ?? 0) > 0 ? '#f87171' : (item.deltaMem ?? 0) < 0 ? '#4ade80' : '#94a3b8';

          return [
            `<div class="font-bold border-b border-slate-700 pb-1 mb-1 text-slate-200">Sample #${idx}</div>`,
            `<div class="flex justify-between gap-4 text-xs"><span class="text-emerald-400 font-medium">Run A (${runAId}):</span><span>${item.memA?.toFixed(2) ?? '-'} MB</span></div>`,
            `<div class="flex justify-between gap-4 text-xs"><span class="text-blue-400 font-medium">Run B (${runBId}):</span><span>${item.memB?.toFixed(2) ?? '-'} MB</span></div>`,
            `<div class="flex justify-between gap-4 text-xs border-t border-slate-700/60 pt-1 mt-1 font-semibold" style="color: ${deltaColor}"><span>Δ TrackedTotal:</span><span>${sign}${item.deltaMem?.toFixed(2) ?? '-'} MB</span></div>`,
          ].join('');
        },
      },
    legend: {
      data: [`Run A: ${runAId} (TrackedTotal)`, `Run B: ${runBId} (TrackedTotal)`],
      textStyle: { color: '#94a3b8', fontSize: 12 },
      top: 0,
    },
    grid: { left: 55, right: 25, top: 40, bottom: 45 },
    xAxis: {
      type: 'category',
      data: indices,
      name: 'Sample',
      nameLocation: 'end',
      nameTextStyle: { color: '#64748b' },
      axisLabel: { color: '#64748b' },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      name: 'MB',
      nameTextStyle: { color: '#64748b' },
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 16, bottom: 0 },
    ],
    series: [
      {
        name: `Run A: ${runAId} (TrackedTotal)`,
        type: 'line',
        data: memA,
        showSymbol: false,
        lineStyle: { width: 2, color: '#10b981' },
        itemStyle: { color: '#10b981' },
        areaStyle: { opacity: 0.08, color: '#10b981' },
      },
      {
        name: `Run B: ${runBId} (TrackedTotal)`,
        type: 'line',
        data: memB,
        showSymbol: false,
        lineStyle: { width: 2, color: '#3b82f6' },
        itemStyle: { color: '#3b82f6' },
        areaStyle: { opacity: 0.08, color: '#3b82f6' },
      },
    ],
  };
  }, [timeline, runAId, runBId]);

  const displayedPeaks = showAll ? peakDiffs : peakDiffs.slice(0, 8);

  return (
    <div ref={containerRef} className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold text-slate-400 mb-2">TrackedTotal メモリ推移オーバーレイ</h3>
        <ReactECharts option={option} style={{ height: 260 }} onChartReady={onChartReady} notMerge />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-400">カテゴリ別ピークメモリ差分 (Peak Memory Breakdown)</h3>
          {peakDiffs.length > 8 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              {showAll ? '上位8件のみ表示' : `すべて表示 (全${peakDiffs.length}件)`}
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">カテゴリ / LLM タグ</th>
                <th className="px-3 py-2 text-right font-medium">Run A ピーク</th>
                <th className="px-3 py-2 text-right font-medium">Run B ピーク</th>
                <th className="px-3 py-2 text-right font-medium">差分 (MB)</th>
                <th className="px-3 py-2 text-right font-medium">増減率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {displayedPeaks.map((item) => {
                const isPositive = item.deltaPeak > 0;
                const isZero = item.deltaPeak === 0;
                return (
                  <tr
                    key={item.category}
                    className={`hover:bg-slate-800/40 ${
                      item.category === 'TrackedTotal' ? 'bg-slate-900/60 font-semibold text-slate-100' : 'text-slate-300'
                    }`}
                  >
                    <td className="px-3 py-2 font-mono">{item.category}</td>
                    <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{item.peakA.toFixed(2)} MB</td>
                    <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{item.peakB.toFixed(2)} MB</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono ${
                          isZero
                            ? 'text-slate-400'
                            : isPositive
                              ? 'bg-red-500/15 text-red-400'
                              : 'bg-green-500/15 text-green-400'
                        }`}
                      >
                        {isZero ? (
                          <Minus size={12} />
                        ) : isPositive ? (
                          <ArrowUpRight size={12} />
                        ) : (
                          <ArrowDownRight size={12} />
                        )}
                        {isPositive ? `+${item.deltaPeak.toFixed(2)}` : item.deltaPeak.toFixed(2)} MB
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={`${
                          isZero ? 'text-slate-400' : isPositive ? 'text-red-400' : 'text-green-400'
                        }`}
                      >
                        {isPositive ? `+${item.deltaPercent.toFixed(1)}%` : `${item.deltaPercent.toFixed(1)}%`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
