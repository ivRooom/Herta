"""Private, bounded CPU-only faster-whisper endpoint; never persists participant audio."""
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore

from contract import authorized, transcript_response, valid_pcm_length
from model_manifest import verify_model_manifest

# Loaded only after the model has been explicitly staged on the operator's disk.
def load_model():
    model_path = Path(os.environ.get("WHISPER_MODEL_PATH", "/models/model"))
    if not model_path.is_dir() or not (model_path / "config.json").is_file():
        raise RuntimeError("Whisper model must be staged locally before enabling the service")
    verify_model_manifest(model_path)
    from faster_whisper import WhisperModel

    return WhisperModel(
        str(model_path),
        device="cpu",
        compute_type="int8",
        cpu_threads=1,
        num_workers=1,
        local_files_only=True,
    )


def resample_mono_48k_to_16k(pcm: bytes):
    import numpy as np

    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    # Windowed low-pass FIR before 3:1 decimation prevents basic aliasing.
    taps = np.arange(-15, 16, dtype=np.float64)
    kernel = np.sinc(taps / 3.0) * np.hamming(taps.size)
    kernel /= kernel.sum()
    return np.convolve(samples, kernel, mode="same")[::3].astype(np.float32)


def serve(model, token: str, host: str = "0.0.0.0", port: int = 8765):
    busy = BoundedSemaphore(value=1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            # No path/body/token/user-identifying information in request logs.
            return

        def reply(self, status: int, body: bytes):
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != "/healthz":
                return self.reply(404, b'{"error":"not_found"}')
            return self.reply(200, b'{"status":"ready"}')

        def do_POST(self):
            if self.path != "/v1/transcribe":
                return self.reply(404, b'{"error":"not_found"}')
            if not authorized(self.headers.get("Authorization", ""), token):
                return self.reply(403, b'{"error":"forbidden"}')
            if self.headers.get("Content-Type") != "application/octet-stream":
                return self.reply(415, b'{"error":"invalid_content_type"}')
            if self.headers.get("X-Audio-Sample-Rate") != "48000":
                return self.reply(422, b'{"error":"invalid_sample_rate"}')
            length = valid_pcm_length(self.headers.get("Content-Length"))
            if length is None:
                return self.reply(413, b'{"error":"invalid_audio_size"}')
            if not busy.acquire(blocking=False):
                return self.reply(429, b'{"error":"worker_busy"}')
            try:
                self.connection.settimeout(10)
                pcm = self.rfile.read(length)
                if len(pcm) != length:
                    return self.reply(400, b'{"error":"truncated_audio"}')
                audio = resample_mono_48k_to_16k(pcm)
                segments, _info = model.transcribe(
                    audio, language="ja", beam_size=1,
                    vad_filter=False, condition_on_previous_text=False,
                )
                text = "".join(segment.text for segment in segments)
                return self.reply(200, transcript_response(text))
            except Exception:
                # Never expose audio, transcript, inference exceptions or model paths.
                return self.reply(503, b'{"error":"transcription_unavailable"}')
            finally:
                busy.release()

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    secret = os.environ.get("VC_RECAP_LOCAL_WHISPER_TOKEN", "")
    if len(secret) < 32:
        raise SystemExit("Whisper bearer token must be configured (>=32 chars)")
    serve(load_model(), secret)
