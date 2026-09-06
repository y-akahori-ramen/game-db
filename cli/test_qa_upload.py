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
    from boto3.s3.transfer import TransferConfig
except ImportError:
    class DummyTransferConfig:
        def __init__(self, **kwargs):
            self.multipart_threshold = kwargs.get("multipart_threshold", 8 * 1024 * 1024)
            self.multipart_chunksize = kwargs.get("multipart_chunksize", 8 * 1024 * 1024)
            self.max_concurrency = kwargs.get("max_concurrency", 4)
            self.use_threads = kwargs.get("use_threads", True)

    mock_boto3 = MagicMock()
    mock_botocore = MagicMock()
    mock_transfer = MagicMock()
    mock_transfer.TransferConfig = DummyTransferConfig
    sys.modules["boto3"] = mock_boto3
    sys.modules["boto3.s3"] = MagicMock()
    sys.modules["boto3.s3.transfer"] = mock_transfer
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


class TestFileSizeAndTransferConfig(unittest.TestCase):
    def test_validate_file_sizes_under_limit(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "normal.bin"
            p.write_bytes(b"x" * 1024)
            uploads = [
                qa_upload.UploadFile(
                    local_path=p,
                    s3_key="runs/r1/normal.bin",
                    artifact_type="other",
                )
            ]
            # Should not raise
            qa_upload.validate_file_sizes(uploads, max_size_bytes=10 * 1024)

    def test_validate_file_sizes_over_limit(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "huge.mp4"
            p.write_bytes(b"x" * 2000)
            uploads = [
                qa_upload.UploadFile(
                    local_path=p,
                    s3_key="runs/r1/huge.mp4",
                    artifact_type="video",
                )
            ]
            with self.assertRaises(ValueError) as ctx:
                qa_upload.validate_file_sizes(uploads, max_size_bytes=1000)
            self.assertIn("CloudFront single file limit", str(ctx.exception))
            self.assertIn("huge.mp4", str(ctx.exception))

    def test_build_transfer_config_dynamic_chunksize(self):
        # Default with small/no size: 8MB
        cfg_default = qa_upload.build_transfer_config(0)
        self.assertEqual(cfg_default.multipart_chunksize, 8 * 1024 * 1024)

        cfg_small = qa_upload.build_transfer_config(10 * 1024 * 1024)
        self.assertEqual(cfg_small.multipart_chunksize, 8 * 1024 * 1024)

        # Huge file: 180 GB (180 * 1024^3 bytes). 180GB / 9000 ≈ 21.4 MB > 8MB
        huge_bytes = 180 * 1024 * 1024 * 1024
        cfg_huge = qa_upload.build_transfer_config(huge_bytes)
        self.assertGreater(cfg_huge.multipart_chunksize, 8 * 1024 * 1024)
        # Verify it results in <= 9000 parts (< 10,000 S3 limit)
        part_count = (huge_bytes + cfg_huge.multipart_chunksize - 1) // cfg_huge.multipart_chunksize
        self.assertLessEqual(part_count, 9000)


class TestVideoTranscodeHelpers(unittest.TestCase):
    def test_video_detection_helpers(self):
        p_raw = Path("/tmp/video.mp4")
        p_web = Path("/tmp/video_web.mp4")
        p_dot_web = Path("/tmp/capture.web.mp4")
        p_fps = Path("/tmp/fps_metrics.csv")

        self.assertTrue(qa_upload.is_source_video(p_raw))
        self.assertFalse(qa_upload.is_web_video(p_raw))

        self.assertTrue(qa_upload.is_web_video(p_web))
        self.assertFalse(qa_upload.is_source_video(p_web))

        self.assertTrue(qa_upload.is_web_video(p_dot_web))
        self.assertFalse(qa_upload.is_source_video(p_dot_web))

        self.assertFalse(qa_upload.is_source_video(p_fps))
        self.assertFalse(qa_upload.is_web_video(p_fps))

        self.assertEqual(
            qa_upload.default_web_video_path(p_raw),
            Path("/tmp/video_web.mp4"),
        )
        self.assertEqual(
            qa_upload.default_web_video_path(p_web),
            p_web,
        )

    def test_transcode_skips_when_target_exists(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "capture.mp4"
            src.write_bytes(b"raw-video-bytes")
            dst = Path(td) / "capture_web.mp4"
            dst.write_bytes(b"existing-transcoded-bytes")

            # force=False should return dst without calling ffmpeg
            res = qa_upload.transcode_to_web_mp4(src, output_path=dst, force=False)
            self.assertEqual(res, dst)
            self.assertEqual(dst.read_bytes(), b"existing-transcoded-bytes")

    def test_transcode_raises_when_ffmpeg_missing(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "capture.mp4"
            src.write_bytes(b"raw-video-bytes")

            with patch("qa_upload.check_ffmpeg_available", return_value=False):
                with self.assertRaises(RuntimeError) as ctx:
                    qa_upload.transcode_to_web_mp4(src, force=True)
                self.assertIn("ffmpeg was not found", str(ctx.exception))

    def test_transcode_executes_ffmpeg(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "capture.mp4"
            src.write_bytes(b"raw-video-bytes")
            dst = Path(td) / "capture_web.mp4"

            def fake_run(cmd, **kwargs):
                # Fake successful ffmpeg execution: write target file
                dst.write_bytes(b"new-web-video-bytes")
                return MagicMock(returncode=0, stdout="", stderr="")

            with patch("qa_upload.check_ffmpeg_available", return_value=True):
                with patch("subprocess.run", side_effect=fake_run) as mock_sub:
                    res = qa_upload.transcode_to_web_mp4(
                        src, output_path=dst, resolution="1080p", crf=23, preset="fast"
                    )
                    self.assertEqual(res, dst)
                    self.assertTrue(dst.exists())
                    # Check ffmpeg command arguments
                    called_cmd = mock_sub.call_args[0][0]
                    self.assertEqual(called_cmd[0], "ffmpeg")
                    self.assertIn("+faststart", called_cmd)
                    self.assertIn("libx264", called_cmd)
                    self.assertIn("aac", called_cmd)

    def test_ensure_transcoded_videos_skips_when_skip_flag_set(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "video.mp4"
            src.write_bytes(b"mock-video")

            with patch("qa_upload.transcode_to_web_mp4") as mock_tc:
                res = qa_upload.ensure_transcoded_videos(Path(td), skip_transcode=True)
                self.assertEqual(res, [])
                mock_tc.assert_not_called()

    def test_ensure_transcoded_videos_auto_transcodes(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "video.mp4"
            src.write_bytes(b"mock-video")
            expected_web = Path(td) / "video_web.mp4"

            with patch("qa_upload.transcode_to_web_mp4", return_value=expected_web) as mock_tc:
                res = qa_upload.ensure_transcoded_videos(Path(td), skip_transcode=False)
                self.assertEqual(res, [expected_web])
                mock_tc.assert_called_once()

    def test_manifest_sorts_web_video_first(self):
        with tempfile.TemporaryDirectory() as td:
            f_raw = Path(td) / "video.mp4"
            f_web = Path(td) / "video_web.mp4"
            f_fps = Path(td) / "fps_metrics.csv"
            for f in (f_raw, f_web, f_fps):
                f.write_bytes(b"data")

            uploads = [
                qa_upload.UploadFile(local_path=f_raw, s3_key="runs/r/video.mp4", artifact_type="video"),
                qa_upload.UploadFile(local_path=f_fps, s3_key="runs/r/fps_metrics.csv", artifact_type="fps"),
                qa_upload.UploadFile(local_path=f_web, s3_key="runs/r/video_web.mp4", artifact_type="video"),
            ]
            from argparse import Namespace
            args = Namespace(
                run_id="r1",
                executed_at="2026-09-06T12:00:00Z",
                game_version="1.0.0",
                platform="Win64",
                test_name="Test",
                result="PASSED",
                avg_fps=60.0,
            )
            manifest = qa_upload.build_manifest(args, uploads)
            art_files = [a["file_name"] for a in manifest["artifacts"]]
            # fps comes first, then video_web.mp4, then raw video.mp4
            self.assertEqual(art_files, ["fps_metrics.csv", "video_web.mp4", "video.mp4"])


class TestCliParser(unittest.TestCase):
    def test_transcode_subcommand_args(self):
        with patch("sys.argv", ["qa_upload.py", "transcode", "some/path/video.mp4", "--resolution", "720p"]):
            args = qa_upload.parse_args()
            self.assertEqual(args.command, "transcode")
            self.assertEqual(str(args.source), "some/path/video.mp4")
            self.assertEqual(args.resolution, "720p")
            self.assertEqual(args.crf, 23)

    def test_upload_transcode_flags(self):
        with patch("sys.argv", [
            "qa_upload.py",
            "upload",
            "--run-id", "r1",
            "--run-dir", "/tmp",
            "--bucket", "b",
            "--game-version", "1",
            "--platform", "PS5",
            "--test-name", "T",
            "--result", "PASSED",
            "--avg-fps", "60.0",
            "--skip-transcode",
        ]):
            args = qa_upload.parse_args()
            self.assertEqual(args.command, "upload")
            self.assertTrue(args.skip_transcode)
            self.assertFalse(args.force_transcode)


if __name__ == "__main__":
    unittest.main()
