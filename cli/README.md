# QA Upload CLI

Standalone uploader for QA test-run artifacts.

## Prerequisites

- `uv`
- AWS credentials via an IAM role or IAM Identity Center / AWS profile
- S3 bucket name and required IAM permissions from the deployed CDK stack outputs

## Usage

```sh
uv run cli/qa_upload.py upload \
  --bucket qa-data \
  --run-dir ./local_run_folder \
  --run-id run-001 \
  --game-version v1.2.0 \
  --platform PS5 \
  --test-name Level1_Playthrough \
  --result FAILED \
  --avg-fps 54.2 \
  --profile my-aws-profile \
  --region ap-northeast-1
```

## Behavior

- Detects these child files when present in `--run-dir`:
  - `fps_metrics.csv`
  - `memory_metrics.csv`
  - `ue.log`
  - `capture.mp4`
- Requires at least one recognized child file.
- Uploads child files first, then `manifest.json` last.
- Adds the `run-summary` object annotation to `manifest.json` after upload.
- Designed to run directly with `uv run`; dependencies are declared inline in `cli/qa_upload.py`.
