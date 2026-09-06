/**
 * Configuration definition and loader for performance regression evaluation thresholds.
 */

export interface RegressionThresholdValues {
  fps: {
    /** Critical drop threshold in percent, e.g. 8.0 (triggers REGRESSION if drop >= 8.0%) */
    criticalDropPercent: number;
    /** Warning drop threshold in percent, e.g. 3.0 (triggers WARNING if drop >= 3.0%) */
    warningDropPercent: number;
    /** Improvement threshold in percent, e.g. 3.0 (triggers IMPROVED if increase >= 3.0%) */
    improvedPercent: number;
  };
  renderThread: {
    /** Critical RenderThread delta threshold in ms, e.g. 3.0 (triggers REGRESSION if delta >= 3.0ms) */
    criticalDeltaMs: number;
    /** Warning RenderThread delta threshold in ms, e.g. 1.5 (triggers WARNING if delta >= 1.5ms) */
    warningDeltaMs: number;
  };
  gameThread: {
    /** Critical GameThread delta threshold in ms, e.g. 3.0 (triggers REGRESSION if delta >= 3.0ms) */
    criticalDeltaMs: number;
    /** Warning GameThread delta threshold in ms, e.g. 1.5 (triggers WARNING if delta >= 1.5ms) */
    warningDeltaMs: number;
  };
  gpuFrame: {
    /** Critical GPUFrame delta threshold in ms, e.g. 4.0 (triggers REGRESSION if delta >= 4.0ms) */
    criticalDeltaMs: number;
    /** Warning GPUFrame delta threshold in ms, e.g. 2.0 (triggers WARNING if delta >= 2.0ms) */
    warningDeltaMs: number;
  };
  peakMemory: {
    /** Critical peak memory delta threshold in MB, e.g. 50.0 (triggers REGRESSION if delta >= 50.0MB) */
    criticalDeltaMb: number;
    /** Warning peak memory delta threshold in MB, e.g. 20.0 (triggers WARNING if delta >= 20.0MB) */
    warningDeltaMb: number;
  };
}

export const DEFAULT_REGRESSION_THRESHOLDS: RegressionThresholdValues = {
  fps: {
    criticalDropPercent: 8.0,
    warningDropPercent: 3.0,
    improvedPercent: 3.0,
  },
  renderThread: {
    criticalDeltaMs: 3.0,
    warningDeltaMs: 1.5,
  },
  gameThread: {
    criticalDeltaMs: 3.0,
    warningDeltaMs: 1.5,
  },
  gpuFrame: {
    criticalDeltaMs: 4.0,
    warningDeltaMs: 2.0,
  },
  peakMemory: {
    criticalDeltaMb: 50.0,
    warningDeltaMb: 20.0,
  },
};

/**
 * Loads threshold configuration from the external public/config/thresholds.json file,
 * falling back to DEFAULT_REGRESSION_THRESHOLDS on network failure or missing keys.
 */
export async function loadRegressionThresholds(): Promise<RegressionThresholdValues> {
  try {
    const base = import.meta.env.BASE_URL || '/';
    const cleanBase = base.endsWith('/') ? base : `${base}/`;
    const res = await fetch(`${cleanBase}config/thresholds.json`);
    if (!res.ok) {
      return DEFAULT_REGRESSION_THRESHOLDS;
    }
    const data = (await res.json()) as Partial<RegressionThresholdValues>;
    return {
      fps: {
        criticalDropPercent:
          data.fps?.criticalDropPercent ?? DEFAULT_REGRESSION_THRESHOLDS.fps.criticalDropPercent,
        warningDropPercent:
          data.fps?.warningDropPercent ?? DEFAULT_REGRESSION_THRESHOLDS.fps.warningDropPercent,
        improvedPercent:
          data.fps?.improvedPercent ?? DEFAULT_REGRESSION_THRESHOLDS.fps.improvedPercent,
      },
      renderThread: {
        criticalDeltaMs:
          data.renderThread?.criticalDeltaMs ??
          DEFAULT_REGRESSION_THRESHOLDS.renderThread.criticalDeltaMs,
        warningDeltaMs:
          data.renderThread?.warningDeltaMs ??
          DEFAULT_REGRESSION_THRESHOLDS.renderThread.warningDeltaMs,
      },
      gameThread: {
        criticalDeltaMs:
          data.gameThread?.criticalDeltaMs ??
          DEFAULT_REGRESSION_THRESHOLDS.gameThread.criticalDeltaMs,
        warningDeltaMs:
          data.gameThread?.warningDeltaMs ??
          DEFAULT_REGRESSION_THRESHOLDS.gameThread.warningDeltaMs,
      },
      gpuFrame: {
        criticalDeltaMs:
          data.gpuFrame?.criticalDeltaMs ?? DEFAULT_REGRESSION_THRESHOLDS.gpuFrame.criticalDeltaMs,
        warningDeltaMs:
          data.gpuFrame?.warningDeltaMs ?? DEFAULT_REGRESSION_THRESHOLDS.gpuFrame.warningDeltaMs,
      },
      peakMemory: {
        criticalDeltaMb:
          data.peakMemory?.criticalDeltaMb ??
          DEFAULT_REGRESSION_THRESHOLDS.peakMemory.criticalDeltaMb,
        warningDeltaMb:
          data.peakMemory?.warningDeltaMb ??
          DEFAULT_REGRESSION_THRESHOLDS.peakMemory.warningDeltaMb,
      },
    };
  } catch {
    return DEFAULT_REGRESSION_THRESHOLDS;
  }
}
