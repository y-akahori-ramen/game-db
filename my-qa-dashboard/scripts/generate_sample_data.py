# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pandas",
#     "pyarrow",
#     "numpy",
# ]
# ///
"""Generate dummy QA metrics/log Parquet files into public/sample_data/.

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


MESSAGES = {
    "INFO": {
        "Graphics": [
            "Shader cache hit for material '{m}'",
            "Render target resized to {w}x{h}",
            "LOD level switched to {lod} for mesh '{m}'",
        ],
        "Network": [
            "Heartbeat OK (rtt={ms}ms)",
            "Session sync completed in {ms}ms",
            "Packet batch sent ({n} packets)",
        ],
        "Physics": [
            "Broadphase pairs: {n}",
            "Ragdoll activated for entity {e}",
            "Collision island rebuilt ({n} bodies)",
        ],
        "Script": [
            "Quest state updated: {m}",
            "Coroutine '{m}' completed",
            "Event '{m}' dispatched to {n} listeners",
        ],
    },
    "WARN": {
        "Graphics": [
            "Texture streaming budget exceeded by {n}MB",
            "Shader compilation stall ({ms}ms) for '{m}'",
            "Draw call count high: {n}",
        ],
        "Network": [
            "High latency detected (rtt={ms}ms)",
            "Packet loss {n}% on channel {e}",
            "Retrying RPC '{m}' (attempt {lod})",
        ],
        "Physics": [
            "Solver iteration cap reached ({n} bodies)",
            "Penetration depth exceeds threshold for entity {e}",
        ],
        "Script": [
            "Deprecated API '{m}' called",
            "Script frame budget exceeded ({ms}ms)",
        ],
    },
    "ERROR": {
        "Graphics": [
            "Failed to compile shader '{m}': invalid semantic",
            "GPU fence timeout after {ms}ms",
            "Texture '{m}' failed to load: corrupt mip chain",
        ],
        "Network": [
            "Connection reset by peer (session {e})",
            "RPC '{m}' failed: timeout after {ms}ms",
        ],
        "Physics": [
            "NaN detected in rigid body velocity (entity {e})",
            "Convex hull generation failed for mesh '{m}'",
        ],
        "Script": [
            "NullReferenceException in '{m}' at line {n}",
            "Unhandled exception in coroutine '{m}'",
        ],
    },
    "FATAL": {
        "Graphics": ["Device removed: DXGI_ERROR_DEVICE_HUNG"],
        "Network": ["Session irrecoverably desynced, aborting test run"],
        "Physics": ["Physics world corrupted, cannot continue"],
        "Script": ["Script VM crashed: stack overflow in '{m}'"],
    },
}

NAMES = [
    "env_rock_large",
    "chr_hero_body",
    "fx_explosion",
    "ui_hud_main",
    "npc_guard_ai",
    "water_surface",
    "terrain_patch_12",
    "boss_dragon",
]


def fill(template: str) -> str:
    return template.format(
        m=random.choice(NAMES),
        w=random.choice([1280, 1920, 2560, 3840]),
        h=random.choice([720, 1080, 1440, 2160]),
        lod=random.randint(0, 4),
        ms=random.randint(5, 900),
        n=random.randint(1, 500),
        e=random.randint(100, 9999),
    )


def generate_logs(count: int = 1000) -> pd.DataFrame:
    levels = rng.choice(
        ["INFO", "WARN", "ERROR", "FATAL"], size=count, p=[0.70, 0.18, 0.11, 0.01]
    )
    rows = []
    for level in levels:
        category = random.choice(list(MESSAGES[level].keys()))
        message = fill(random.choice(MESSAGES[level][category]))
        rows.append(
            {
                "timestamp": round(random.uniform(0, DURATION_SEC), 3),
                "level": level,
                "category": category,
                "message": message,
            }
        )
    df = pd.DataFrame(rows).sort_values("timestamp").reset_index(drop=True)
    return df


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    datasets = {
        "fps_metrics.parquet": generate_fps(),
        "memory_metrics.parquet": generate_memory(),
        "logs.parquet": generate_logs(),
    }
    for name, df in datasets.items():
        path = OUT_DIR / name
        df.to_parquet(path, index=False)
        print(f"wrote {path} ({len(df)} rows)")


if __name__ == "__main__":
    main()
