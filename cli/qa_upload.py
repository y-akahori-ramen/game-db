# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "boto3>=1.34",
# ]
# ///
"""Upload a QA test run to S3 using the child-files-then-manifest workflow.

Supports Google Account authentication via OAuth 2.0 PKCE and AWS STS
AssumeRoleWithWebIdentity, as well as traditional AWS profile/IAM credentials.
Tokens are saved locally (~/.config/game-qa/token.json) with automatic silent
refresh on subsequent runs.

Run with:
    uv run cli/qa_upload.py upload --help
    uv run cli/qa_upload.py login --help
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    NoCredentialsError,
    ProfileNotFound,
)

RESULT_CHOICES = ("PASSED", "FAILED")

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
DEFAULT_SCOPES = "openid email profile"
DEFAULT_TOKEN_CACHE = Path.home() / ".config" / "game-qa" / "token.json"


@dataclass(frozen=True)
class UploadFile:
    local_path: Path
    s3_key: str
    artifact_type: str


# ==============================================================================
# Google OAuth 2.0 PKCE & Token Cache Helpers
# ==============================================================================


def base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def base64url_decode(value: str) -> bytes:
    padding = (4 - len(value) % 4) % 4
    return base64.urlsafe_b64decode((value + "=" * padding).encode("ascii"))


def decode_jwt_payload(jwt_token: str) -> dict[str, Any]:
    parts = jwt_token.split(".")
    if len(parts) < 2:
        return {}
    try:
        payload_bytes = base64url_decode(parts[1])
        return json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        return {}


def generate_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64url_encode(digest)
    return verifier, challenge


def get_token_cache_path(custom_path: str | None = None) -> Path:
    if custom_path:
        return Path(custom_path).expanduser().resolve()
    env_path = os.environ.get("GAME_QA_TOKEN_CACHE")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return DEFAULT_TOKEN_CACHE.resolve()


def load_cached_token(cache_path: Path) -> dict[str, Any] | None:
    if not cache_path.exists() or not cache_path.is_file():
        return None
    try:
        content = cache_path.read_text(encoding="utf-8")
        data = json.loads(content)
        if isinstance(data, dict) and "id_token" in data:
            return data
    except Exception as exc:
        print(
            f"Warning: Could not read token cache {cache_path}: {exc}", file=sys.stderr
        )
    return None


def save_cached_token(cache_path: Path, token_data: dict[str, Any]) -> None:
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(token_data, indent=2), encoding="utf-8")
        try:
            cache_path.chmod(0o600)
        except OSError:
            pass
    except Exception as exc:
        print(
            f"Warning: Could not save token cache to {cache_path}: {exc}",
            file=sys.stderr,
        )


def clear_cached_token(cache_path: Path) -> bool:
    if cache_path.exists():
        try:
            cache_path.unlink()
            return True
        except Exception as exc:
            print(
                f"Warning: Could not delete token cache {cache_path}: {exc}",
                file=sys.stderr,
            )
            return False
    return False


def is_token_expired(token_data: dict[str, Any], buffer_seconds: int = 120) -> bool:
    expires_at = token_data.get("expires_at")
    if isinstance(expires_at, (int, float)):
        return time.time() >= (expires_at - buffer_seconds)

    payload = decode_jwt_payload(token_data.get("id_token", ""))
    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        return time.time() >= (exp - buffer_seconds)

    return True


def refresh_google_tokens(
    client_id: str,
    client_secret: str | None,
    refresh_token: str,
) -> dict[str, Any]:
    post_fields: dict[str, str] = {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
    }
    if client_secret:
        post_fields["client_secret"] = client_secret

    post_data = urllib.parse.urlencode(post_fields).encode("utf-8")
    req = urllib.request.Request(
        GOOGLE_TOKEN_ENDPOINT,
        data=post_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Google token refresh failed ({err.code}): {body}") from err
    except Exception as err:
        raise RuntimeError(f"Google token refresh failed: {err}") from err

    id_token = data.get("id_token")
    if not id_token:
        raise RuntimeError("Google token refresh did not return an id_token.")

    expires_in = data.get("expires_in", 3600)
    expires_at = int(time.time()) + int(expires_in)
    payload = decode_jwt_payload(id_token)

    return {
        "id_token": id_token,
        "access_token": data.get("access_token", ""),
        "refresh_token": data.get("refresh_token") or refresh_token,
        "expires_at": expires_at,
        "email": payload.get("email"),
        "sub": payload.get("sub"),
    }


class _OAuthCallbackHandler(BaseHTTPRequestHandler):
    code: str | None = None
    state: str | None = None
    error: str | None = None

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/callback":
            params = urllib.parse.parse_qs(parsed.query)
            _OAuthCallbackHandler.code = params.get("code", [None])[0]
            _OAuthCallbackHandler.state = params.get("state", [None])[0]
            _OAuthCallbackHandler.error = params.get("error", [None])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()

            if _OAuthCallbackHandler.error:
                html = (
                    "<!DOCTYPE html><html><body style='font-family:sans-serif;padding:3rem;text-align:center;background:#0f172a;color:#f87171;'>"
                    "<h2>Authentication Failed</h2>"
                    f"<p>Error: {_OAuthCallbackHandler.error}</p>"
                    "<p>You can close this tab and check the terminal output.</p>"
                    "</body></html>"
                )
            else:
                html = (
                    "<!DOCTYPE html><html><body style='font-family:sans-serif;padding:3rem;text-align:center;background:#0f172a;color:#38bdf8;'>"
                    "<h2>Authentication Successful</h2>"
                    "<p>Google account verified successfully. You may close this tab and return to the terminal.</p>"
                    "</body></html>"
                )
            self.wfile.write(html.encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        # Silence local server log messages in standard terminal output
        pass


def login_with_google(
    client_id: str,
    client_secret: str | None = None,
    no_browser: bool = False,
) -> dict[str, Any]:
    code_verifier, code_challenge = generate_pkce_pair()
    expected_state = secrets.token_urlsafe(16)

    # Start loopback server on ephemeral port
    server = HTTPServer(("127.0.0.1", 0), _OAuthCallbackHandler)
    port = server.server_port
    redirect_uri = f"http://127.0.0.1:{port}/callback"

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": DEFAULT_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": expected_state,
    }
    auth_url = f"{GOOGLE_AUTH_ENDPOINT}?{urllib.parse.urlencode(params)}"

    print("=" * 70)
    print("Google Account Authentication")
    print("=" * 70)

    browser_opened = False
    if not no_browser:
        try:
            browser_opened = webbrowser.open(auth_url)
        except Exception:
            browser_opened = False

    if browser_opened:
        print("Opening your default browser to complete Google authentication...")
        print("If the browser did not open automatically, visit this URL:")
        print(auth_url)
    else:
        print("Please open the following URL in your web browser:")
        print(auth_url)
    print("Waiting for callback on local port...")

    # Wait for the callback with a 180s timeout
    server.timeout = 1.0
    start_time = time.time()
    _OAuthCallbackHandler.code = None
    _OAuthCallbackHandler.state = None
    _OAuthCallbackHandler.error = None

    try:
        while time.time() - start_time < 180:
            server.handle_request()
            if _OAuthCallbackHandler.code or _OAuthCallbackHandler.error:
                break
    finally:
        server.server_close()

    if _OAuthCallbackHandler.error:
        raise RuntimeError(f"Google login failed: {_OAuthCallbackHandler.error}")

    auth_code = _OAuthCallbackHandler.code
    returned_state = _OAuthCallbackHandler.state

    if not auth_code:
        raise TimeoutError(
            "Timed out waiting for Google authentication callback (180 seconds)."
        )

    if returned_state != expected_state:
        raise RuntimeError(
            "OAuth state mismatch! Potential CSRF issue or invalid callback."
        )

    # Exchange authorization code for tokens
    exchange_fields: dict[str, str] = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "code": auth_code,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    }
    if client_secret:
        exchange_fields["client_secret"] = client_secret

    post_data = urllib.parse.urlencode(exchange_fields).encode("utf-8")
    req = urllib.request.Request(
        GOOGLE_TOKEN_ENDPOINT,
        data=post_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            token_response = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Token exchange failed ({err.code}): {body}") from err
    except Exception as err:
        raise RuntimeError(f"Token exchange failed: {err}") from err

    id_token = token_response.get("id_token")
    if not id_token:
        raise RuntimeError("Google token exchange did not return an id_token.")

    refresh_token = token_response.get("refresh_token")
    expires_in = token_response.get("expires_in", 3600)
    expires_at = int(time.time()) + int(expires_in)
    payload = decode_jwt_payload(id_token)

    return {
        "id_token": id_token,
        "access_token": token_response.get("access_token", ""),
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "email": payload.get("email"),
        "sub": payload.get("sub"),
    }


def get_valid_google_id_token(
    client_id: str,
    client_secret: str | None,
    cache_path: Path,
    no_browser: bool = False,
    interactive: bool = True,
) -> str:
    cached = load_cached_token(cache_path)
    if cached:
        if not is_token_expired(cached):
            email = cached.get("email", "unknown")
            print(f"Authenticated with cached Google account: {email}")
            return cached["id_token"]

        # Token is expired; attempt silent refresh with refresh_token
        refresh_tok = cached.get("refresh_token")
        if refresh_tok:
            print("Cached Google ID token is expired. Refreshing token silently...")
            try:
                refreshed = refresh_google_tokens(client_id, client_secret, refresh_tok)
                save_cached_token(cache_path, refreshed)
                email = refreshed.get("email", cached.get("email", "unknown"))
                print(f"Successfully refreshed Google ID token for: {email}")
                return refreshed["id_token"]
            except Exception as exc:
                print(f"Silent token refresh failed: {exc}", file=sys.stderr)
                if not interactive:
                    raise

    if not interactive:
        raise RuntimeError(
            "No valid Google credentials found and running in non-interactive mode. "
            "Please run `uv run cli/qa_upload.py login` first."
        )

    print("No valid cached Google credentials found. Initiating Google login...")
    token_data = login_with_google(client_id, client_secret, no_browser=no_browser)
    save_cached_token(cache_path, token_data)
    email = token_data.get("email", "unknown")
    print(f"Successfully logged in as: {email}")
    print(f"Credentials saved to: {cache_path}")
    return token_data["id_token"]


# ==============================================================================
# S3 Client & Upload Workflow
# ==============================================================================


def create_s3_client(args: argparse.Namespace):
    """Create a boto3 S3 client using either Google OAuth + STS AssumeRoleWithWebIdentity,

    or standard AWS IAM credentials / profile.
    """
    role_arn = getattr(args, "role_arn", None) or os.environ.get(
        "GAME_QA_UPLOAD_ROLE_ARN"
    )
    google_client_id = getattr(args, "google_client_id", None) or os.environ.get(
        "GOOGLE_CLIENT_ID"
    )
    google_client_secret = getattr(
        args, "google_client_secret", None
    ) or os.environ.get("GOOGLE_CLIENT_SECRET")
    profile = getattr(args, "profile", None)
    region = getattr(args, "region", "ap-northeast-1")
    token_cache = get_token_cache_path(getattr(args, "token_cache", None))
    no_browser = getattr(args, "no_browser", False)
    endpoint_url = (
        getattr(args, "endpoint_url", None)
        or os.environ.get("AWS_ENDPOINT_URL")
        or os.environ.get("S3_ENDPOINT_URL")
    )
    mock_auth = getattr(args, "mock_auth", False) is True

    # If mock_auth is explicitly requested (e.g. for LocalStack, MinIO, or pipeline test),
    # bypass Google OAuth and STS AssumeRole
    if mock_auth:
        print("Using local mock authentication (bypassing Google OAuth and AWS STS).")
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region,
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "mock-access-key"),
            aws_secret_access_key=os.environ.get(
                "AWS_SECRET_ACCESS_KEY", "mock-secret-key"
            ),
            config=Config(
                retries={
                    "max_attempts": 3,
                    "mode": "standard",
                }
            ),
        )

    # If role_arn is supplied (or Google client ID is set and no AWS profile is specified),
    # use Google OIDC authentication + STS AssumeRoleWithWebIdentity
    if role_arn:
        if not google_client_id:
            raise ValueError(
                "--role-arn requires --google-client-id (or GOOGLE_CLIENT_ID env var) "
                "to authenticate via Google account."
            )

        id_token = get_valid_google_id_token(
            client_id=google_client_id,
            client_secret=google_client_secret,
            cache_path=token_cache,
            no_browser=no_browser,
            interactive=True,
        )

        print(f"Assuming IAM role via STS AssumeRoleWithWebIdentity -> {role_arn} ...")
        sts_client = boto3.client("sts", region_name=region)
        run_id_safe = "".join(
            c for c in getattr(args, "run_id", "session") if c.isalnum() or c in "-_"
        )[:20]
        session_name = f"game-qa-{run_id_safe or 'upload'}"

        assumed = sts_client.assume_role_with_web_identity(
            RoleArn=role_arn,
            RoleSessionName=session_name,
            WebIdentityToken=id_token,
            DurationSeconds=3600,
        )
        creds = assumed["Credentials"]

        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region,
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            config=Config(
                retries={
                    "max_attempts": 5,
                    "mode": "adaptive",
                }
            ),
        )

    # Fallback to standard AWS session / profile / ambient credentials
    session = boto3.Session(profile_name=profile, region_name=region)
    return session.client(
        "s3",
        endpoint_url=endpoint_url,
        config=Config(
            retries={
                "max_attempts": 5,
                "mode": "adaptive",
            }
        ),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Upload QA run artifacts to S3 with Google Account authentication or AWS credentials.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # 1. upload command
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
    upload.add_argument(
        "--role-arn",
        help="IAM Role ARN to assume via Google Web Identity (env: GAME_QA_UPLOAD_ROLE_ARN).",
    )
    upload.add_argument(
        "--google-client-id",
        help="Google OAuth 2.0 Client ID for desktop application (env: GOOGLE_CLIENT_ID).",
    )
    upload.add_argument(
        "--google-client-secret",
        help="Google OAuth 2.0 Client Secret (optional for desktop apps, env: GOOGLE_CLIENT_SECRET).",
    )
    upload.add_argument(
        "--token-cache",
        help="Path to token cache file (default: ~/.config/game-qa/token.json).",
    )
    upload.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not attempt to open a browser automatically; display login URL in terminal.",
    )
    upload.add_argument(
        "--profile", help="AWS profile name to use (legacy/IAM fallback)."
    )
    upload.add_argument(
        "--endpoint-url",
        help="S3 endpoint URL for local testing with LocalStack or MinIO (env: AWS_ENDPOINT_URL).",
    )
    upload.add_argument(
        "--mock-auth",
        action="store_true",
        help="Bypass Google OAuth and AWS STS, using dummy credentials (useful for local pipeline testing).",
    )
    upload.add_argument(
        "--region",
        default="ap-northeast-1",
        help="AWS region for S3/STS (default: ap-northeast-1).",
    )

    # 2. login command
    login = subparsers.add_parser(
        "login",
        help="Perform interactive Google Account login and save credentials.",
    )
    login.add_argument(
        "--google-client-id",
        required=not bool(os.environ.get("GOOGLE_CLIENT_ID")),
        default=os.environ.get("GOOGLE_CLIENT_ID"),
        help="Google OAuth 2.0 Client ID (env: GOOGLE_CLIENT_ID).",
    )
    login.add_argument(
        "--google-client-secret",
        default=os.environ.get("GOOGLE_CLIENT_SECRET"),
        help="Google OAuth 2.0 Client Secret (env: GOOGLE_CLIENT_SECRET).",
    )
    login.add_argument(
        "--token-cache",
        help="Path to token cache file (default: ~/.config/game-qa/token.json).",
    )
    login.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open a browser automatically; display login URL in terminal.",
    )

    # 3. logout command
    logout = subparsers.add_parser(
        "logout",
        help="Remove cached Google Account credentials.",
    )
    logout.add_argument(
        "--token-cache",
        help="Path to token cache file (default: ~/.config/game-qa/token.json).",
    )

    # 4. whoami command
    whoami = subparsers.add_parser(
        "whoami",
        help="Show currently authenticated Google Account info.",
    )
    whoami.add_argument(
        "--token-cache",
        help="Path to token cache file (default: ~/.config/game-qa/token.json).",
    )

    return parser.parse_args()


def utc_now_iso8601() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


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


def detect_artifact_type(file_path: Path) -> str:
    name = file_path.name.lower()
    ext = file_path.suffix.lower()

    if name == "fps_metrics.csv" or ("fps" in name and ext in (".csv", ".json")):
        return "fps"
    if name == "memory_metrics.csv" or (
        ("memory" in name or "llm" in name) and ext in (".csv", ".json")
    ):
        return "memory"
    if name == "ue.log" or ext in (".log", ".txt"):
        return "log"
    if name in ("capture.mp4", "video.mp4") or ext in (".mp4", ".webm", ".mov", ".avi"):
        return "video"
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        return "screenshot"
    if ext in (".dmp", ".mdmp"):
        return "crashdump"
    if ext in (".utrace", ".trace"):
        return "trace"
    if ext in (".html", ".xml"):
        return "report"
    return "other"


def discover_uploads(run_dir: Path, run_id: str) -> list[UploadFile]:
    if not run_dir.exists():
        raise ValueError(f"--run-dir does not exist: {run_dir}")
    if not run_dir.is_dir():
        raise ValueError(f"--run-dir is not a directory: {run_dir}")

    uploads: list[UploadFile] = []
    for entry in sorted(run_dir.rglob("*")):
        if not entry.is_file():
            continue
        if entry.name == "manifest.json" or entry.name.startswith("."):
            continue

        rel_path = entry.relative_to(run_dir).as_posix()
        s3_key = f"runs/{run_id}/{rel_path}"
        artifact_type = detect_artifact_type(entry)
        uploads.append(
            UploadFile(
                local_path=entry,
                s3_key=s3_key,
                artifact_type=artifact_type,
            )
        )

    if not uploads:
        raise ValueError(f"No child files found in {run_dir} to upload.")

    return uploads


def build_transfer_config() -> TransferConfig:
    return TransferConfig(
        multipart_threshold=8 * 1024 * 1024,
        multipart_chunksize=8 * 1024 * 1024,
        max_concurrency=4,
        use_threads=True,
    )


def upload_child_files(
    s3_client: Any, bucket: str, uploads: list[UploadFile]
) -> None:
    transfer_config = build_transfer_config()

    for upload in uploads:
        size = upload.local_path.stat().st_size
        print(
            f"Uploading {upload.local_path.name} [{upload.artifact_type}] ({human_size(size)}) "
            f"-> s3://{bucket}/{upload.s3_key}"
        )
        s3_client.upload_file(
            Filename=str(upload.local_path),
            Bucket=bucket,
            Key=upload.s3_key,
            Config=transfer_config,
        )
        print(f"Uploaded {upload.local_path.name} successfully.")


def build_manifest(
    args: argparse.Namespace, uploads: list[UploadFile]
) -> dict[str, Any]:
    artifacts = [
        {
            "file_name": u.local_path.name,
            "s3_key": u.s3_key,
            "type": u.artifact_type,
            "size_bytes": u.local_path.stat().st_size,
        }
        for u in uploads
    ]
    return {
        "schema_version": "2.0",
        "run_id": args.run_id,
        "executed_at": args.executed_at,
        "game_version": args.game_version,
        "platform": args.platform,
        "test_name": args.test_name,
        "result": args.result,
        "avg_fps": args.avg_fps,
        "artifacts": artifacts,
    }


def upload_manifest(
    s3_client: Any, bucket: str, run_id: str, manifest: dict[str, Any]
) -> str:
    manifest_key = f"runs/{run_id}/manifest.json"
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    print(
        f"Uploading manifest ({human_size(len(manifest_bytes))}) -> s3://{bucket}/{manifest_key}"
    )
    s3_client.put_object(
        Bucket=bucket,
        Key=manifest_key,
        Body=manifest_bytes,
        ContentType="application/json",
    )
    print("Uploaded manifest.json successfully.")
    return manifest_key


def handle_upload(args: argparse.Namespace) -> int:
    try:
        args.executed_at = validate_executed_at(args.executed_at)
        uploads = discover_uploads(args.run_dir.resolve(), args.run_id)
        s3_client = create_s3_client(args)
        upload_child_files(s3_client, args.bucket, uploads)
        manifest = build_manifest(args, uploads)
        upload_manifest(s3_client, args.bucket, args.run_id, manifest)
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
            "Error: AWS credentials not found. Configure an IAM role, run `aws sso login`, "
            "or use --role-arn with Google Account authentication.",
            file=sys.stderr,
        )
        return 1
    except ClientError as exc:
        print(
            "Error: AWS request failed. Child files are uploaded before manifest; "
            "if this failed before manifest upload, the run will remain hidden from search.",
            file=sys.stderr,
        )
        print(f"AWS details: {exc}", file=sys.stderr)
        return 1
    except BotoCoreError as exc:
        print(f"Error: AWS SDK failure: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Run {args.run_id} uploaded successfully.")
    return 0


def handle_login(args: argparse.Namespace) -> int:
    client_id = args.google_client_id or os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        print(
            "Error: --google-client-id or GOOGLE_CLIENT_ID environment variable is required.",
            file=sys.stderr,
        )
        return 1

    client_secret = args.google_client_secret or os.environ.get("GOOGLE_CLIENT_SECRET")
    cache_path = get_token_cache_path(args.token_cache)

    try:
        token_data = login_with_google(
            client_id=client_id,
            client_secret=client_secret,
            no_browser=args.no_browser,
        )
        save_cached_token(cache_path, token_data)
        email = token_data.get("email", "unknown")
        print(f"Successfully logged in to Google account: {email}")
        print(f"Credentials saved to: {cache_path}")
        return 0
    except Exception as exc:
        print(f"Login failed: {exc}", file=sys.stderr)
        return 1


def handle_logout(args: argparse.Namespace) -> int:
    cache_path = get_token_cache_path(args.token_cache)
    if clear_cached_token(cache_path):
        print(f"Logged out. Removed cached credentials from {cache_path}.")
    else:
        print(f"No active session found at {cache_path}.")
    return 0


def handle_whoami(args: argparse.Namespace) -> int:
    cache_path = get_token_cache_path(args.token_cache)
    cached = load_cached_token(cache_path)
    if not cached:
        print("Not logged in (no cached credentials found).")
        return 1

    email = cached.get("email", "unknown")
    sub = cached.get("sub", "unknown")
    expired = is_token_expired(cached, buffer_seconds=0)
    expires_at = cached.get("expires_at")
    has_refresh = bool(cached.get("refresh_token"))

    print(f"Google Account: {email} (sub: {sub})")
    print(f"Token cache:    {cache_path}")
    if expires_at:
        exp_dt = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()
        print(f"Expires at:     {exp_dt} ({'EXPIRED' if expired else 'VALID'})")
    print(
        f"Refresh token:  {'Present (auto-refresh enabled)' if has_refresh else 'None'}"
    )
    return 0


def main() -> int:
    args = parse_args()
    if args.command == "upload":
        return handle_upload(args)
    if args.command == "login":
        return handle_login(args)
    if args.command == "logout":
        return handle_logout(args)
    if args.command == "whoami":
        return handle_whoami(args)

    print(f"Unsupported command: {args.command}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
