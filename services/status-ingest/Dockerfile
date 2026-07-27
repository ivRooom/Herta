FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN groupadd --gid 10001 status-ingest \
    && useradd \
      --uid 10001 \
      --gid 10001 \
      --no-create-home \
      --home-dir /nonexistent \
      --shell /usr/sbin/nologin \
      status-ingest \
    && mkdir -p /app /data \
    && chown -R 10001:10001 /app /data

WORKDIR /app
COPY --chown=10001:10001 status_ingest.py runner.py /app/

USER 10001:10001
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2).read()"]

CMD ["python", "-u", "/app/runner.py"]
