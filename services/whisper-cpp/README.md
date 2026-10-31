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
- The adapter caps concurrent HTTP connections and uses a single inference mutex. Unavailable inference returns an error, **never cloud-fallback**. A 10s absolute deadline bounds upload of HTTP headers and PCM body; socket send/receive timeout is also 10s. Each decode runs in a separate `execve`-isolated child with a **parent-enforced 18s wall-clock limit**, followed by `SIGKILL`/`waitpid` on deadline or HTTP disconnect. Pipes, not files, carry PCM/JSON; bearer and other application environment variables are not passed to the child. A local disconnect/abort is tested with synthetic audio, but **this does not prove that a remote Studio/Discord consent withdrawal terminates an in-flight process** until Bot integration and per-owner deletion fences are proven. The existing Bot stop flush budget is 20s; its request lifecycle and this 18s cap must be tested together.

## Security tests (no participant audio)

CI: [`ci-whisper-cpp.yml`](../../.github/workflows/ci-whisper-cpp.yml) builds native AMD64 + ARM64 scratch images, executes `--self-test` without a model, rejects missing token/model, collects CycloneDX SBOMs and requires unchanged Grype `--fail-on high`. **After both image scans pass**, the AMD64 job downloads the pinned public GGML model into the ephemeral CI runner, verifies SHA-256, boots the image with a synthetic token and localhost-only binding, then exercises `/healthz`, rejection of unauthenticated input, 1s and 8s generated silence, process termination after HTTP disconnect, and successful reuse (no participant voice). See [verified native CI #41211579277](https://github.com/ivRooom/Herta/actions/runs/41211579277) for both-architecture image tests and 5.67s/5.78s AMD64 synthetic timing. Subsequent CI-only in-flight Docker cgroup sampling (tracked in [#656](https://github.com/ivRooom/Herta/issues/656)) reports **sampled** parent+child memory, not guaranteed peak RSS. Neither CI sample nor scratch image Grype results establish real production safety.

```bash
docker build -t herta-whispercpp:spike ./services/whisper-cpp
docker run --rm herta-whispercpp:spike --self-test
```

## Release gates still open — no deployment or canary permission

1. **Model pin implemented but not production accepted:** fixed GGML multilingual `ggml-tiny.bin` from [official Hugging Face repository](https://huggingface.co/ggerganov/whisper.cpp), revision `5359861c739e955e79d9a303bcbc70fb988958b1`, SHA-256 `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`. The static worker verifies that exact digest at **each startup**, rejecting altered/symlinked files. FIPS SHA256 known-answer tests run in CI; `stage_model_offhost.sh` downloads and verifies **outside production only**. The old CTranslate2 `model.bin` cannot be reused. **Real model load on the production-equivalent host and independent provenance audit remain release gates**. Ephemeral CI has loaded the approved-model-hash GGML file and processed synthetic silence, but no production model has been staged.
2. Complete independent native code/security review and production-equivalent resource tests. CI already covers model startup, generated-silence inference and an HTTP-disconnect→child-kill/reap test. Outstanding: real permitted Japanese speech CER/RTF, end-to-end Bot consent-withdrawal and owner-lock DB no-write checks, 18s hard-deadline behavior during actual decode, multiclient/malformed input/security fuzzing, child peak RSS and CPU credit, and failure/restart handling. Synthetic CI is **not** a participant-audio privacy acceptance test. Compare the implementation with the previous faster-whisper path without weakening its consent fence.
3. Prove both AMD64/ARM64 Grype High/Critical zero **without exclusions**; review any static-binary vulnerability blind spots.
4. Prove existing 2vCPU/2GB Lightsail has enough baseline headroom **under peak load**, and actual RSS/RTF/CER/concurrency from authorized Japanese audio, with no existing services impacted (#577/#656). Last observed host MemAvailable ~900MiB below old sidecar gate.
5. Only then add an opt-in and fail-closed **private** Compose profile and gated Bot routing on a separate reviewed PR; ensure existing #658 safety changes (per-user consent, owner-lock erasure guard, stop fail-closed) are carried forward.
6. Publish and verify privacy notice; actual Guild ID, individual Discord participant opt-ins, user-performed VC E2E (#518/#657) and preflight/rollback approval must be recorded before activation.

**Do not run this adapter with real voice data on production.** No cost-bearing resources have been provisioned.

## 2026-11-01 staging: private native Compose profile (still OFF)

- `docker-compose.common.yml` defines a **separate** `whisper-native` service behind `profiles: ['whisper-native']`, extended in both production and external-DB topology. This keeps the previous Python `whisper` service intact and ensures they have different Docker DNS names. The new service has no published host port, no cloud tunnel route, a read-only file-only GGML model mount, no privileges, and fixed CPU / memory / pids limits.
- `VC_RECAP_TRANSCRIPTION_PROVIDER=aws`, `VC_RECAP_LOCAL_WHISPER_ENABLED=false`, `VC_RECAP_LOCAL_WHISPER_BACKEND=python`, and `VC_RECAP_NATIVE_WHISPER_ACCEPTED=false` remain the **defaults**. The Bot transport only accepts exactly `python` and `native` as backend names; an unknown URL/name or native selection without its explicit acceptance bit rejects PCM before any network request. No automatic AWS/OpenAI fallback is introduced.
- CI validates the native Compose profile in both database topologies **without** running it. This release does not stage a model or token, call `docker compose --profile whisper-native up`, or collect/retain private audio. Releasing this inactive configuration is **not** production Whisper activation.
- **Production enablement remains prohibited:** first complete participant opt-in and owner-locked revocation/deletion guards (#655/#646), independent source security review, permitted Japanese speech CER/RTF, real host peak RSS/CPU and stop/backpressure testing (#577/#656), secure model/token staging, operator Guild Canary and real Discord E2E (#518/#657), plus published accurate privacy policy. The CI-only 145.2MiB sampled container figure is not a host safety threshold; the latest available host MemAvailable was below the existing conservative 1100MiB gate.
- **Rollback after inactive staging deploy:** keep the previous immutable `ghcr.io/ivrooom/herta:<sha>` image and pinned Git revision, use the existing audited production deploy/rollback path, and verify Bot/API/Studio health. If later explicitly activated, first set `VC_RECAP_LOCAL_WHISPER_ENABLED=false` and `VC_RECAP_NATIVE_WHISPER_ACCEPTED=false` before stopping the sidecar; never switch to AWS as an unintended paid fallback. Do not delete S3/DB data as a rollback.
