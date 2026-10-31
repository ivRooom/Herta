#!/usr/bin/env python3
"""Offline fail-closed contract for the opt-in VC Recap audio S3 lifecycle.

The test intentionally uses only the standard library. It guards against
accidental expiration or all-object IA transitions; it does NOT validate
CloudFormation against AWS or authorize production deployment.
"""

import pathlib
import re
import unittest


TEMPLATE = (
    pathlib.Path(__file__).resolve().parents[1]
    / "aws"
    / "vc-recap-storage"
    / "template.yml"
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def between(text: str, start: str, end: str) -> str:
    require(text.count(start) == 1, f"Missing or duplicate {start.strip()}")
    section = text.split(start, 1)[1]
    require(end in section, f"Missing {end.strip()}")
    return section.split(end, 1)[0]


def verify_contract(template: str) -> None:
    parameters = between(
        template, "  EnableAudioStandardIALifecycle:\n", "  ErasureWorkerRoleName:\n"
    )
    require("Default: 'false'" in parameters, "IA lifecycle must default OFF")
    require(
        "AllowedValues: ['false', 'true']" in parameters,
        "IA lifecycle must have an explicit boolean-like allowlist",
    )
    conditions = between(template, "\nConditions:\n", "\nResources:\n")
    require(
        "EnableAudioIALifecycle: !Equals [!Ref EnableAudioStandardIALifecycle, 'true']"
        in conditions,
        "IA lifecycle condition must require explicit true",
    )
    lifecycle = between(
        template, "      LifecycleConfiguration: !If\n", "      Tags:\n"
    )
    require(
        lifecycle.startswith("        - EnableAudioIALifecycle\n")
        and "        - !Ref 'AWS::NoValue'" in lifecycle,
        "IA lifecycle must be absent when disabled",
    )
    require(
        "TransitionDefaultMinimumObjectSize: all_storage_classes_128K" in lifecycle
        and "ObjectSizeGreaterThan: '131071'" in lifecycle,
        "Lifecycle must exclude all audio objects smaller than 128 KiB",
    )
    require(
        lifecycle.count("TagFilters:") == 1
        and "Key: vc-recap-kind" in lifecycle
        and "Value: audio" in lifecycle,
        "Lifecycle must select tagged audio only",
    )
    require(
        lifecycle.count("Rules:") == 1
        and lifecycle.count("Id: HertaVcRecapAudioStandardIAAfter30Days") == 1
        and lifecycle.count("Status: Enabled") == 1
        and lifecycle.count("TransitionInDays: 30") == 1
        and lifecycle.count("StorageClass: STANDARD_IA") == 1,
        "Only the reviewed 30-day Standard-IA transition is permitted",
    )
    require(
        re.search(
            r"^\s*(Expiration(?:InDays|Date)?|NoncurrentVersionExpiration(?:InDays)?|"
            r"ExpiredObjectDeleteMarker)\s*:",
            template,
            re.MULTILINE,
        )
        is None,
        "Automatic deletion of audio or prior versions is forbidden",
    )
    require(
        "DeletionPolicy: Retain" in template
        and "UpdateReplacePolicy: Retain" in template
        and "Status: Enabled" in template,
        "Retain and versioning safety properties must be preserved",
    )


class AudioLifecycleContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = TEMPLATE.read_text(encoding="utf-8")

    def test_template_is_fail_closed_and_transition_only(self):
        verify_contract(self.template)

    def test_missing_audio_tag_fails(self):
        with self.assertRaisesRegex(ValueError, "tagged audio"):
            verify_contract(self.template.replace("Key: vc-recap-kind", "Key: other-kind"))

    def test_any_expiration_fails(self):
        mutated = self.template.replace(
            "                - TransitionInDays: 30",
            "              ExpirationInDays: 365\n                - TransitionInDays: 30",
        )
        with self.assertRaisesRegex(ValueError, "Automatic deletion"):
            verify_contract(mutated)

    def test_enabled_by_default_fails(self):
        with self.assertRaisesRegex(ValueError, "default OFF"):
            verify_contract(
                self.template.replace("    Default: 'false'", "    Default: 'true'")
            )

    def test_audio_chunk_under_128k_is_not_transition_eligible(self):
        with self.assertRaisesRegex(ValueError, "128 KiB"):
            verify_contract(
                self.template.replace(
                    "ObjectSizeGreaterThan: '131071'",
                    "ObjectSizeGreaterThan: '0'",
                )
            )

    def test_unconditional_lifecycle_fails(self):
        with self.assertRaisesRegex(ValueError, "absent when disabled"):
            verify_contract(
                self.template.replace(
                    "        - EnableAudioIALifecycle",
                    "        - AttachErasurePolicy",
                )
            )


if __name__ == "__main__":
    unittest.main()
