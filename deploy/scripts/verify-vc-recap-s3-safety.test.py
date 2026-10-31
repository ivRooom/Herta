#!/usr/bin/env python3
"""Offline contract tests; no AWS credentials or network access are required."""

import importlib.util
import json
import pathlib
import unittest
from copy import deepcopy
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).with_name("verify-vc-recap-s3-safety.py")
spec = importlib.util.spec_from_file_location("vc_recap_s3_safety", SCRIPT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

ACCOUNT = "911291529944"
REGION = "ap-northeast-1"
BUCKET = f"herta-vc-recap-private-{ACCOUNT}-{REGION}"
ARN = f"arn:aws:s3:::{BUCKET}"


def fixture():
    return {
        ("sts", "get-caller-identity"): {"Account": ACCOUNT},
        ("s3api", "get-bucket-location"): {"LocationConstraint": REGION},
        ("s3api", "get-bucket-versioning"): {"Status": "Enabled"},
        ("s3api", "get-public-access-block"): {
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            }
        },
        ("s3api", "get-bucket-encryption"): {
            "ServerSideEncryptionConfiguration": {
                "Rules": [
                    {
                        "ApplyServerSideEncryptionByDefault": {
                            "SSEAlgorithm": "AES256"
                        }
                    }
                ]
            }
        },
        ("s3api", "get-bucket-ownership-controls"): {
            "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]}
        },
        ("s3api", "get-bucket-policy"): {
            "Policy": json.dumps({
                "Statement": [
                    {
                        "Sid": "DenyInsecureTransport",
                        "Effect": "Deny",
                        "Principal": "*",
                        "Action": "s3:*",
                        "Resource": [ARN, ARN + "/*"],
                        "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                    }
                ]
            })
        },
    }


class SafetyAuditTests(unittest.TestCase):
    def run_audit(self, responses=None, bucket=BUCKET, account=ACCOUNT, region=REGION):
        responses = deepcopy(responses if responses is not None else fixture())
        calls = []

        def read(service, operation, params):
            self.assertEqual(params, {} if service == "sts" else {
                "bucket": BUCKET, "region": REGION
            })
            self.assertIn(operation, {
                "get-caller-identity",
                "get-bucket-location",
                "get-bucket-versioning",
                "get-public-access-block",
                "get-bucket-encryption",
                "get-bucket-ownership-controls",
                "get-bucket-policy",
            })
            calls.append((service, operation))
            return responses[(service, operation)]

        output = audit.verify_bucket(read, bucket, account, region)
        return output, calls

    def test_healthy_dedicated_bucket(self):
        passed, calls = self.run_audit()
        self.assertEqual(len(passed), 8)
        self.assertEqual(len(calls), 7)

    def test_reject_backup_bucket_before_any_aws_call(self):
        with self.assertRaisesRegex(audit.SafetyError, "dedicated"):
            self.run_audit(bucket="herta-production-backups-911291529944-ap-northeast-1")

    def test_wrong_account_fails_closed(self):
        responses = fixture()
        responses[("sts", "get-caller-identity")]["Account"] = "000000000000"
        with self.assertRaisesRegex(audit.SafetyError, "account mismatch"):
            self.run_audit(responses=responses)

    def test_suspended_versioning_is_rejected(self):
        responses = fixture()
        responses[("s3api", "get-bucket-versioning")]["Status"] = "Suspended"
        with self.assertRaisesRegex(audit.SafetyError, "versioning"):
            self.run_audit(responses=responses)

    def test_every_public_access_block_setting_is_required(self):
        for field in (
            "BlockPublicAcls",
            "IgnorePublicAcls",
            "BlockPublicPolicy",
            "RestrictPublicBuckets",
        ):
            with self.subTest(field=field):
                responses = fixture()
                responses[("s3api", "get-public-access-block")][
                    "PublicAccessBlockConfiguration"
                ][field] = False
                with self.assertRaises(audit.SafetyError):
                    self.run_audit(responses=responses)

    def test_wrong_encryption_or_owner_fails(self):
        responses = fixture()
        responses[("s3api", "get-bucket-encryption")][
            "ServerSideEncryptionConfiguration"
        ]["Rules"][0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"] = "aws:kms"
        with self.assertRaisesRegex(audit.SafetyError, "encryption"):
            self.run_audit(responses=responses)
        responses = fixture()
        responses[("s3api", "get-bucket-ownership-controls")][
            "OwnershipControls"
        ]["Rules"][0]["ObjectOwnership"] = "ObjectWriter"
        with self.assertRaisesRegex(audit.SafetyError, "ownership"):
            self.run_audit(responses=responses)

    def test_policy_without_bucket_and_object_https_deny_is_rejected(self):
        responses = fixture()
        responses[("s3api", "get-bucket-policy")]["Policy"] = json.dumps({
            "Statement": [
                {
                    "Effect": "Deny",
                    "Principal": "*",
                    "Action": "s3:*",
                    "Resource": ARN + "/*",
                    "Condition": {"Bool": {"aws:SecureTransport": "false"}},
                }
            ]
        })
        with self.assertRaisesRegex(audit.SafetyError, "HTTPS-only"):
            self.run_audit(responses=responses)

    def test_no_network_or_mutating_aws_actions(self):
        _, calls = self.run_audit()
        self.assertEqual(
            set(calls),
            {
                ("sts", "get-caller-identity"),
                ("s3api", "get-bucket-location"),
                ("s3api", "get-bucket-versioning"),
                ("s3api", "get-public-access-block"),
                ("s3api", "get-bucket-encryption"),
                ("s3api", "get-bucket-ownership-controls"),
                ("s3api", "get-bucket-policy"),
            },
        )

    def test_unavailable_aws_cli_fails_closed(self):
        with patch.object(audit.subprocess, "run", side_effect=FileNotFoundError()):
            with self.assertRaisesRegex(audit.SafetyError, "AWS read failed"):
                audit.cli_read("sts", "get-caller-identity", {})


if __name__ == "__main__":
    unittest.main()
