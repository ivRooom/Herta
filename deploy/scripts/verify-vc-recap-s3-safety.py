#!/usr/bin/env python3
"""Fail-closed, read-only production S3 guard for the dedicated VC Recap bucket.

No Put/Delete/Abort APIs, credentials, object keys or user identifiers are used.
Exit nonzero on drift or missing permissions; never enable retention/erasure.
"""

import argparse
import json
import re
import subprocess
import sys
from typing import Callable

S3Read = Callable[[str, str, dict], dict]


class SafetyError(Exception):
    """A requirement could not be verified; fail closed."""


def cli_read(service: str, operation: str, params: dict) -> dict:
    args = ["aws", service, operation, "--output", "json"]
    for key, value in params.items():
        args.extend([f"--{key}", str(value)])
    try:
        completed = subprocess.run(
            args, capture_output=True, text=True, timeout=20, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SafetyError("AWS read failed; CLI unavailable or timed out") from exc
    if completed.returncode != 0:
        # Do not expose shell output (could contain account identifiers or tokens).
        raise SafetyError("AWS read failed or is not authorized")
    try:
        result = json.loads(completed.stdout)
    except (ValueError, TypeError) as exc:
        raise SafetyError("AWS returned invalid JSON") from exc
    if not isinstance(result, dict):
        raise SafetyError("AWS returned an invalid response object")
    return result


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise SafetyError(reason)


def _includes(value: object, item: str) -> bool:
    return value == item or (isinstance(value, list) and item in value)


def verify_bucket(
    read: S3Read, bucket: str, account_id: str, region: str
) -> tuple[str, ...]:
    """Require exact dedicated name and independent account identity."""
    require(bool(re.fullmatch(r"\d{12}", account_id)), "Invalid AWS account ID")
    require(
        bool(re.fullmatch(r"[a-z]{2}-[a-z]+-\d", region)),
        "Invalid AWS region",
    )
    require(
        bucket == f"herta-vc-recap-private-{account_id}-{region}",
        "Bucket must be the dedicated VC Recap bucket, never a backup bucket",
    )

    identity = read("sts", "get-caller-identity", {})
    require(identity.get("Account") == account_id, "AWS account mismatch")
    params = {"bucket": bucket, "region": region}

    location = read("s3api", "get-bucket-location", params).get("LocationConstraint")
    require(location == region, "Bucket region mismatch")

    versioning = read("s3api", "get-bucket-versioning", params)
    require(versioning.get("Status") == "Enabled", "Bucket versioning is not enabled")

    access = read("s3api", "get-public-access-block", params).get(
        "PublicAccessBlockConfiguration"
    )
    require(isinstance(access, dict), "Public access block not configured")
    for name in (
        "BlockPublicAcls",
        "IgnorePublicAcls",
        "BlockPublicPolicy",
        "RestrictPublicBuckets",
    ):
        require(access.get(name) is True, f"Public access block disabled: {name}")

    encryption = read("s3api", "get-bucket-encryption", params).get(
        "ServerSideEncryptionConfiguration"
    )
    require(isinstance(encryption, dict), "Bucket encryption not configured")
    rules = encryption.get("Rules")
    require(isinstance(rules, list) and len(rules) > 0, "Missing encryption rules")
    require(
        all(
            rule.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm")
            == "AES256"
            for rule in rules
        ),
        "Unexpected bucket encryption algorithm",
    )

    ownership = read("s3api", "get-bucket-ownership-controls", params).get(
        "OwnershipControls"
    )
    require(isinstance(ownership, dict), "Bucket ownership controls not configured")
    own_rules = ownership.get("Rules")
    require(
        isinstance(own_rules, list)
        and len(own_rules) > 0
        and all(item.get("ObjectOwnership") == "BucketOwnerEnforced" for item in own_rules),
        "Bucket ownership is not enforced",
    )

    raw_policy = read("s3api", "get-bucket-policy", params).get("Policy")
    try:
        policy = json.loads(raw_policy) if isinstance(raw_policy, str) else raw_policy
    except ValueError as exc:
        raise SafetyError("Bucket policy is invalid JSON") from exc
    require(isinstance(policy, dict), "Bucket policy missing")
    statements = policy.get("Statement", [])
    require(isinstance(statements, list), "Bucket policy is malformed")
    arn = f"arn:aws:s3:::{bucket}"
    tls_deny = any(
        item.get("Effect") == "Deny"
        and item.get("Principal") == "*"
        and _includes(item.get("Action"), "s3:*")
        and _includes(item.get("Resource"), arn)
        and _includes(item.get("Resource"), arn + "/*")
        and item.get("Condition", {}).get("Bool", {}).get("aws:SecureTransport")
        in ("false", False)
        for item in statements
        if isinstance(item, dict)
    )
    require(tls_deny, "Missing HTTPS-only deny for bucket and objects")
    return (
        "account",
        "bucket-name",
        "region",
        "versioning",
        "public-access",
        "encryption",
        "ownership",
        "https-only",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only VC Recap S3 safety audit")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--region", default="ap-northeast-1")
    args = parser.parse_args()
    try:
        passed = verify_bucket(cli_read, args.bucket, args.account_id, args.region)
    except SafetyError as exc:
        print(f"VC Recap S3 audit: FAILED — {exc}", file=sys.stderr)
        return 1
    print("VC Recap S3 audit: OK (" + ", ".join(passed) + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main())
