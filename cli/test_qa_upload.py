"""Unit tests for cli/qa_upload.py Google OAuth and token cache features."""

import base64
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure cli directory is in sys.path
sys_path = Path(__file__).parent
import sys

if str(sys_path) not in sys.path:
    sys.path.insert(0, str(sys_path))

try:
    import boto3
except ImportError:
    mock_boto3 = MagicMock()
    mock_botocore = MagicMock()
    sys.modules["boto3"] = mock_boto3
    sys.modules["boto3.s3"] = MagicMock()
    sys.modules["boto3.s3.transfer"] = MagicMock()
    sys.modules["botocore"] = mock_botocore
    sys.modules["botocore.config"] = MagicMock()
    sys.modules["botocore.exceptions"] = MagicMock()
    import boto3

import qa_upload


class TestGoogleAuthUtils(unittest.TestCase):
    def test_pkce_generation(self):
        verifier, challenge = qa_upload.generate_pkce_pair()
        self.assertTrue(len(verifier) >= 43)
        self.assertTrue(len(challenge) >= 43)
        # Verify challenge is indeed base64url(sha256(verifier))
        import hashlib

        expected = qa_upload.base64url_encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        )
        self.assertEqual(challenge, expected)

    def test_jwt_payload_decode(self):
        header = qa_upload.base64url_encode(
            json.dumps({"alg": "RS256"}).encode("utf-8")
        )
        payload_data = {
            "sub": "1234567890",
            "email": "test@example.com",
            "exp": 1999999999,
        }
        payload = qa_upload.base64url_encode(json.dumps(payload_data).encode("utf-8"))
        token = f"{header}.{payload}.signature123"

        decoded = qa_upload.decode_jwt_payload(token)
        self.assertEqual(decoded.get("email"), "test@example.com")
        self.assertEqual(decoded.get("sub"), "1234567890")
        self.assertEqual(decoded.get("exp"), 1999999999)

    def test_token_cache_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_file = Path(tmpdir) / "subdir" / "token.json"
            self.assertIsNone(qa_upload.load_cached_token(cache_file))

            token_data = {
                "id_token": "mock.jwt.token",
                "refresh_token": "mock-refresh",
                "access_token": "mock-access",
                "expires_at": time.time() + 3600,
                "email": "tester@example.com",
            }
            qa_upload.save_cached_token(cache_file, token_data)
            self.assertTrue(cache_file.exists())

            # Check file permissions on POSIX
            if os.name == "posix":
                mode = cache_file.stat().st_mode & 0o777
                self.assertEqual(mode, 0o600)

            loaded = qa_upload.load_cached_token(cache_file)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["email"], "tester@example.com")
            self.assertFalse(qa_upload.is_token_expired(loaded))

            # Test expiration
            loaded["expires_at"] = time.time() - 10
            self.assertTrue(qa_upload.is_token_expired(loaded))

            # Test clear
            self.assertTrue(qa_upload.clear_cached_token(cache_file))
            self.assertFalse(cache_file.exists())

    @patch("urllib.request.urlopen")
    def test_refresh_google_tokens(self, mock_urlopen):
        new_payload = {
            "sub": "user123",
            "email": "refreshed@example.com",
            "exp": int(time.time()) + 3600,
        }
        new_id_token = (
            f"h.{qa_upload.base64url_encode(json.dumps(new_payload).encode())}.sig"
        )
        mock_response_body = json.dumps(
            {
                "id_token": new_id_token,
                "access_token": "new-access-token",
                "expires_in": 3600,
            }
        ).encode("utf-8")

        mock_resp = MagicMock()
        mock_resp.read.return_value = mock_response_body
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        result = qa_upload.refresh_google_tokens(
            client_id="test-client-id",
            client_secret="test-secret",
            refresh_token="my-refresh-token",
        )

        self.assertEqual(result["id_token"], new_id_token)
        self.assertEqual(result["access_token"], "new-access-token")
        self.assertEqual(result["refresh_token"], "my-refresh-token")
        self.assertEqual(result["email"], "refreshed@example.com")
        self.assertGreater(result["expires_at"], time.time())

    @patch("boto3.client")
    def test_create_s3_client_with_role_arn(self, mock_boto3_client):
        mock_sts = MagicMock()
        mock_sts.assume_role_with_web_identity.return_value = {
            "Credentials": {
                "AccessKeyId": "ASIA_TEST_KEY",
                "SecretAccessKey": "TEST_SECRET",
                "SessionToken": "TEST_SESSION_TOKEN",
            }
        }
        mock_s3 = MagicMock()

        def client_factory(service_name, **kwargs):
            if service_name == "sts":
                return mock_sts
            if service_name == "s3":
                self.assertEqual(kwargs.get("aws_access_key_id"), "ASIA_TEST_KEY")
                self.assertEqual(kwargs.get("aws_secret_access_key"), "TEST_SECRET")
                self.assertEqual(kwargs.get("aws_session_token"), "TEST_SESSION_TOKEN")
                return mock_s3
            return MagicMock()

        mock_boto3_client.side_effect = client_factory

        with tempfile.TemporaryDirectory() as tmpdir:
            cache_file = Path(tmpdir) / "token.json"
            qa_upload.save_cached_token(
                cache_file,
                {
                    "id_token": "valid.id.token",
                    "refresh_token": "ref",
                    "expires_at": time.time() + 3600,
                    "email": "user@example.com",
                },
            )

            args = MagicMock()
            args.role_arn = "arn:aws:iam::123456789012:role/GameQaUploadRole"
            args.google_client_id = "mock-client-id.apps.googleusercontent.com"
            args.google_client_secret = None
            args.token_cache = str(cache_file)
            args.no_browser = False
            args.profile = None
            args.region = "ap-northeast-1"
            args.run_id = "run-001"

            s3_client = qa_upload.create_s3_client(args)
            self.assertEqual(s3_client, mock_s3)
            mock_sts.assume_role_with_web_identity.assert_called_once()
            call_kwargs = mock_sts.assume_role_with_web_identity.call_args[1]
            self.assertEqual(
                call_kwargs["RoleArn"],
                "arn:aws:iam::123456789012:role/GameQaUploadRole",
            )
            self.assertEqual(call_kwargs["WebIdentityToken"], "valid.id.token")

    @patch("boto3.client")
    def test_create_s3_client_mock_auth(self, mock_boto3_client):
        mock_s3 = MagicMock()
        mock_boto3_client.return_value = mock_s3

        args = MagicMock()
        args.role_arn = None
        args.google_client_id = None
        args.profile = None
        args.region = "ap-northeast-1"
        args.endpoint_url = "http://localhost:4566"
        args.mock_auth = True

        s3_client = qa_upload.create_s3_client(args)
        self.assertEqual(s3_client, mock_s3)
        mock_boto3_client.assert_called_once()
        _, kwargs = mock_boto3_client.call_args
        self.assertEqual(kwargs.get("endpoint_url"), "http://localhost:4566")
        self.assertEqual(kwargs.get("aws_access_key_id"), "mock-access-key")


class TestArtifactDetection(unittest.TestCase):
    def test_detect_artifact_type(self):
        cases = [
            ("fps_metrics.csv", "fps"),
            ("custom_fps.json", "fps"),
            ("memory_metrics.csv", "memory"),
            ("llm_memory.json", "memory"),
            ("ue.log", "log"),
            ("custom_engine.log", "log"),
            ("notes.txt", "log"),
            ("capture.mp4", "video"),
            ("gameplay.webm", "video"),
            ("screen.png", "screenshot"),
            ("capture.jpg", "screenshot"),
            ("crash.dmp", "crashdump"),
            ("minidump.mdmp", "crashdump"),
            ("profile.utrace", "trace"),
            ("perf.trace", "trace"),
            ("test_report.html", "report"),
            ("summary.xml", "report"),
            ("unrecognized.bin", "other"),
        ]
        for filename, expected_type in cases:
            with self.subTest(filename=filename):
                self.assertEqual(
                    qa_upload.detect_artifact_type(Path(filename)),
                    expected_type,
                )


class TestDiscoverUploads(unittest.TestCase):
    def test_discover_arbitrary_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            run_dir = Path(tmpdir)
            (run_dir / "sub").mkdir()
            (run_dir / "crash.dmp").write_bytes(b"\x00" * 16)
            (run_dir / "screenshot.png").write_bytes(b"\x89PNG")
            (run_dir / "sub" / "custom.utrace").write_bytes(b"trace-bytes")
            (run_dir / "manifest.json").write_text("{}", encoding="utf-8")  # should be excluded
            (run_dir / ".hidden_file").write_text("secret", encoding="utf-8")  # should be excluded

            uploads = qa_upload.discover_uploads(run_dir, "run-test-01")
            self.assertEqual(len(uploads), 3)

            by_name = {u.local_path.name: u for u in uploads}
            self.assertIn("crash.dmp", by_name)
            self.assertEqual(by_name["crash.dmp"].artifact_type, "crashdump")
            self.assertEqual(by_name["crash.dmp"].s3_key, "runs/run-test-01/crash.dmp")

            self.assertIn("screenshot.png", by_name)
            self.assertEqual(by_name["screenshot.png"].artifact_type, "screenshot")
            self.assertEqual(by_name["screenshot.png"].s3_key, "runs/run-test-01/screenshot.png")

            self.assertIn("custom.utrace", by_name)
            self.assertEqual(by_name["custom.utrace"].artifact_type, "trace")
            self.assertEqual(by_name["custom.utrace"].s3_key, "runs/run-test-01/sub/custom.utrace")

    def test_discover_empty_directory_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            run_dir = Path(tmpdir)
            with self.assertRaises(ValueError) as ctx:
                qa_upload.discover_uploads(run_dir, "run-empty")
            self.assertIn("No child files found", str(ctx.exception))


class TestBuildManifest(unittest.TestCase):
    def test_build_manifest_v2(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            f1 = Path(tmpdir) / "fps_metrics.csv"
            f1.write_text("frame,fps\n1,60.0\n", encoding="utf-8")
            f2 = Path(tmpdir) / "crash.dmp"
            f2.write_bytes(b"mock-crash-dump")

            uploads = [
                qa_upload.UploadFile(
                    local_path=f1,
                    s3_key="runs/run-100/fps_metrics.csv",
                    artifact_type="fps",
                ),
                qa_upload.UploadFile(
                    local_path=f2,
                    s3_key="runs/run-100/crash.dmp",
                    artifact_type="crashdump",
                ),
            ]

            from argparse import Namespace

            args = Namespace(
                run_id="run-100",
                executed_at="2026-09-06T12:00:00Z",
                game_version="1.2.3",
                platform="PS5",
                test_name="PerformanceBenchmark",
                result="PASSED",
                avg_fps=59.8,
            )

            manifest = qa_upload.build_manifest(args, uploads)
            self.assertEqual(manifest["schema_version"], "2.0")
            self.assertEqual(manifest["run_id"], "run-100")
            self.assertEqual(manifest["executed_at"], "2026-09-06T12:00:00Z")
            self.assertEqual(manifest["game_version"], "1.2.3")
            self.assertEqual(manifest["platform"], "PS5")
            self.assertEqual(manifest["test_name"], "PerformanceBenchmark")
            self.assertEqual(manifest["result"], "PASSED")
            self.assertEqual(manifest["avg_fps"], 59.8)

            artifacts = manifest["artifacts"]
            self.assertEqual(len(artifacts), 2)
            self.assertEqual(artifacts[0]["file_name"], "fps_metrics.csv")
            self.assertEqual(artifacts[0]["type"], "fps")
            self.assertEqual(artifacts[0]["s3_key"], "runs/run-100/fps_metrics.csv")
            self.assertGreater(artifacts[0]["size_bytes"], 0)

            self.assertEqual(artifacts[1]["file_name"], "crash.dmp")
            self.assertEqual(artifacts[1]["type"], "crashdump")
            self.assertEqual(artifacts[1]["s3_key"], "runs/run-100/crash.dmp")
            self.assertEqual(artifacts[1]["size_bytes"], len(b"mock-crash-dump"))


if __name__ == "__main__":
    unittest.main()
