"""The worker image's command (rqworker.Dockerfile): runs WORKER_PROCESSES rq workers on the queue and
starts a new one when one ends, until the container is told to stop."""

# Wildcard imports allow us to not have to restart the job on each run, do NOT delete

import multiprocessing
import signal
import threading

from loguru import logger

from api.worker_tasks import *  # noqa
from utilities.config import *  # type: ignore # noqa

# Import cluster-compatible classes if cluster mode or RQ hash tags are enabled
if settings.REDIS_CLUSTER_MODE or settings.REDIS_RQ_HASH_TAGS:  # noqa: F405
    settings.set_is_worker(True)  # noqa: F405
    from utilities.rq_cluster import (
        ClusterWorker as Worker,
        init_module_cluster_compatibility,
    )

    init_module_cluster_compatibility()
else:
    from rq import Worker  # noqa

listen = ["payments_queue"]

redis_conn = settings.get_redis_session("bot")  # noqa: F405

# Workers in one container.
WORKER_PROCESSES = 2


def work() -> None:
    settings.set_is_worker(True)  # noqa: F405
    settings.setup_logging()  # noqa: F405
    worker = Worker(listen, connection=redis_conn)
    worker.work(with_scheduler=True)


def supervise(processes: int) -> None:
    """Keeps `processes` workers running. On SIGTERM or SIGINT each is told to stop, which rq does once
    the job it is running ends, and waited for."""
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    context = multiprocessing.get_context("spawn")
    running: list[multiprocessing.process.BaseProcess] = []
    while not stopping.is_set():
        for ended in [p for p in running if not p.is_alive()]:
            logger.warning(f"Worker {ended.pid} ended with code {ended.exitcode}; starting another")
            running.remove(ended)
        while len(running) < processes:
            process = context.Process(target=work)
            process.start()
            running.append(process)
        stopping.wait(1)
    for process in running:
        process.terminate()
    for process in running:
        process.join()


if __name__ == "__main__":
    settings.setup_logging()  # noqa: F405
    supervise(WORKER_PROCESSES)
