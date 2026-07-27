#!/usr/bin/env python3
from __future__ import annotations

import signal
import sqlite3
import threading
from typing import Any

from status_ingest import (
    LOG,
    Config,
    ConfigurationError,
    StatusServer,
    StatusStore,
    configure_logging,
)


def main() -> int:
    configure_logging()
    try:
        config = Config.from_env()
        store = StatusStore(config)
    except (ConfigurationError, OSError, sqlite3.Error) as error:
        LOG.error("startup_failed: %s", error)
        return 2

    server = StatusServer((config.host, config.port), config, store)
    shutdown_started = threading.Event()

    def shutdown(signum: int, frame: Any) -> None:
        if shutdown_started.is_set():
            return
        shutdown_started.set()
        LOG.info("shutdown_requested signal=%s", signum)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    LOG.info("status_ingest_started host=%s port=%s", config.host, config.port)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        LOG.info("status_ingest_stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
