"""Strict, non-logging request contract for the private VC Recap PCM endpoint."""
import hmac
import json

SAMPLE_RATE = 48_000
BYTES_PER_SAMPLE = 2
MAX_AUDIO_SECONDS = 10
MAX_PCM_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * MAX_AUDIO_SECONDS
MAX_TRANSCRIPT_CHARS = 4_000

def authorized(header: str, expected_token: str) -> bool:
    if len(expected_token) < 32 or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].encode("utf-8"), expected_token.encode("utf-8"))

def valid_pcm_length(value: str | None) -> int | None:
    try:
        length = int(value) if value is not None else 0
    except (TypeError, ValueError):
        return None
    if length < BYTES_PER_SAMPLE or length > MAX_PCM_BYTES or length % BYTES_PER_SAMPLE:
        return None
    return length

def transcript_response(text: str) -> bytes:
    return json.dumps({"text": text.strip()[:MAX_TRANSCRIPT_CHARS]}, ensure_ascii=False).encode("utf-8")
