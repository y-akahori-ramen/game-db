import type { ComparisonSummary, FpsDiffMetric, MemoryDiffItem, RegressionVerdict } from '../types';
import {
  DEFAULT_REGRESSION_THRESHOLDS,
  type RegressionThresholdValues,
} from '../config/thresholds';

export function fromClause(name: string): string {
  return name.endsWith('.json') ? `read_json_auto('${name}')` : `read_csv_auto('${name}')`;
}

/**
 * Executes a DuckDB-WASM query that joins two FPS metric datasets by 1-second buckets
 * and computes delta FPS and thread times.
 */
export async function queryFpsComparison(
  executeQuery: <T>(sql: string) => Promise<T[]>,
  runAFileName: string,
  runBFileName: string,
): Promise<FpsDiffMetric[]> {
  const sql = `
    WITH a AS (
      SELECT 
        CAST(ROUND(ElapsedTime) AS INTEGER) AS sec,
        AVG(1000.0 / NULLIF(FPSMs, 0)) AS fps,
        AVG(FPSMs) AS frametime,
        AVG(GameThread) AS gameThread,
        AVG(RenderThread) AS renderThread,
        AVG(GPUFrame) AS gpuFrame
      FROM ${fromClause(runAFileName)}
      GROUP BY sec
    ),
    b AS (
      SELECT 
        CAST(ROUND(ElapsedTime) AS INTEGER) AS sec,
        AVG(1000.0 / NULLIF(FPSMs, 0)) AS fps,
        AVG(FPSMs) AS frametime,
        AVG(GameThread) AS gameThread,
        AVG(RenderThread) AS renderThread,
        AVG(GPUFrame) AS gpuFrame
      FROM ${fromClause(runBFileName)}
      GROUP BY sec
    )
    SELECT 
      COALESCE(a.sec, b.sec) AS second,
      ROUND(a.fps, 2) AS fpsA,
      ROUND(b.fps, 2) AS fpsB,
      ROUND(b.fps - a.fps, 2) AS deltaFps,
      ROUND(a.frametime, 2) AS frametimeA,
      ROUND(b.frametime, 2) AS frametimeB,
      ROUND(b.frametime - a.frametime, 2) AS deltaFrametime,
      ROUND(a.gameThread, 2) AS gameThreadA,
      ROUND(b.gameThread, 2) AS gameThreadB,
      ROUND(b.gameThread - a.gameThread, 2) AS deltaGameThread,
      ROUND(a.renderThread, 2) AS renderThreadA,
      ROUND(b.renderThread, 2) AS renderThreadB,
      ROUND(b.renderThread - a.renderThread, 2) AS deltaRenderThread,
      ROUND(a.gpuFrame, 2) AS gpuFrameA,
      ROUND(b.gpuFrame, 2) AS gpuFrameB,
      ROUND(b.gpuFrame - a.gpuFrame, 2) AS deltaGpuFrame
    FROM a
    FULL OUTER JOIN b ON a.sec = b.sec
    ORDER BY second ASC;
  `;
  return executeQuery<FpsDiffMetric>(sql);
}

export interface MemoryTimelinePoint {
  index: number;
  memA: number | null;
  memB: number | null;
  deltaMem: number | null;
}

export interface MemoryComparisonResult {
  timeline: MemoryTimelinePoint[];
  peakDiffs: MemoryDiffItem[];
}

/**
 * Queries and computes memory differences across Run A and Run B.
 */
export async function queryMemoryComparison(
  executeQuery: <T>(sql: string) => Promise<T[]>,
  runAFileName: string,
  runBFileName: string,
): Promise<MemoryComparisonResult> {
  const [rowsA, rowsB] = await Promise.all([
    executeQuery<Record<string, number>>(`SELECT * FROM ${fromClause(runAFileName)}`),
    executeQuery<Record<string, number>>(`SELECT * FROM ${fromClause(runBFileName)}`),
  ]);

  const maxLen = Math.max(rowsA.length, rowsB.length);
  const timeline: MemoryTimelinePoint[] = [];

  for (let i = 0; i < maxLen; i++) {
    const valA = rowsA[i]?.TrackedTotal ?? null;
    const valB = rowsB[i]?.TrackedTotal ?? null;
    const delta =
      valA !== null && valB !== null ? Number((valB - valA).toFixed(2)) : null;
    timeline.push({
      index: i,
      memA: valA !== null ? Number(valA.toFixed(2)) : null,
      memB: valB !== null ? Number(valB.toFixed(2)) : null,
      deltaMem: delta,
    });
  }

  // Aggregate peak columns
  const allKeys = new Set<string>();
  if (rowsA[0]) Object.keys(rowsA[0]).forEach((k) => allKeys.add(k));
  if (rowsB[0]) Object.keys(rowsB[0]).forEach((k) => allKeys.add(k));

  const peakDiffs: MemoryDiffItem[] = [];
  for (const key of allKeys) {
    const peakA = rowsA.reduce((max, r) => (r[key] !== undefined && r[key] > max ? r[key] : max), 0);
    const peakB = rowsB.reduce((max, r) => (r[key] !== undefined && r[key] > max ? r[key] : max), 0);
    const delta = peakB - peakA;
    const deltaPercent = peakA > 0 ? (delta / peakA) * 100 : 0;

    peakDiffs.push({
      category: key,
      peakA: Number(peakA.toFixed(2)),
      peakB: Number(peakB.toFixed(2)),
      deltaPeak: Number(delta.toFixed(2)),
      deltaPercent: Number(deltaPercent.toFixed(1)),
    });
  }

  // Put TrackedTotal first, then sort remainder by delta magnitude descending
  peakDiffs.sort((a, b) => {
    if (a.category === 'TrackedTotal') return -1;
    if (b.category === 'TrackedTotal') return 1;
    return Math.abs(b.deltaPeak) - Math.abs(a.deltaPeak);
  });

  return { timeline, peakDiffs };
}

/**
 * Computes high-level KPIs and evaluates whether a regression occurred.
 */
export function computeComparisonSummary(
  fpsMetrics: FpsDiffMetric[],
  peakDiffs: MemoryDiffItem[] = [],
  thresholds: RegressionThresholdValues = DEFAULT_REGRESSION_THRESHOLDS,
): ComparisonSummary {
  const validFpsA = fpsMetrics.filter((m) => m.fpsA !== null).map((m) => m.fpsA as number);
  const validFpsB = fpsMetrics.filter((m) => m.fpsB !== null).map((m) => m.fpsB as number);
  const validFrametimeA = fpsMetrics.filter((m) => m.frametimeA !== null).map((m) => m.frametimeA as number);
  const validFrametimeB = fpsMetrics.filter((m) => m.frametimeB !== null).map((m) => m.frametimeB as number);
  const validRtA = fpsMetrics.filter((m) => m.renderThreadA !== null).map((m) => m.renderThreadA as number);
  const validRtB = fpsMetrics.filter((m) => m.renderThreadB !== null).map((m) => m.renderThreadB as number);
  const validGtA = fpsMetrics.filter((m) => m.gameThreadA !== null).map((m) => m.gameThreadA as number);
  const validGtB = fpsMetrics.filter((m) => m.gameThreadB !== null).map((m) => m.gameThreadB as number);
  const validGpuA = fpsMetrics.filter((m) => m.gpuFrameA !== null).map((m) => m.gpuFrameA as number);
  const validGpuB = fpsMetrics.filter((m) => m.gpuFrameB !== null).map((m) => m.gpuFrameB as number);

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const avgFpsA = Number(avg(validFpsA).toFixed(2));
  const avgFpsB = Number(avg(validFpsB).toFixed(2));
  const deltaFps = Number((avgFpsB - avgFpsA).toFixed(2));
  const deltaFpsPercent = avgFpsA > 0 ? Number(((deltaFps / avgFpsA) * 100).toFixed(1)) : 0;

  const avgFrametimeA = Number(avg(validFrametimeA).toFixed(2));
  const avgFrametimeB = Number(avg(validFrametimeB).toFixed(2));

  const avgRenderThreadA = Number(avg(validRtA).toFixed(2));
  const avgRenderThreadB = Number(avg(validRtB).toFixed(2));
  const deltaRenderThread = Number((avgRenderThreadB - avgRenderThreadA).toFixed(2));

  const avgGameThreadA = Number(avg(validGtA).toFixed(2));
  const avgGameThreadB = Number(avg(validGtB).toFixed(2));
  const deltaGameThread = Number((avgGameThreadB - avgGameThreadA).toFixed(2));

  const avgGpuFrameA = Number(avg(validGpuA).toFixed(2));
  const avgGpuFrameB = Number(avg(validGpuB).toFixed(2));
  const deltaGpuFrame = Number((avgGpuFrameB - avgGpuFrameA).toFixed(2));

  const trackedTotalItem = peakDiffs.find((p) => p.category === 'TrackedTotal');
  const peakMemoryA = trackedTotalItem?.peakA;
  const peakMemoryB = trackedTotalItem?.peakB;
  const deltaPeakMemory =
    peakMemoryA !== undefined && peakMemoryB !== undefined
      ? Number((peakMemoryB - peakMemoryA).toFixed(2))
      : undefined;

  // Evaluate regression based on configured thresholds
  const { fps, renderThread, gameThread, gpuFrame, peakMemory } = thresholds;
  const criticalReasons: string[] = [];
  const warningReasons: string[] = [];
  const positiveReasons: string[] = [];

  if (deltaFpsPercent <= -fps.criticalDropPercent) {
    criticalReasons.push(`平均FPSが大幅に低下しています (${deltaFpsPercent}%)`);
  } else if (deltaFpsPercent <= -fps.warningDropPercent) {
    warningReasons.push(`平均FPSが低下しています (${deltaFpsPercent}%)`);
  } else if (deltaFpsPercent >= fps.improvedPercent) {
    positiveReasons.push(`平均FPSが向上しています (+${deltaFpsPercent}%)`);
  }

  if (deltaRenderThread >= renderThread.criticalDeltaMs) {
    criticalReasons.push(`RenderThread負荷が増大しています (+${deltaRenderThread}ms)`);
  } else if (deltaRenderThread >= renderThread.warningDeltaMs) {
    warningReasons.push(`RenderThread負荷がやや増加しています (+${deltaRenderThread}ms)`);
  }

  if (deltaGameThread >= gameThread.criticalDeltaMs) {
    criticalReasons.push(`GameThread負荷が増大しています (+${deltaGameThread}ms)`);
  } else if (deltaGameThread >= gameThread.warningDeltaMs) {
    warningReasons.push(`GameThread負荷がやや増加しています (+${deltaGameThread}ms)`);
  }

  if (deltaGpuFrame >= gpuFrame.criticalDeltaMs) {
    criticalReasons.push(`GPUFrame負荷が増大しています (+${deltaGpuFrame}ms)`);
  } else if (deltaGpuFrame >= gpuFrame.warningDeltaMs) {
    warningReasons.push(`GPUFrame負荷がやや増加しています (+${deltaGpuFrame}ms)`);
  }

  if (deltaPeakMemory !== undefined && deltaPeakMemory >= peakMemory.criticalDeltaMb) {
    criticalReasons.push(`ピークメモリ消費が大幅に増加しています (+${deltaPeakMemory}MB)`);
  } else if (deltaPeakMemory !== undefined && deltaPeakMemory >= peakMemory.warningDeltaMb) {
    warningReasons.push(`ピークメモリ消費が増加しています (+${deltaPeakMemory}MB)`);
  }

  let verdict: RegressionVerdict = 'EQUIVALENT';
  let verdictReasons: string[] = [];

  if (criticalReasons.length > 0) {
    verdict = 'REGRESSION';
    verdictReasons = [...criticalReasons, ...warningReasons];
  } else if (warningReasons.length > 0) {
    verdict = 'WARNING';
    verdictReasons = warningReasons;
  } else if (positiveReasons.length > 0) {
    verdict = 'IMPROVED';
    verdictReasons = positiveReasons;
  } else {
    verdict = 'EQUIVALENT';
    verdictReasons = [
      `性能に有意な変動は検知されませんでした (±${fps.warningDropPercent}%以内)`,
    ];
  }

  return {
    avgFpsA,
    avgFpsB,
    deltaFps,
    deltaFpsPercent,
    avgFrametimeA,
    avgFrametimeB,
    avgRenderThreadA,
    avgRenderThreadB,
    deltaRenderThread,
    avgGameThreadA,
    avgGameThreadB,
    deltaGameThread,
    avgGpuFrameA,
    avgGpuFrameB,
    deltaGpuFrame,
    peakMemoryA,
    peakMemoryB,
    deltaPeakMemory,
    verdict,
    verdictReasons,
  };
}
