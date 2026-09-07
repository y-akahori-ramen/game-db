# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pandas",
#     "numpy",
#     "pillow",
# ]
# ///
"""Generate dummy QA metrics per test run into public/sample_data/run-XXX/,
plus the mock search index public/mock_data/runs.json.

CSV/JSON (not Parquet) matches how UE itself outputs FPS/memory stats and keeps
the format consistent with the log data, which is also handled as raw text.
run-003 uses JSON to exercise the read_json_auto loading path in the app.

Log sample data is public/sample_data/samplelog.log (a real UE log file), not
generated here; every run points at it.

Video sample data is sample/sample-3.mp4 (not generated here). It is copied
into each run directory that has a video (see RunSpec.video below) so the
dashboard's video panel has something to play; runs without a video exercise
the "no video" fallback (unchanged current display).

Screenshot sample data is a handful of dummy PNGs generated per run (see
RunSpec.screenshots below) so the artifacts panel has something to list and
download besides fps/memory/log/video; runs with 0 screenshots exercise the
"no screenshots" case.

Each run's `artifacts` list in runs.json enumerates every file the run
produced (fps/memory/log/video/screenshots), matching TestRunArtifact in
src/services/SearchService.ts.

Run with: uv run scripts/generate_sample_data.py
"""

import json
import random
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_ROOT / "public"
SAMPLE_DIR = PUBLIC_DIR / "sample_data"
MOCK_DIR = PUBLIC_DIR / "mock_data"
SOURCE_VIDEO = REPO_ROOT / "sample" / "sample-3.mp4"
DURATION_SEC = 300
SAMPLE_HZ = 2  # 2 samples per second

rng = np.random.default_rng(42)
random.seed(42)


@dataclass(frozen=True)
class RunSpec:
    run_id: str
    game_version: str
    platform: str
    test_name: str
    status: str  # PASSED | FAILED | ABORTED
    timestamp: str
    fmt: str  # csv | json
    base_fps: float
    drops: list[tuple[int, int, int]]  # (start_sec, length_sec, floor_fps)
    duration_seconds: float = 300.0
    device_model: str = ""
    triggered_by: str = ""
    levels: list[str] = field(default_factory=lambda: ["PL_Level1", "PL_Level2"])
    video: bool = False  # whether this run has a captured gameplay video
    video_files: list[str] = field(default_factory=list)  # additional video files to include
    screenshots: int = 0  # number of dummy screenshot PNGs to generate
    extra_artifacts: list[tuple[str, str, str | bytes]] = field(default_factory=list)


RUNS = [
    RunSpec(
        run_id="run-001",
        game_version="v1.2.0",
        platform="PS5",
        test_name="Level1_Playthrough",
        status="FAILED",
        timestamp="2026-08-01T10:15:00Z",
        fmt="csv",
        base_fps=55,
        drops=[(60, 8, 22), (145, 5, 15), (230, 12, 25)],
        duration_seconds=300.0,
        device_model="PlayStation 5 CFI-1200",
        triggered_by="nightly",
        video=True,
        video_files=["video_boss_fight.mp4"],
        screenshots=3,
        extra_artifacts=[
            ("crash.dmp", "crashdump", b"MDMP\x93\xa7\x00\x00\x01\x00\x00\x00\x20\x00\x00\x00"),
            ("profile.utrace", "trace", b"UTRACE\x01\x00\x00\x00\x00\x00\x00\x00"),
            (
                "test_report.html",
                "report",
                """<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Test Report - run-001</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { color: #38bdf8; }
    .status { padding: 4px 12px; border-radius: 4px; background: #ef444420; color: #f87171; font-weight: bold; }
  </style>
</head>
<body>
  <h1>QA Test Execution Report</h1>
  <p><strong>Run ID:</strong> run-001</p>
  <p><strong>Status:</strong> <span class="status">FAILED</span></p>
</body>
</html>""",
            ),
        ],
    ),
    RunSpec(
        run_id="run-002",
        game_version="v1.2.0",
        platform="Windows",
        test_name="Boss_Battle_Stress",
        status="PASSED",
        timestamp="2026-08-01T14:40:00Z",
        fmt="csv",
        base_fps=58,
        drops=[(120, 4, 35)],
        duration_seconds=300.0,
        device_model="GeForce RTX 4080 / i7-14700K",
        triggered_by="nightly",
        video=True,
        screenshots=2,
    ),
    RunSpec(
        run_id="run-003",
        game_version="v1.3.0-beta",
        platform="iOS",
        test_name="Level1_Playthrough",
        status="PASSED",
        timestamp="2026-08-02T09:05:00Z",
        fmt="json",
        base_fps=29,
        drops=[(90, 6, 12), (200, 10, 15)],
        duration_seconds=300.0,
        device_model="iPhone 15 Pro",
        triggered_by="pr_check",
    ),
    RunSpec(
        run_id="run-004",
        game_version="v1.2.1",
        platform="PS5",
        test_name="Level1_Playthrough",
        status="PASSED",
        timestamp="2026-08-03T11:00:00Z",
        fmt="csv",
        base_fps=59,
        drops=[(60, 4, 38)],
        duration_seconds=300.0,
        device_model="PlayStation 5 CFI-1200",
        triggered_by="manual",
        video=True,
        screenshots=2,
    ),
    RunSpec(
        run_id="run-005",
        game_version="v1.2.1",
        platform="Windows",
        test_name="Boss_Battle_Stress",
        status="ABORTED",
        timestamp="2026-08-02T16:20:00Z",
        fmt="csv",
        base_fps=60,
        drops=[],
        duration_seconds=145.0,
        device_model="GeForce RTX 4080 / i7-14700K",
        triggered_by="nightly",
        video=True,
        screenshots=1,
    ),
]



def generate_fps(spec: RunSpec) -> pd.DataFrame:
    """Build a frame-by-frame FPS table matching UE's Stat/CSV output shape
    (see my-qa-dashboard/sample/fpssample.csv). Columns beyond the common set
    (log_time, frame, X, Y, Z, FPS, ActorName) are project-specific extras
    that the dashboard ignores; only PersistentLevel, FPSMs, GameThread,
    RenderThread, GPUFrame, RHIThreadTime and ElapsedTime are read.
    """
    n = DURATION_SEC * SAMPLE_HZ
    t = np.arange(n) / SAMPLE_HZ
    # Base fps with slow oscillation and noise
    fps = spec.base_fps + 4 * np.sin(t / 20) + rng.normal(0, 1.5, n)
    # Inject drop windows (heavy scenes)
    for start, length, floor in spec.drops:
        idx = (t >= start) & (t < start + length)
        fps[idx] = floor + rng.normal(0, 3, idx.sum())
    # Random single-frame spikes
    spikes = rng.choice(n, size=10, replace=False)
    fps[spikes] -= rng.uniform(10, spec.base_fps * 0.5, 10)
    fps = np.clip(fps, 5, spec.base_fps * 1.15)
    fps_ms = 1000.0 / fps

    # Split frame time across thread stats, each a plausible share of FPSMs.
    game_thread = fps_ms * rng.uniform(0.35, 0.45, n)
    render_thread = fps_ms * rng.uniform(0.25, 0.35, n)
    gpu_frame = fps_ms * rng.uniform(0.5, 0.65, n)
    rhi_thread_time = fps_ms * rng.uniform(0.1, 0.2, n)

    # ElapsedTime is the cumulative wall-clock time (sec) implied by each
    # frame's own duration, mirroring how UE stamps frames.
    elapsed_time = np.cumsum(fps_ms) / 1000.0

    # PersistentLevel switches once partway through the run, e.g. streaming
    # into a second level.
    switch_at = elapsed_time[-1] / 2
    persistent_level = np.where(elapsed_time < switch_at, spec.levels[0], spec.levels[-1])

    start_dt = datetime(2026, 7, 31, 5, 8, 44)
    log_time = [
        (start_dt + timedelta(seconds=float(s))).strftime("%Y.%m.%d-%H.%M.%S:") + f"{int((s % 1) * 1000):03d}"
        for s in elapsed_time
    ]
    frame = (np.arange(n) * 2 + 262).astype(np.int64)

    return pd.DataFrame(
        {
            "log_time": log_time,
            "frame": frame,
            "PersistentLevel": persistent_level,
            "X": 0.0,
            "Y": 0.0,
            "Z": 0.0,
            "FPS": fps.round(6),
            "FPSMs": fps_ms.round(6),
            "GameThread": game_thread.round(6),
            "RenderThread": render_thread.round(6),
            "GPUFrame": gpu_frame.round(6),
            "RHIThreadTime": rhi_thread_time.round(6),
            "ActorName": "",
            "ElapsedTime": elapsed_time.round(6),
        }
    )


#: Per-platform LLM (Low-Level Memory Tracker) tag -> (base_mb, drift_per_sec, noise_std).
#: Column sets deliberately differ by platform (e.g. only consoles report Wwise
#: audio tags, only mobile reports CriWare) since the dashboard must not assume
#: a fixed set of memory columns. `TrackedTotal` is not listed here: it is
#: always present and is derived as the sum of a run's other tags.
_MEMORY_TAG_PROFILES: dict[str, dict[str, tuple[float, float, float]]] = {
    "PS5": {
        "Untagged": (6.2, 0.003, 0.15),
        "UObject": (103.0, 0.0004, 0.05),
        "CriWare": (135.5, 0.0, 0.0),
        "EngineMisc": (4.1, 0.0004, 0.05),
        "Audio": (53.7, 0.0002, 0.03),
        "Audio/AudioMixer": (9.47, 0.0002, 0.03),
        "EngineMisc/FMsgLogf": (0.13, 0.0005, 0.02),
        "Audio/Wwise": (42.12, 0.0, 0.0),
        "Audio/Wwise/Wwise Resource Loader": (0.1, 0.0, 0.0),
    },
    "Windows": {
        "Untagged": (8.5, 0.004, 0.2),
        "UObject": (140.0, 0.0006, 0.08),
        "EngineMisc": (5.5, 0.0005, 0.06),
        "Audio": (61.0, 0.0003, 0.04),
        "Audio/AudioMixer": (11.2, 0.0003, 0.04),
        "Textures": (210.0, 0.0015, 0.5),
        "RenderTargets": (95.0, 0.0008, 0.3),
        "RHI": (48.0, 0.0004, 0.15),
    },
    "iOS": {
        "Untagged": (4.8, 0.002, 0.1),
        "UObject": (72.0, 0.0003, 0.04),
        "CriWare": (58.0, 0.0, 0.0),
        "EngineMisc": (3.0, 0.0003, 0.03),
        "Audio": (24.5, 0.0002, 0.02),
        "Textures": (110.0, 0.0009, 0.25),
        "RenderTargets": (40.0, 0.0004, 0.12),
    },
}


def generate_memory(spec: RunSpec) -> pd.DataFrame:
    """Build a memory tracker table matching UE's LLM CSV output shape (see
    my-qa-dashboard/sample/llmsample.csv): one column per memory tag plus a
    `TrackedTotal` column that is always present. Which tags appear varies by
    platform, matching how the real LLM tracker only reports tags relevant to
    the platform's subsystems. There is no timestamp column.
    """
    n = DURATION_SEC * SAMPLE_HZ
    t = np.arange(n) / SAMPLE_HZ
    profile = _MEMORY_TAG_PROFILES.get(spec.platform, _MEMORY_TAG_PROFILES["Windows"])

    columns: dict[str, np.ndarray] = {}
    total = np.zeros(n)
    for tag, (base, drift_per_sec, noise_std) in profile.items():
        series = base + t * drift_per_sec + (rng.normal(0, noise_std, n) if noise_std else 0.0)
        # GC-like periodic drops, offset per tag so they don't all dip together.
        offset = hash(tag) % 40
        for gc_at in [70 + offset, 150 + offset, 230 + offset]:
            series[t >= gc_at] -= base * 0.03
        series = np.clip(series, 0, None)
        columns[tag] = series.round(2)
        total += series

    return pd.DataFrame({"TrackedTotal": total.round(2), **columns})


def generate_screenshot(index: int, run_id: str, spec: RunSpec) -> Image.Image:
    """Build a small dummy screenshot PNG (gradient + label text) so the
    artifacts panel has real image files to list/preview/download.
    """
    width, height = 320, 180
    top = tuple(rng.integers(40, 120, 3).tolist())
    bottom = tuple(rng.integers(0, 40, 3).tolist())
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        ratio = y / max(height - 1, 1)
        color = tuple(int(top[c] + (bottom[c] - top[c]) * ratio) for c in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    draw.rectangle([8, 8, width - 8, height - 8], outline=(255, 255, 255), width=1)
    draw.text((16, 16), f"{run_id}", fill=(255, 255, 255))
    draw.text((16, 36), f"{spec.test_name}", fill=(220, 220, 220))
    draw.text((16, height - 28), f"shot {index:03d}", fill=(0, 255, 255))
    return img


def write_metrics(df: pd.DataFrame, path: Path) -> None:
    if path.suffix == ".json":
        path.write_text(json.dumps(df.to_dict(orient="records")), encoding="utf-8")
    else:
        df.to_csv(path, index=False)
    print(f"wrote {path} ({len(df)} rows)")


def main() -> None:
    MOCK_DIR.mkdir(parents=True, exist_ok=True)
    summaries = []
    for spec in RUNS:
        run_dir = SAMPLE_DIR / spec.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        fps_name = f"fps_metrics.{spec.fmt}"
        memory_name = f"memory_metrics.{spec.fmt}"
        df_fps = generate_fps(spec)
        df_mem = generate_memory(spec)
        write_metrics(df_fps, run_dir / fps_name)
        write_metrics(df_mem, run_dir / memory_name)

        video_url = None
        if spec.video:
            if not SOURCE_VIDEO.exists():
                raise FileNotFoundError(f"Source video not found: {SOURCE_VIDEO}")
            video_path = run_dir / "video.mp4"
            shutil.copyfile(SOURCE_VIDEO, video_path)
            video_url = f"sample_data/{spec.run_id}/video.mp4"
            print(f"wrote {video_path}")

        screenshot_urls: list[str] = []
        for i in range(spec.screenshots):
            shot_name = f"screenshot_{i + 1:03d}.png"
            shot_path = run_dir / shot_name
            generate_screenshot(i + 1, spec.run_id, spec).save(shot_path)
            screenshot_urls.append(f"sample_data/{spec.run_id}/{shot_name}")
            print(f"wrote {shot_path}")

        # URLs are BASE_URL-relative (no leading slash), matching TestRunSummary
        # in src/services/SearchService.ts.
        fps_url = f"sample_data/{spec.run_id}/{fps_name}"
        memory_url = f"sample_data/{spec.run_id}/{memory_name}"
        logs_url = "sample_data/samplelog.log"

        def get_file_size(p: Path) -> int:
            try:
                return p.stat().st_size
            except OSError:
                return 0

        artifacts = [
            {"url": fps_url, "fileName": fps_name, "type": "fps", "sizeBytes": get_file_size(run_dir / fps_name)},
            {"url": memory_url, "fileName": memory_name, "type": "memory", "sizeBytes": get_file_size(run_dir / memory_name)},
            {"url": logs_url, "fileName": "samplelog.log", "type": "log", "sizeBytes": get_file_size(SAMPLE_DIR / "samplelog.log")},
        ]
        if video_url:
            artifacts.append({"url": video_url, "fileName": "video.mp4", "type": "video", "sizeBytes": get_file_size(run_dir / "video.mp4")})
        for extra_video in spec.video_files:
            extra_video_path = run_dir / extra_video
            shutil.copyfile(SOURCE_VIDEO, extra_video_path)
            extra_video_url = f"sample_data/{spec.run_id}/{extra_video}"
            artifacts.append({"url": extra_video_url, "fileName": extra_video, "type": "video", "sizeBytes": get_file_size(extra_video_path)})
            print(f"wrote {extra_video_path}")
        for shot_url in screenshot_urls:
            shot_file_name = Path(shot_url).name
            artifacts.append({"url": shot_url, "fileName": shot_file_name, "type": "screenshot", "sizeBytes": get_file_size(run_dir / shot_file_name)})
        for extra_name, extra_type, extra_content in spec.extra_artifacts:
            extra_path = run_dir / extra_name
            if isinstance(extra_content, bytes):
                extra_path.write_bytes(extra_content)
            else:
                extra_path.write_text(extra_content, encoding="utf-8")
            artifacts.append({"url": f"sample_data/{spec.run_id}/{extra_name}", "fileName": extra_name, "type": extra_type, "sizeBytes": get_file_size(extra_path)})
            print(f"wrote {extra_path}")

        fps_inst = 1000.0 / df_fps["FPSMs"].replace(0, np.nan)
        avg_fps = round(float(fps_inst.mean()), 1)
        min_fps = round(float(fps_inst.min()), 1)
        peak_memory_mb = round(float(df_mem["TrackedTotal"].max() / (1024 * 1024)), 1)
        total_size_bytes = sum(a.get("sizeBytes", 0) for a in artifacts)

        summary = {
            "runId": spec.run_id,
            "gameVersion": spec.game_version,
            "platform": spec.platform,
            "testName": spec.test_name,
            "status": spec.status,
            "timestamp": spec.timestamp,
            "avgFps": avg_fps,
            "minFps": min_fps,
            "peakMemoryMb": peak_memory_mb,
            "durationSeconds": spec.duration_seconds,
            "deviceModel": spec.device_model or None,
            "triggeredBy": spec.triggered_by or None,
            "totalSizeBytes": total_size_bytes,
            "updatedAt": spec.timestamp,
            "fpsDataUrl": fps_url,
            "memoryDataUrl": memory_url,
            "logsDataUrl": logs_url,
            "artifacts": artifacts,
        }
        if video_url:
            summary["videoUrl"] = video_url
        summaries.append(summary)
    runs_json = MOCK_DIR / "runs.json"
    runs_json.write_text(json.dumps(summaries, indent=2), encoding="utf-8")
    print(f"wrote {runs_json} ({len(summaries)} runs)")


if __name__ == "__main__":
    main()
