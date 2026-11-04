#!/usr/bin/env python3
"""Offline paired AWS/Whisper CER and RTF aggregation (no audio, no transcript output).

Run only on a private machine using consented data. Never upload input to CI,
GitHub, logs, or artifacts. CI exercises synthetic unit tests exclusively.

Input from stdin:
{
  "classification": "synthetic" | "consented-real",
  "samples": [{
    "reference": "日本語の正解文",
    "audio_seconds": 2.0,
    "providers": {
      "aws": {"transcript": "日本語の正解文", "latency_seconds": 1.0},
      "whisper": {"transcript": "日本語の認識文", "latency_seconds": 1.5}
    }
  }]
}
Output contains aggregate metrics only, never reference/hypothesis strings.
"""
import json
import math
import sys
import unicodedata

MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_SAMPLES = 1000
MAX_CHARACTERS = 4000
PROVIDERS = ("aws", "whisper")


class InvalidBenchmark(ValueError):
    """A fixed, privacy-safe validation error."""


def normalize(text):
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(
        char for char in normalized
        if not char.isspace() and not unicodedata.category(char).startswith("P")
    )


def edit_distance(left, right):
    """Levenshtein distance, using linear memory instead of a full matrix."""
    if len(left) < len(right):
        left, right = right, left
    previous = list(range(len(right) + 1))
    for i, char_left in enumerate(left, 1):
        current = [i]
        for j, char_right in enumerate(right, 1):
            current.append(min(
                current[-1] + 1,
                previous[j] + 1,
                previous[j - 1] + (char_left != char_right),
            ))
        previous = current
    return previous[-1]


def positive_number(value):
    return (
        type(value) in (float, int)
        and math.isfinite(value)
        and value > 0
    )


def aggregate(data):
    if type(data) is not dict or data.get("classification") not in (
        "synthetic", "consented-real"
    ):
        raise InvalidBenchmark("invalid benchmark classification")
    samples = data.get("samples")
    if type(samples) is not list or not (1 <= len(samples) <= MAX_SAMPLES):
        raise InvalidBenchmark("invalid benchmark sample count")

    totals = {
        name: {
            "character_errors": 0,
            "reference_characters": 0,
            "processing_seconds": 0.0,
            "silence_samples": 0,
            "silence_hallucinations": 0,
        }
        for name in PROVIDERS
    }
    audio_seconds = 0.0
    for sample in samples:
        if type(sample) is not dict or not isinstance(sample.get("reference"), str):
            raise InvalidBenchmark("invalid reference")
        reference = normalize(sample["reference"])
        if len(reference) > MAX_CHARACTERS:
            raise InvalidBenchmark("reference exceeds evaluation limit")
        seconds = sample.get("audio_seconds")
        if not positive_number(seconds):
            raise InvalidBenchmark("invalid audio duration")
        audio_seconds += seconds
        providers = sample.get("providers")
        if type(providers) is not dict or set(providers) != set(PROVIDERS):
            raise InvalidBenchmark("both providers must use the same sample")
        for name in PROVIDERS:
            result = providers[name]
            if type(result) is not dict or not isinstance(result.get("transcript"), str):
                raise InvalidBenchmark("invalid hypothesis")
            latency = result.get("latency_seconds")
            if not positive_number(latency):
                raise InvalidBenchmark("missing or invalid processing duration")
            hypothesis = normalize(result["transcript"])
            if len(hypothesis) > MAX_CHARACTERS:
                raise InvalidBenchmark("hypothesis exceeds evaluation limit")
            bucket = totals[name]
            bucket["processing_seconds"] += latency
            if reference:
                bucket["reference_characters"] += len(reference)
                bucket["character_errors"] += edit_distance(reference, hypothesis)
            else:
                bucket["silence_samples"] += 1
                bucket["silence_hallucinations"] += bool(hypothesis)
    if not any(bucket["reference_characters"] for bucket in totals.values()):
        raise InvalidBenchmark("evaluation requires at least one non-silent sample")

    metrics = {}
    for name, bucket in totals.items():
        # A zero denominator is never interpreted as a zero-error result.
        count = bucket["reference_characters"]
        metrics[name] = {
            "cer": round(bucket["character_errors"] / count, 6),
            "character_errors": bucket["character_errors"],
            "reference_characters": count,
            "rtf": round(bucket["processing_seconds"] / audio_seconds, 6),
            "processing_seconds": round(bucket["processing_seconds"], 6),
            "silence_samples": bucket["silence_samples"],
            "silence_hallucinations": bucket["silence_hallucinations"],
            "peak_rss_mib": None,
            "cpu_percent": None,
            "concurrency_capacity": None,
        }
    return {
        "classification": data["classification"],
        "normalization": "Unicode NFKC + casefold + strip whitespace/punctuation",
        "sample_count": len(samples),
        "audio_seconds": round(audio_seconds, 6),
        "providers": metrics,
        "limits": "No model quality, production RSS or concurrency claims from synthetic data",
    }


def main():
    try:
        # Limit input to avoid accidental large personal-data ingestion.
        payload = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            raise InvalidBenchmark("input exceeds size limit")
        data = json.loads(payload)
        metrics = aggregate(data)
    except (InvalidBenchmark, json.JSONDecodeError) as error:
        # InvalidBenchmark messages are fixed and never include input values.
        print(f"benchmark rejected: {error}", file=sys.stderr)
        return 2
    except (OSError, UnicodeError, TypeError, ValueError):
        print("benchmark rejected: invalid input", file=sys.stderr)
        return 2
    json.dump(metrics, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
