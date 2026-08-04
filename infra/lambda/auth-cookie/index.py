"""Signed-cookie Lambda for GET /api/auth/cookie.

Environment variables:
- SIGNING_KEY_SECRET_ARN (required): Secrets Manager secret ARN/name containing JSON with
  privateKeyPem and publicKeyPem fields.
- CLOUDFRONT_KEY_PAIR_ID (required): CloudFront public key ID / key-pair ID.
- CLOUDFRONT_DOMAIN (required): distribution domain name, e.g. d123456abcdef8.cloudfront.net.
- COOKIE_TTL_SECONDS (optional, default: 43200 / 12 hours)

Deployment note:
- This handler imports ``cryptography`` for RSA-SHA1 signing because Python's stdlib does not
  include RSA signing primitives and AWS Lambda Python runtimes do not bundle cryptography by
  default. The CDK wiring step must therefore either use a Python bundling construct that installs
  infra/lambda/auth-cookie/requirements.txt (for example PythonFunction/Docker bundling) or attach
  a compatible Lambda Layer containing cryptography built for the target runtime.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

import boto3

VENDOR_DIR = Path(__file__).with_name("vendor")
if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

SECRETS_MANAGER = boto3.client("secretsmanager")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    del context
    try:
        claims = (
            event.get("requestContext", {})
            .get("authorizer", {})
            .get("claims", {})
        )
        LOGGER.info(
            "Issuing CloudFront signed cookie for sub=%s email=%s",
            claims.get("sub"),
            claims.get("email"),
        )

        ttl_seconds = int(os.environ.get("COOKIE_TTL_SECONDS", "43200"))
        expires_at = int(time.time()) + ttl_seconds
        domain = _required_env("CLOUDFRONT_DOMAIN")
        key_pair_id = _required_env("CLOUDFRONT_KEY_PAIR_ID")
        private_key_pem = _load_private_key_pem(_required_env("SIGNING_KEY_SECRET_ARN"))

        policy = _build_policy(domain, expires_at)
        signature = _sign_policy(policy, private_key_pem)
        encoded_policy = _cloudfront_base64(policy.encode("utf-8"))

        cookies = [
            _build_cookie("CloudFront-Policy", encoded_policy, ttl_seconds),
            _build_cookie("CloudFront-Signature", signature, ttl_seconds),
            _build_cookie("CloudFront-Key-Pair-Id", key_pair_id, ttl_seconds),
        ]

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
            },
            "multiValueHeaders": {
                "Set-Cookie": cookies,
            },
            "body": json.dumps({"ok": True}),
        }
    except Exception:
        LOGGER.exception("auth-cookie Lambda failed")
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
            },
            "body": json.dumps({"message": "Internal server error"}),
        }


def _load_private_key_pem(secret_id: str) -> str:
    response = SECRETS_MANAGER.get_secret_value(SecretId=secret_id)
    secret_string = response.get("SecretString")
    if not secret_string:
        raise RuntimeError(f"Secret {secret_id} does not contain SecretString.")

    payload = json.loads(secret_string)
    private_key_pem = payload.get("privateKeyPem")
    if not isinstance(private_key_pem, str) or not private_key_pem:
        raise RuntimeError(f"Secret {secret_id} does not contain privateKeyPem.")
    return private_key_pem


def _build_policy(domain: str, expires_at: int) -> str:
    return json.dumps(
        {
            "Statement": [
                {
                    "Resource": f"https://{domain}/data/*",
                    "Condition": {
                        "DateLessThan": {
                            "AWS:EpochTime": expires_at,
                        },
                    },
                },
            ],
        },
        separators=(",", ":"),
    )


def _sign_policy(policy: str, private_key_pem: str) -> str:
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
    )
    signature = private_key.sign(
        policy.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA1(),
    )
    return _cloudfront_base64(signature)


def _cloudfront_base64(raw_bytes: bytes) -> str:
    return (
        base64.b64encode(raw_bytes)
        .decode("utf-8")
        .replace("+", "-")
        .replace("=", "_")
        .replace("/", "~")
    )


def _build_cookie(name: str, value: str, max_age: int) -> str:
    return (
        f"{name}={value}; Path=/data; Max-Age={max_age}; "
        "Secure; HttpOnly; SameSite=Lax"
    )


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value
