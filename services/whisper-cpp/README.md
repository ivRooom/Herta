# Native Whisper CPU experiment — NOT production-ready

Tracked by [Herta #672](https://github.com/ivRooom/Herta/issues/672). This directory is deliberately **not referenced by production Compose, Bot configuration or deploy workflows**. Existing AWS Transcribe remains production default.

## Upstream and image

- Native implementation: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp), MIT, tag `v1.9.5`, Git commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`.
- Build stage: Alpine musl toolchain/CMake; `GGML_OPENMP=OFF`, `GGML_NATIVE=OFF`, CPU-only. Final container: `scratch` with a statically linked binary, non-root `10001:10001`, no ffmpeg, Python, shell, apt or pip. GitHub CI builds and security-scans on both native AMD64 and ARM64.
- No model data or private audio is downloaded in image build or runtime. Never commit model weights or participant audio to GitHub.

## Private API contract

Intended endpoint `http://whisper:8765/v1/transcribe` is compatible with the **wire shape** expected by Herta's local Whisper Bot adapter, but the new service is not wired into Compose.

- `GET /healthz` requires an already loaded model. `POST /v1/transcribe` requires a **private** 32+-character `VC_RECAP_LOCAL_WHISPER_TOKEN`, `Authorization: Bearer ...`, `Content-Type: application/octet-stream`, `X-Audio-Sample-Rate: 48000`, and exactly one valid Content-Length. Chunked uploads, duplicate headers, excessive bodies and malformed frames fail closed.
- Input: at most ten seconds of 48kHz/16-bit/mono PCM. Output: JSON `{"text":"..."}` with 4,000-character bound. 31-tap low-pass + 3:1 resampling converts to 16kHz floating-point samples **in memory**, then invokes one CPU-native upstream `whisper_full` call. No persistent recording or transcript files.
- The adapter caps concurrent HTTP connections and uses a single inference mutex. Unavailable inference returns an error, **never cloud-fallback**. Request-body and response socket timeouts are 10s. **Native CPU inference itself has no proven hard 10s cancellation yet.** Existing Bot timeout/abort does not instantly interrupt native work.

## Security tests (no participant audio)

CI: [`ci-whisper-cpp.yml`](../../.github/workflows/ci-whisper-cpp.yml) builds native AMD64 + ARM64 scratch images, executes `--self-test` without a model, rejects missing token/model, collects CycloneDX SBOMs and requires unchanged Grype `--fail-on high`. **After both image scans pass**, the AMD64 job downloads the pinned public GGML model into the ephemeral CI runner, verifies SHA-256, boots the image with a synthetic token and localhost-only binding, then exercises `/healthz`, rejection of unauthenticated input and 1s of generated silence (no participant voice). CI measurements are not an on-host performance guarantee.

```bash
docker build -t herta-whispercpp:spike ./services/whisper-cpp
docker run --rm herta-whispercpp:spike --self-test
```

## Release gates still open — no deployment or canary permission

1. **Model pin implemented but not production accepted:** fixed GGML multilingual `ggml-tiny.bin` from [official Hugging Face repository](https://huggingface.co/ggerganov/whisper.cpp), revision `5359861c739e955e79d9a303bcbc70fb988958b1`, SHA-256 `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`. The static worker verifies that exact digest at **each startup**, rejecting altered/symlinked files. FIPS SHA256 known-answer tests run in CI; `stage_model_offhost.sh` downloads and verifies **outside production only**. The old CTranslate2 `model.bin` cannot be reused. **Real model load and external provenance audit remain release gates**, and no production model has been staged.
2. Run **real** audio→recognition synthetic tests and independent native code/security review. Validate request smuggling, UTF-8, HTTP concurrency, token handling, ASR errors, cancellation on participant withdrawal, CPU time budget, pids, memory, and 10s inference watchdog with no audio retention. Prove Python implementation parity. This spike only has no-model/contract self-tests.
3. Prove both AMD64/ARM64 Grype High/Critical zero **without exclusions**; review any static-binary vulnerability blind spots.
4. Prove existing 2vCPU/2GB Lightsail has enough baseline headroom **under peak load**, and actual RSS/RTF/CER/concurrency from authorized Japanese audio, with no existing services impacted (#577/#656). Last observed host MemAvailable ~900MiB below old sidecar gate.
5. Only then add an opt-in and fail-closed **private** Compose profile and gated Bot routing on a separate reviewed PR; ensure existing #658 safety changes (per-user consent, owner-lock erasure guard, stop fail-closed) are carried forward.
6. Publish and verify privacy notice; actual Guild ID, individual Discord participant opt-ins, user-performed VC E2E (#518/#657) and preflight/rollback approval must be recorded before activation.

**Do not run this adapter with real voice data on production.** No cost-bearing resources have been provisioned.
