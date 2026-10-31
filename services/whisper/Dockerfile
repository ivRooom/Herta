# Keep build tools, apt, pip and a shell entirely out of the deployed image.
# Debian 13 distroless Python currently uses Python 3.13; the builder MUST
# match that ABI to load pinned CTranslate2/PyAV/NumPy wheels correctly.
FROM python:3.13-slim-trixie AS wheel-builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --no-compile --target /opt/whisper-deps -r requirements.txt
# libgomp is required by CTranslate2's native CPU inference wheels.
# Copy only the shared runtime library, not the build OS or apt database.
RUN mkdir -p /opt/whisper-libs \
    && cp -L /usr/lib/*-linux-gnu/libgomp.so.1 /opt/whisper-libs/

FROM gcr.io/distroless/python3-debian13:nonroot

ENV PYTHONPATH=/app/deps \
    LD_LIBRARY_PATH=/app/lib \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    OMP_NUM_THREADS=1

WORKDIR /app
COPY --from=wheel-builder /opt/whisper-deps /app/deps
COPY --from=wheel-builder /opt/whisper-libs /app/lib
COPY contract.py model_manifest.py server.py ./

USER 10001:10001
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD ["/usr/bin/python3", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8765/healthz', timeout=3).close()"]
ENTRYPOINT ["/usr/bin/python3"]
CMD ["/app/server.py"]
