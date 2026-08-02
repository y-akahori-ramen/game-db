# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pandas",
#     "numpy",
# ]
# ///
"""Generate dummy QA metrics CSV files into public/sample_data/.

CSV (not Parquet) matches how UE itself outputs FPS/memory stats and keeps
the format consistent with the log data, which is also handled as raw text.

Log sample data is public/sample_data/samplelog.log (a real UE log file), not
generated here.

Run with: uv run scripts/generate_sample_data.py
"""

import random
from pathlib import Path

import numpy as np
import pandas as pd

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "sample_data"
DURATION_SEC = 300
SAMPLE_HZ = 2  # 2 samples per second

rng = np.random.default_rng(42)
random.seed(42)


def generate_fps() -> pd.DataFrame:
    n = DURATION_SEC * SAMPLE_HZ
    t = np.arange(n) / SAMPLE_HZ
    # Base fps around 55 with slow oscillation and noise
    fps = 55 + 4 * np.sin(t / 20) + rng.normal(0, 1.5, n)
    # Inject drop windows (heavy scenes)
    for start, length, floor in [(60, 8, 22), (145, 5, 15), (230, 12, 25)]:
        idx = (t >= start) & (t < start + length)
        fps[idx] = floor + rng.normal(0, 3, idx.sum())
    # Random single-frame spikes
    spikes = rng.choice(n, size=10, replace=False)
    fps[spikes] -= rng.uniform(15, 30, 10)
    fps = np.clip(fps, 5, 62)
    frame_time_ms = 1000.0 / fps
    return pd.DataFrame(
        {
            "timestamp": t.astype(np.float64),
            "fps": fps.round(2),
            "frame_time_ms": frame_time_ms.round(2),
        }
    )


def generate_memory() -> pd.DataFrame:
    n = DURATION_SEC * SAMPLE_HZ
    t = np.arange(n) / SAMPLE_HZ
    # Gradually increasing RAM with GC-like drops
    ram = 2048 + t * 2.5 + rng.normal(0, 20, n)
    for gc_at in [90, 180, 260]:
        ram[t >= gc_at] -= 150
    vram = 3000 + 300 * np.sin(t / 40) + t * 1.2 + rng.normal(0, 30, n)
    heap = 512 + t * 1.8 + rng.normal(0, 10, n)
    for gc_at in [70, 140, 210, 280]:
        heap[t >= gc_at] -= 80
    return pd.DataFrame(
        {
            "timestamp": t.astype(np.float64),
            "vram_mb": np.clip(vram, 0, None).round(1),
            "ram_mb": np.clip(ram, 0, None).round(1),
            "heap_mb": np.clip(heap, 0, None).round(1),
        }
    )


def main() -> None:
    # Log sample data is the real UE log at public/sample_data/samplelog.log, parsed at
    # runtime by the same pipeline as user-uploaded logs (see src/utils/ueLogParser.ts)
    # rather than generated here.
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    datasets = {
        "fps_metrics.csv": generate_fps(),
        "memory_metrics.csv": generate_memory(),
    }
    for name, df in datasets.items():
        path = OUT_DIR / name
        df.to_csv(path, index=False)
        print(f"wrote {path} ({len(df)} rows)")


if __name__ == "__main__":
    main()
