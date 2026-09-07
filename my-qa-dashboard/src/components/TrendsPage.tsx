import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Filter,
  Gauge,
  Layers,
  Loader2,
  MemoryStick,
  Minus,
  RefreshCw,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { searchService } from '../services';
import type { TestRunSummary } from '../services';
import type { TrendTimeRange } from '../types';
import {
  calculateTrendSummary,
  filterTrendRuns,
  formatTrendDate,
  groupPassFailByDate,
  toTrendDataPoints,
} from '../utils/trendHelpers';

interface Props {
  onOpenRun: (runId: string) => void;
  onCompareRuns: (runAId: string, runBId: string) => void;
  initialFilters?: {
    testName?: string;
    platform?: string;
    gameVersion?: string;
    range?: string;
  };
  onFilterChange?: (filters: {
    testName?: string;
    platform?: string;
    gameVersion?: string;
    range?: string;
  }) => void;
}

export default function TrendsPage({
  onOpenRun,
  onCompareRuns,
  initialFilters,
  onFilterChange,
}: Props) {
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [testName, setTestName] = useState(initialFilters?.testName || 'ALL');
  const [platform, setPlatform] = useState(initialFilters?.platform || 'ALL');
  const [gameVersion, setGameVersion] = useState(initialFilters?.gameVersion || 'ALL');
  const [timeRange, setTimeRange] = useState<TrendTimeRange>(
    (initialFilters?.range as TrendTimeRange) || 'all',
  );

  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

  // Fetch all runs
  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await searchService.searchRuns({});
      setRuns(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  // Extract unique options for filters
  const testNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) if (r.testName) set.add(r.testName);
    return Array.from(set).sort();
  }, [runs]);

  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) if (r.platform) set.add(r.platform);
    return Array.from(set).sort();
  }, [runs]);

  const gameVersions = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) if (r.gameVersion) set.add(r.gameVersion);
    return Array.from(set).sort();
  }, [runs]);

  // Filter runs
  const filteredRuns = useMemo(() => {
    return filterTrendRuns(runs, {
      testName: testName === 'ALL' ? undefined : testName,
      platform: platform === 'ALL' ? undefined : platform,
      gameVersion: gameVersion === 'ALL' ? undefined : gameVersion,
      range: timeRange,
    });
  }, [runs, testName, platform, gameVersion, timeRange]);

  // Trend data points & stats
  const trendPoints = useMemo(() => toTrendDataPoints(filteredRuns), [filteredRuns]);
  const stats = useMemo(() => calculateTrendSummary(filteredRuns), [filteredRuns]);
  const dailyStats = useMemo(() => groupPassFailByDate(filteredRuns), [filteredRuns]);

  // Update query params when filter changes
  useEffect(() => {
    onFilterChange?.({
      testName: testName !== 'ALL' ? testName : undefined,
      platform: platform !== 'ALL' ? platform : undefined,
      gameVersion: gameVersion !== 'ALL' ? gameVersion : undefined,
      range: timeRange !== 'all' ? timeRange : undefined,
    });
  }, [testName, platform, gameVersion, timeRange, onFilterChange]);

  // Handle comparison selection
  const handleToggleCompare = (runId: string) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(runId)) {
        return prev.filter((id) => id !== runId);
      }
      if (prev.length >= 2) {
        return [prev[1], runId];
      }
      return [...prev, runId];
    });
  };

  const handleStartCompare = () => {
    if (selectedForCompare.length === 2) {
      onCompareRuns(selectedForCompare[0], selectedForCompare[1]);
    }
  };

  // ECharts Option: FPS & Frame Stability
  const fpsChartOption = useMemo(() => {
    const xLabels = trendPoints.map((p) => `${p.runId}\n(${p.gameVersion})`);
    const avgFpsData = trendPoints.map((p) => p.avgFps);
    const minFpsData = trendPoints.map((p) => p.minFps);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: Array<{ dataIndex: number; seriesName: string; value: number }>) => {
          if (!params.length) return '';
          const idx = params[0].dataIndex;
          const p = trendPoints[idx];
          if (!p) return '';
          const statusBadge =
            p.status === 'PASSED'
              ? '<span style="color:#4ade80;font-weight:bold;">● PASSED</span>'
              : '<span style="color:#f87171;font-weight:bold;">● FAILED</span>';

          return [
            `<strong>${p.runId}</strong> - ${statusBadge}`,
            `日時: ${p.formattedDate}`,
            `バージョン: ${p.gameVersion} | プラットフォーム: ${p.platform}`,
            `テスト名: ${p.testName}`,
            `<hr style="border:0;border-top:1px solid #334155;margin:6px 0;"/>`,
            p.avgFps !== null
              ? `<span style="color:#22d3ee;">平均 FPS: ${p.avgFps.toFixed(1)} fps</span>`
              : '平均 FPS: N/A',
            p.minFps !== null
              ? `<span style="color:#f59e0b;">最低 FPS: ${p.minFps.toFixed(1)} fps</span>`
              : '最低 FPS: N/A',
            `<span style="color:#94a3b8;font-size:11px;">※クリックでこのRunの詳細を開く</span>`,
          ].join('<br/>');
        },
      },
      legend: {
        data: ['平均 FPS', '最低 FPS'],
        textStyle: { color: '#94a3b8' },
        top: 0,
      },
      grid: { left: 45, right: 30, top: 40, bottom: 65 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          interval: 0,
          rotate: trendPoints.length > 8 ? 30 : 0,
        },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      yAxis: {
        type: 'value',
        name: 'fps',
        min: 0,
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          name: '平均 FPS',
          type: 'line',
          data: avgFpsData,
          smooth: true,
          itemStyle: { color: '#22d3ee' },
          lineStyle: { width: 3 },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              {
                yAxis: 60,
                lineStyle: { color: '#22c55e', type: 'dashed' },
                label: { formatter: '60 FPS Target', position: 'end', color: '#4ade80' },
              },
              {
                yAxis: 30,
                lineStyle: { color: '#ef4444', type: 'dashed' },
                label: { formatter: '30 FPS Min', position: 'end', color: '#f87171' },
              },
            ],
          },
        },
        {
          name: '最低 FPS',
          type: 'line',
          data: minFpsData,
          smooth: true,
          itemStyle: { color: '#f59e0b' },
          lineStyle: { width: 2, type: 'dashed' },
        },
      ],
    };
  }, [trendPoints]);

  // ECharts Option: Peak Memory Trend
  const memoryChartOption = useMemo(() => {
    const xLabels = trendPoints.map((p) => `${p.runId}\n(${p.gameVersion})`);
    const memData = trendPoints.map((p) => p.peakMemoryMb);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: Array<{ dataIndex: number; value: number }>) => {
          if (!params.length) return '';
          const idx = params[0].dataIndex;
          const p = trendPoints[idx];
          if (!p) return '';
          return [
            `<strong>${p.runId}</strong> (${p.gameVersion})`,
            `日時: ${p.formattedDate}`,
            p.peakMemoryMb !== null
              ? `<span style="color:#10b981;">ピークメモリ: ${p.peakMemoryMb.toFixed(1)} MB</span>`
              : 'ピークメモリ: N/A',
            `<span style="color:#94a3b8;font-size:11px;">※クリックでこのRunの詳細を開く</span>`,
          ].join('<br/>');
        },
      },
      grid: { left: 55, right: 30, top: 30, bottom: 65 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          interval: 0,
          rotate: trendPoints.length > 8 ? 30 : 0,
        },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      yAxis: {
        type: 'value',
        name: 'MB',
        min: 0,
        axisLabel: { color: '#64748b' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          name: 'ピークメモリ',
          type: 'line',
          data: memData,
          smooth: true,
          itemStyle: { color: '#10b981' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(16, 185, 129, 0.4)' },
                { offset: 1, color: 'rgba(16, 185, 129, 0.02)' },
              ],
            },
          },
          lineStyle: { width: 2.5 },
        },
      ],
    };
  }, [trendPoints]);

  // ECharts Option: Pass/Fail Daily Distribution
  const passFailChartOption = useMemo(() => {
    const dates = dailyStats.map((d) => d.date);
    const passedCounts = dailyStats.map((d) => d.passed);
    const failedCounts = dailyStats.map((d) => d.failed);
    const passRates = dailyStats.map((d) => d.passRate);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      legend: {
        data: ['PASSED', 'FAILED', '合格率 (%)'],
        textStyle: { color: '#94a3b8' },
        top: 0,
      },
      grid: { left: 45, right: 45, top: 40, bottom: 50 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      yAxis: [
        {
          type: 'value',
          name: '実行数',
          minInterval: 1,
          axisLabel: { color: '#64748b' },
          splitLine: { lineStyle: { color: '#1e293b' } },
        },
        {
          type: 'value',
          name: '合格率 (%)',
          min: 0,
          max: 100,
          axisLabel: { color: '#64748b' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'PASSED',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: '#22c55e' },
          data: passedCounts,
        },
        {
          name: 'FAILED',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: '#ef4444' },
          data: failedCounts,
        },
        {
          name: '合格率 (%)',
          type: 'line',
          yAxisIndex: 1,
          itemStyle: { color: '#38bdf8' },
          lineStyle: { width: 2.5 },
          data: passRates,
        },
      ],
    };
  }, [dailyStats]);

  // Click on chart point opens run
  const onChartClick = useCallback(
    (params: { dataIndex: number }) => {
      const point = trendPoints[params.dataIndex];
      if (point) {
        onOpenRun(point.runId);
      }
    },
    [trendPoints, onOpenRun],
  );

  const chartEvents = useMemo(() => ({ click: onChartClick }), [onChartClick]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Title & Filter Bar */}
      <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-xl backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-950/60 p-2 border border-cyan-500/30">
              <TrendingUp className="text-cyan-400" size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                長期パフォーマンストレンド (Performance Trends)
              </h2>
              <p className="text-xs text-slate-400">
                テスト実行の時系列推移、フレームレート・メモリの劣化兆候、および品質合否率の長期分析
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchRuns}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            データ再読込
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 font-medium">
            <Filter size={14} className="text-cyan-400" />
            フィルター:
          </div>

          {/* Test Name Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">テスト名:</span>
            <select
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="ALL">すべてのテスト ({runs.length})</option>
              {testNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Platform Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">プラットフォーム:</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="ALL">すべて</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Version Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">バージョン:</span>
            <select
              value={gameVersion}
              onChange={(e) => setGameVersion(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="ALL">すべて</option>
              {gameVersions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Time Range Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">期間:</span>
            <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
              {(['7d', '14d', '30d', 'all'] as TrendTimeRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTimeRange(r)}
                  className={`rounded px-2.5 py-0.5 text-xs transition-colors cursor-pointer ${
                    timeRange === r
                      ? 'bg-cyan-600 text-white font-medium shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r === '7d'
                    ? '直近7日'
                    : r === '14d'
                      ? '直近14日'
                      : r === '30d'
                        ? '直近30日'
                        : '全期間'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center p-12 text-slate-400 gap-2">
          <Loader2 size={20} className="animate-spin text-cyan-400" />
          <span>トレンドデータを集計中...</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={18} />
          <span>データ読み込みエラー: {error}</span>
        </div>
      )}

      {!loading && !error && filteredRuns.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-12 text-center text-slate-400">
          <Calendar size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="text-base font-medium">条件に合致するテスト実行データがありません。</p>
          <p className="text-xs text-slate-500 mt-1">フィルター条件を変更してください。</p>
        </div>
      )}

      {!loading && !error && filteredRuns.length > 0 && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Pass Rate KPI */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-md backdrop-blur-sm">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>テスト通過率 (Pass Rate)</span>
                <CheckCircle2 size={16} className="text-green-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold ${
                    stats.passRate >= 90
                      ? 'text-green-400'
                      : stats.passRate >= 75
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }`}
                >
                  {stats.passRate}%
                </span>
                <span className="text-xs text-slate-400">
                  ({stats.passedRuns}/{stats.totalRuns} passed)
                </span>
              </div>
              <div className="mt-2 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full ${
                    stats.passRate >= 90
                      ? 'bg-green-500'
                      : stats.passRate >= 75
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, stats.passRate))}%` }}
                />
              </div>
            </div>

            {/* Latest Avg FPS KPI */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-md backdrop-blur-sm">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>最新 平均 FPS (Latest Avg)</span>
                <Gauge size={16} className="text-cyan-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-cyan-400">
                  {stats.latestAvgFps !== null ? `${stats.latestAvgFps.toFixed(1)}` : 'N/A'}
                </span>
                <span className="text-xs text-slate-400">fps</span>
              </div>
              <div className="mt-2 text-xs flex items-center gap-1">
                {stats.deltaFps !== null ? (
                  stats.deltaFps > 0 ? (
                    <span className="inline-flex items-center text-green-400 font-medium gap-0.5">
                      <ArrowUpRight size={14} /> +{stats.deltaFps.toFixed(1)} fps
                    </span>
                  ) : stats.deltaFps < 0 ? (
                    <span className="inline-flex items-center text-red-400 font-medium gap-0.5">
                      <ArrowDownRight size={14} /> {stats.deltaFps.toFixed(1)} fps
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-slate-400 gap-0.5">
                      <Minus size={14} /> ±0.0 fps
                    </span>
                  )
                ) : null}
                <span className="text-slate-500">
                  (全体平均: {stats.overallAvgFps ? `${stats.overallAvgFps.toFixed(1)} fps` : 'N/A'})
                </span>
              </div>
            </div>

            {/* Latest Peak Memory KPI */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-md backdrop-blur-sm">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>最新 ピークメモリ (Peak Mem)</span>
                <MemoryStick size={16} className="text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-400">
                  {stats.latestPeakMemory !== null ? `${Math.round(stats.latestPeakMemory)}` : 'N/A'}
                </span>
                <span className="text-xs text-slate-400">MB</span>
              </div>
              <div className="mt-2 text-xs flex items-center gap-1">
                {stats.deltaPeakMemory !== null ? (
                  stats.deltaPeakMemory > 0 ? (
                    <span className="inline-flex items-center text-yellow-400 font-medium gap-0.5">
                      <ArrowUpRight size={14} /> +{Math.round(stats.deltaPeakMemory)} MB
                    </span>
                  ) : stats.deltaPeakMemory < 0 ? (
                    <span className="inline-flex items-center text-green-400 font-medium gap-0.5">
                      <ArrowDownRight size={14} /> {Math.round(stats.deltaPeakMemory)} MB
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-slate-400 gap-0.5">
                      <Minus size={14} /> ±0 MB
                    </span>
                  )
                ) : null}
                <span className="text-slate-500">
                  (全体平均: {stats.overallPeakMemory ? `${Math.round(stats.overallPeakMemory)} MB` : 'N/A'})
                </span>
              </div>
            </div>

            {/* Executions count */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-md backdrop-blur-sm">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>記録テスト数 (Runs Recorded)</span>
                <Layers size={16} className="text-purple-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-purple-400">{stats.totalRuns}</span>
                <span className="text-xs text-slate-400">回</span>
              </div>
              <div className="mt-2 text-xs text-slate-500 truncate">
                {filteredRuns.length > 0
                  ? `${formatTrendDate(filteredRuns[0].timestamp)} 〜 ${formatTrendDate(filteredRuns[filteredRuns.length - 1].timestamp)}`
                  : '-'}
              </div>
            </div>
          </div>

          {/* Compare selection action bar */}
          {selectedForCompare.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 text-cyan-200">
                <ArrowLeftRight size={16} className="text-cyan-400" />
                <span>
                  比較選択中: <strong>{selectedForCompare.join(' vs ')}</strong>{' '}
                  {selectedForCompare.length === 1 && '(もう1件選択してください)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedForCompare([])}
                  className="rounded px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  クリア
                </button>
                <button
                  type="button"
                  onClick={handleStartCompare}
                  disabled={selectedForCompare.length !== 2}
                  className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ArrowLeftRight size={14} />
                  選択した2件を比較 (Diff)
                </button>
              </div>
            </div>
          )}

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* FPS & Stability Trend Chart */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Gauge size={18} className="text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-200">
                    FPS & フレーム安定性推移 (FPS Trend)
                  </h3>
                </div>
                <span className="text-xs text-slate-500">※点クリックで詳細表示</span>
              </div>
              <div className="h-72">
                <ReactECharts
                  option={fpsChartOption}
                  style={{ height: '100%', width: '100%' }}
                  onEvents={chartEvents}
                />
              </div>
            </div>

            {/* Peak Memory Trend Chart */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-xl backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <MemoryStick size={18} className="text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-200">
                    ピークメモリ推移 (Peak Memory Trend)
                  </h3>
                </div>
                <span className="text-xs text-slate-500">※点クリックで詳細表示</span>
              </div>
              <div className="h-72">
                <ReactECharts
                  option={memoryChartOption}
                  style={{ height: '100%', width: '100%' }}
                  onEvents={chartEvents}
                />
              </div>
            </div>

            {/* Daily Pass/Fail Distribution Chart */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-xl backdrop-blur-sm lg:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <BarChart3 size={18} className="text-yellow-400" />
                  <h3 className="text-sm font-semibold text-slate-200">
                    日別 テスト実行数 & 合格率推移 (Test Execution Volume & Quality)
                  </h3>
                </div>
              </div>
              <div className="h-64">
                <ReactECharts
                  option={passFailChartOption}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            </div>
          </div>

          {/* Chronological Table of Runs */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 shadow-xl backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  時系列テスト実行一覧 (Chronological Test Runs)
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                チェックボックスで 2 件選択して「比較」できます
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                  <tr>
                    <th className="py-2.5 px-3 w-8">比較</th>
                    <th className="py-2.5 px-3">Run ID</th>
                    <th className="py-2.5 px-3">日時</th>
                    <th className="py-2.5 px-3">バージョン</th>
                    <th className="py-2.5 px-3">プラットフォーム</th>
                    <th className="py-2.5 px-3">テスト名</th>
                    <th className="py-2.5 px-3">ステータス</th>
                    <th className="py-2.5 px-3 text-right">平均 FPS</th>
                    <th className="py-2.5 px-3 text-right">最低 FPS</th>
                    <th className="py-2.5 px-3 text-right">ピークメモリ</th>
                    <th className="py-2.5 px-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {[...filteredRuns].reverse().map((run) => {
                    const isChecked = selectedForCompare.includes(run.runId);
                    return (
                      <tr
                        key={run.runId}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          isChecked ? 'bg-cyan-950/20' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleCompare(run.runId)}
                            className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-cyan-300">
                          {run.runId}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                          {formatTrendDate(run.timestamp)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300 font-mono">
                            {run.gameVersion}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">{run.platform}</td>
                        <td className="py-2.5 px-3 text-slate-200">{run.testName}</td>
                        <td className="py-2.5 px-3">
                          {run.status === 'PASSED' && (
                            <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
                              <CheckCircle2 size={12} /> PASSED
                            </span>
                          )}
                          {run.status === 'FAILED' && (
                            <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
                              <XCircle size={12} /> FAILED
                            </span>
                          )}
                          {run.status === 'ABORTED' && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
                              <AlertTriangle size={12} /> ABORTED
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-cyan-300">
                          {run.avgFps !== undefined ? `${run.avgFps.toFixed(1)} fps` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-amber-300">
                          {run.minFps !== undefined ? `${run.minFps.toFixed(1)} fps` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-300">
                          {run.peakMemoryMb !== undefined
                            ? `${Math.round(run.peakMemoryMb)} MB`
                            : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => onOpenRun(run.runId)}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                          >
                            <span>詳細</span>
                            <ExternalLink size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
