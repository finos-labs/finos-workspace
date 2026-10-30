import logging
import resource
import sys
from pathlib import Path
from threading import Thread

from gunicorn.app.base import BaseApplication
from gunicorn.glogging import Logger
from loguru import logger

from api.rate_limit import TRUSTED_PROXIES
from main import app, start_prometheus
from utilities.config import settings

sys.tracebacklimit = 3


def worker_address_space_limit_bytes() -> int | None:
    configured = settings.WORKER_ADDRESS_SPACE_LIMIT_GB
    if configured is not None:
        return int(configured * 1024**3) if configured > 0 else None
    for cgroup_path in (
        "/sys/fs/cgroup/memory.max",
        "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ):
        try:
            raw = Path(cgroup_path).read_text().strip()
        except OSError:
            continue
        if raw.isdigit() and int(raw) < 1 << 60:
            return int(int(raw) * 0.75)
    return None


WORKER_ADDRESS_SPACE_LIMIT_BYTES = worker_address_space_limit_bytes()


class StubbedGunicornLogger(Logger):
    def setup(self, cfg):
        del cfg
        handler = logging.NullHandler()
        self.error_logger = logging.getLogger("gunicorn.error")
        self.error_logger.addHandler(handler)
        self.access_logger = logging.getLogger("gunicorn.access")
        self.access_logger.addHandler(handler)
        self.error_logger.setLevel(settings.LOG_LEVEL)
        self.access_logger.setLevel(settings.LOG_LEVEL)
        self.access_log_format = (
            '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'
        )


class PaymentsBackend(BaseApplication):
    forks: int = 0

    def __init__(self, application, options=None):
        self.options = options or {}
        self.application = application
        super().__init__()

    @classmethod
    def pre_fork(cls, server, worker):
        del server, worker
        logger.info(f"About to fork new worker #{cls.forks}")
        cls.forks += 1

    @classmethod
    def post_fork(cls, server, worker):
        del server, worker

        if WORKER_ADDRESS_SPACE_LIMIT_BYTES:
            resource.setrlimit(
                resource.RLIMIT_AS,
                (WORKER_ADDRESS_SPACE_LIMIT_BYTES, WORKER_ADDRESS_SPACE_LIMIT_BYTES),
            )

        if settings.PROMETHEUS:
            prometheus_server = Thread(
                target=start_prometheus, args=(cls.forks,), daemon=True
            )
            prometheus_server.start()

    @classmethod
    def post_worker_init(cls, worker):
        del worker
        logger.info("Worker initialized")

    def load_config(self):
        config = {
            key: value
            for key, value in self.options.items()
            if key in self.cfg.settings and value is not None
        }
        for key, value in config.items():
            self.cfg.set(key.lower(), value)

        self.cfg.set("pre_fork", self.pre_fork)
        self.cfg.set("post_fork", self.post_fork)

    def load(self):
        return self.application


if __name__ == "__main__":
    settings.setup_logging()

    if WORKER_ADDRESS_SPACE_LIMIT_BYTES:
        logger.info(
            "Worker address-space cap: "
            f"{WORKER_ADDRESS_SPACE_LIMIT_BYTES / 1024**3:.2f} GiB per worker"
        )
    else:
        logger.info("Worker address-space cap: disabled (no cgroup limit found)")

    options_cfg = {
        "bind": f"0.0.0.0:{settings.PORT}",
        "workers": settings.WORKERS,
        "accesslog": "-",
        "errorlog": "-",
        "worker_class": "uvicorn_worker.UvicornWorker",
        "logger_class": StubbedGunicornLogger,
        "timeout": 120,
        "graceful_timeout": 120,
        "max_requests": 1_000_000,
        "max_requests_jitter": 100_000,
        "keepalive": 75,
        "forwarded_allow_ips": TRUSTED_PROXIES,
        "secure_scheme_headers": {
            "X-FORWARDED-PROTOCOL": "ssl",
            "X-FORWARDED-PROTO": "https",
            "X-FORWARDED-SSL": "on",
        },
    }

    PaymentsBackend(app, options_cfg).run()
