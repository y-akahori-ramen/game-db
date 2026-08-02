# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "boto3>=1.43.31",
# ]
# ///
"""Upload a QA test run to S3 using the child-files-then-manifest workflow.

Run with:
    uv run cli/qa_upload.py upload --help
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError, ProfileNotFound

RECOGNIZED_FILES = {
    "fps_metrics.csv": "fps_key",
    "memory_metrics.csv": "memory_key",
    "ue.log": "log_key",
    "capture.mp4": "video_key",
}
RESULT_CHOICES = ("PASSED", "FAILED")
ANNOTATION_NAME = "run-summary"


@dataclass(frozen=True)
class UploadFile:
    local_path: Path
    s3_key: str
    summary_field: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Upload QA run artifacts to S3 and annotate the manifest for search.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    upload = subparsers.add_parser(
        "upload",
        help="Upload a QA run directory to s3://<bucket>/runs/<run_id>/",
    )
    upload.add_argument("--bucket", required=True, help="Destination S3 bucket name.")
    upload.add_argument(
        "--run-dir",
        required=True,
        type=Path,
        help="Local directory containing one or more recognized child files.",
    )
    upload.add_argument("--run-id", required=True, help="Run identifier, e.g. run-001.")
    upload.add_argument(
        "--executed-at",
        help="UTC ISO8601 timestamp for the run. Defaults to current UTC time.",
    )
    upload.add_argument("--game-version", required=True, help="Game version label.")
    upload.add_argument("--platform", required=True, help="Target platform, e.g. PS5.")
    upload.add_argument("--test-name", required=True, help="Test name.")
    upload.add_argument(
        "--result",
        required=True,
        choices=RESULT_CHOICES,
        help="Run result.",
    )
    upload.add_argument(
        "--avg-fps",
        required=True,
        type=float,
        help="Average FPS for the test run.",
    )
    upload.add_argument("--profile", help="AWS profile name to use.")
    upload.add_argument(
        "--region",
        default="ap-northeast-1",
        help="AWS region for the S3 client (default: ap-northeast-1).",
    )

    return parser.parse_args()


def utc_now_iso8601() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_executed_at(value: str | None) -> str:
    if not value:
        return utc_now_iso8601()

    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(
            f"Invalid --executed-at value {value!r}. Expected ISO8601 such as 2026-08-01T10:00:00Z."
        ) from exc
    return value


def human_size(num_bytes: int) -> str:
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{num_bytes} B"


def discover_uploads(run_dir: Path, run_id: str) -> list[UploadFile]:
    if not run_dir.exists():
        raise ValueError(f"--run-dir does not exist: {run_dir}")
    if not run_dir.is_dir():
        raise ValueError(f"--run-dir is not a directory: {run_dir}")

    uploads: list[UploadFile] = []
    for filename, summary_field in RECOGNIZED_FILES.items():
        local_path = run_dir / filename
        if local_path.is_file():
            uploads.append(
                UploadFile(
                    local_path=local_path,
                    s3_key=f"runs/{run_id}/{filename}",
                    summary_field=summary_field,
                )
            )

    if not uploads:
        expected = ", ".join(RECOGNIZED_FILES)
        raise ValueError(
            f"No recognized child files found in {run_dir}. Expected at least one of: {expected}."
        )

    return uploads


def build_transfer_config() -> TransferConfig:
    return TransferConfig(
        multipart_threshold=8 * 1024 * 1024,
        multipart_chunksize=8 * 1024 * 1024,
        max_concurrency=4,
        use_threads=True,
    )


def create_s3_client(profile: str | None, region: str):
    session = boto3.Session(profile_name=profile, region_name=region)
    return session.client(
        "s3",
        config=Config(
            retries={
                "max_attempts": 5,
                "mode": "adaptive",
            }
        ),
    )


def upload_child_files(s3_client: Any, bucket: str, uploads: list[UploadFile]) -> dict[str, str | None]:
    summary_keys: dict[str, str | None] = {field: None for field in RECOGNIZED_FILES.values()}
    transfer_config = build_transfer_config()

    for upload in uploads:
        size = upload.local_path.stat().st_size
        print(
            f"Uploading {upload.local_path.name} ({human_size(size)}) "
            f"-> s3://{bucket}/{upload.s3_key}"
        )
        s3_client.upload_file(
            Filename=str(upload.local_path),
            Bucket=bucket,
            Key=upload.s3_key,
            Config=transfer_config,
        )
        summary_keys[upload.summary_field] = upload.s3_key
        print(f"Uploaded {upload.local_path.name} successfully.")

    return summary_keys


def build_manifest(args: argparse.Namespace, summary_keys: dict[str, str | None]) -> dict[str, Any]:
    return {
        "run_id": args.run_id,
        "executed_at": args.executed_at,
        "game_version": args.game_version,
        "platform": args.platform,
        "test_name": args.test_name,
        "result": args.result,
        "avg_fps": args.avg_fps,
        "fps_key": summary_keys["fps_key"],
        "memory_key": summary_keys["memory_key"],
        "log_key": summary_keys["log_key"],
        "video_key": summary_keys["video_key"],
    }


def upload_manifest(s3_client: Any, bucket: str, run_id: str, manifest: dict[str, Any]) -> str:
    manifest_key = f"runs/{run_id}/manifest.json"
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    print(f"Uploading manifest ({human_size(len(manifest_bytes))}) -> s3://{bucket}/{manifest_key}")
    s3_client.put_object(
        Bucket=bucket,
        Key=manifest_key,
        Body=manifest_bytes,
        ContentType="application/json",
    )
    print("Uploaded manifest.json successfully.")
    return manifest_key


def put_run_summary_annotation(
    s3_client: Any,
    bucket: str,
    manifest_key: str,
    manifest: dict[str, Any],
) -> None:
    annotation_payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    print(f"Attaching {ANNOTATION_NAME!r} annotation to s3://{bucket}/{manifest_key}")
    s3_client.put_object_annotation(
        Bucket=bucket,
        Key=manifest_key,
        AnnotationName=ANNOTATION_NAME,
        AnnotationPayload=annotation_payload,
    )
    print(f"Attached {ANNOTATION_NAME!r} annotation successfully.")


def handle_upload(args: argparse.Namespace) -> int:
    try:
        args.executed_at = validate_executed_at(args.executed_at)
        uploads = discover_uploads(args.run_dir.resolve(), args.run_id)
        s3_client = create_s3_client(args.profile, args.region)
        summary_keys = upload_child_files(s3_client, args.bucket, uploads)
        manifest = build_manifest(args, summary_keys)
        manifest_key = upload_manifest(s3_client, args.bucket, args.run_id, manifest)
        put_run_summary_annotation(s3_client, args.bucket, manifest_key, manifest)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except ProfileNotFound as exc:
        print(
            f"Error: AWS profile not found: {exc}. Check --profile or your AWS config.",
            file=sys.stderr,
        )
        return 1
    except NoCredentialsError:
        print(
            "Error: AWS credentials not found. Configure an IAM role or run `aws sso login` "
            "for the profile you pass with --profile.",
            file=sys.stderr,
        )
        return 1
    except ClientError as exc:
        print(
            "Error: AWS S3 request failed. Child files are uploaded before manifest; "
            "if this failed before manifest upload, the run will remain hidden from search.",
            file=sys.stderr,
        )
        print(f"AWS details: {exc}", file=sys.stderr)
        return 1
    except BotoCoreError as exc:
        print(f"Error: AWS SDK failure: {exc}", file=sys.stderr)
        return 1

    print(f"Run {args.run_id} uploaded successfully.")
    return 0


def main() -> int:
    args = parse_args()
    if args.command == "upload":
        return handle_upload(args)

    print(f"Unsupported command: {args.command}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
