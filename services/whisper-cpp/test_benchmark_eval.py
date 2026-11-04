"""Synthetic-only tests. Never check in participant transcripts or recordings."""
import copy
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchmark_eval as bench


def sample(reference="こんにちは", aws="こんにちは", whisper="こんにちわ", duration=2.0):
    return {
        "reference": reference,
        "audio_seconds": duration,
        "providers": {
            "aws": {"transcript": aws, "latency_seconds": 1.0},
            "whisper": {"transcript": whisper, "latency_seconds": 1.5},
        },
    }


class BenchmarkEvaluationTests(unittest.TestCase):
    def test_paired_japanese_cer_and_rtf(self):
        result = bench.aggregate({
            "classification": "synthetic",
            "samples": [sample(), sample("AWS。", "aws", "AWS!", 3.0)],
        })
        aws = result["providers"]["aws"]
        local = result["providers"]["whisper"]
        self.assertEqual(aws["cer"], 0)
        self.assertEqual(local["character_errors"], 1)
        self.assertEqual(local["reference_characters"], 8)
        self.assertEqual(local["cer"], 0.125)
        self.assertEqual(aws["rtf"], 0.4)
        self.assertEqual(local["rtf"], 0.6)
        self.assertIsNone(local["peak_rss_mib"])
        self.assertEqual(result["classification"], "synthetic")

    def test_silence_hallucination_is_not_zero_cer_evidence(self):
        result = bench.aggregate({
            "classification": "synthetic",
            "samples": [sample("", "", "発話していません", duration=1.0), sample()],
        })
        self.assertEqual(result["providers"]["whisper"]["silence_samples"], 1)
        self.assertEqual(result["providers"]["whisper"]["silence_hallucinations"], 1)
        self.assertEqual(result["providers"]["aws"]["silence_hallucinations"], 0)

    def test_normalization(self):
        self.assertEqual(bench.normalize("ＡＷＳ、 ＴＥＳＴ。"), "awstest")
        self.assertEqual(bench.edit_distance("東京", "東都"), 1)
        self.assertEqual(bench.edit_distance("", "テスト"), 3)

    def test_missing_or_mismatched_evidence_fails_closed(self):
        original = {"classification": "synthetic", "samples": [sample()]}
        cases = [
            {},
            {"classification": "synthetic", "samples": []},
            {"classification": "synthetic", "samples": [sample("", "", "")]},
        ]
        for mutation in ("missing_provider", "missing_latency", "zero_duration", "secret_length"):
            payload = copy.deepcopy(original)
            entry = payload["samples"][0]
            if mutation == "missing_provider":
                del entry["providers"]["aws"]
            elif mutation == "missing_latency":
                del entry["providers"]["whisper"]["latency_seconds"]
            elif mutation == "zero_duration":
                entry["audio_seconds"] = 0
            else:
                entry["reference"] = "x" * (bench.MAX_CHARACTERS + 1)
            cases.append(payload)
        for invalid in cases:
            with self.subTest(invalid=invalid.get("classification")):
                with self.assertRaises(bench.InvalidBenchmark):
                    bench.aggregate(invalid)

    def test_finite_individual_timings_cannot_overflow_aggregate(self):
        baseline = {"classification": "synthetic", "samples": [
            sample(duration=1e308), sample(duration=1e308),
        ]}
        with self.assertRaisesRegex(bench.InvalidBenchmark, "aggregate audio duration"):
            bench.aggregate(baseline)

        processing = {"classification": "synthetic", "samples": [
            sample(duration=1.0), sample(duration=1.0),
        ]}
        for record in processing["samples"]:
            record["providers"]["whisper"]["latency_seconds"] = 1e308
        with self.assertRaisesRegex(bench.InvalidBenchmark, "aggregate processing duration"):
            bench.aggregate(processing)

        huge_ratio = {"classification": "synthetic", "samples": [sample(duration=1e-308)]}
        huge_ratio["samples"][0]["providers"]["whisper"]["latency_seconds"] = 1e308
        with self.assertRaisesRegex(bench.InvalidBenchmark, "aggregate RTF"):
            bench.aggregate(huge_ratio)

    def test_oversized_json_integer_fails_closed(self):
        self.assertFalse(bench.positive_number(10**400))
        for field in ("audio_seconds", "latency_seconds"):
            payload = {"classification": "synthetic", "samples": [sample()]}
            if field == "audio_seconds":
                payload["samples"][0]["audio_seconds"] = 10**400
            else:
                payload["samples"][0]["providers"]["whisper"]["latency_seconds"] = 10**400
            with self.subTest(field=field):
                with self.assertRaises(bench.InvalidBenchmark):
                    bench.aggregate(payload)

    def test_json_recursion_error_is_rejected_without_private_details(self):
        stdin = io.TextIOWrapper(io.BytesIO(b'{"classification":"synthetic"}'), encoding="utf-8")
        with patch.object(sys, "stdin", stdin), \
             patch.object(bench.json, "loads", side_effect=RecursionError("private input")), \
             patch("sys.stderr", new_callable=io.StringIO) as stderr:
            self.assertEqual(bench.main(), 2)
            self.assertEqual(stderr.getvalue(), "benchmark rejected: invalid input\n")
            self.assertNotIn("private input", stderr.getvalue())

    def test_deeply_nested_json_is_safely_rejected(self):
        # JSON recursion limits vary between Python builds and versions.
        contents = "[" * 3000 + "0" + "]" * 3000
        stdin = io.TextIOWrapper(io.BytesIO(contents.encode()), encoding="utf-8")
        with patch.object(sys, "stdin", stdin), patch("sys.stderr", new_callable=io.StringIO) as stderr:
            self.assertEqual(bench.main(), 2)
            self.assertIn("benchmark rejected:", stderr.getvalue())
            self.assertNotIn("Traceback", stderr.getvalue())

    def test_no_text_identifiers_or_secrets_in_output(self):
        hidden = "合成機密文字列123-FAKE"
        payload = {"classification": "synthetic", "samples": [sample(hidden, hidden, hidden)]}
        output = json.dumps(bench.aggregate(payload), ensure_ascii=False)
        self.assertNotIn(hidden, output)
        self.assertNotIn("reference", output.split('"providers"')[0])
        self.assertNotIn("FAKE", output)

    def test_invalid_input_never_echoes_transcript(self):
        secret = "個人情報を出してはいけない123"
        payload = {"classification": "synthetic", "samples": [sample(secret)]}
        payload["samples"][0]["providers"]["whisper"]["latency_seconds"] = -1
        stdin = io.TextIOWrapper(io.BytesIO(json.dumps(payload).encode()), encoding="utf-8")
        with patch.object(sys, "stdin", stdin), patch("sys.stderr", new_callable=io.StringIO) as stderr:
            self.assertEqual(bench.main(), 2)
            self.assertNotIn(secret, stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
