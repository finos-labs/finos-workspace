import os
import tempfile

from prometheus_client import CollectorRegistry, multiprocess, start_http_server, values


def use_multiprocess_values() -> str:
    directory = tempfile.mkdtemp(prefix="prometheus-")
    os.environ["PROMETHEUS_MULTIPROC_DIR"] = directory
    values.ValueClass = values.get_value_class()
    return directory


def serve_all_workers(port: int) -> None:
    registry = CollectorRegistry()
    multiprocess.MultiProcessCollector(registry)
    start_http_server(port, registry=registry)


def mark_worker_dead(pid: int) -> None:
    multiprocess.mark_process_dead(pid)
