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


if __name__ == "__main__":
    unittest.main()
