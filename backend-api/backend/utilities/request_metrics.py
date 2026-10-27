from fastapi import FastAPI
from prometheus_client import REGISTRY, CollectorRegistry
from prometheus_fastapi_instrumentator import Instrumentator, metrics

NAMESPACE = "payment_backend"
SUBSYSTEM = "fastapi"
LATENCY_BUCKETS = (1, 2, 3, 4)


def request_metrics(registry: CollectorRegistry = REGISTRY) -> list:
    options = {
        "metric_namespace": NAMESPACE,
        "metric_subsystem": SUBSYSTEM,
        "registry": registry,
    }
    return [
        metrics.requests(**options),
        metrics.response_size(**options),
        metrics.latency(buckets=LATENCY_BUCKETS, **options),
    ]


def instrument(app: FastAPI, registry: CollectorRegistry = REGISTRY) -> Instrumentator:
    instrumentator = Instrumentator(should_group_status_codes=False, registry=registry)
    for metric in request_metrics(registry):
        instrumentator.add(metric)  # type: ignore
    instrumentator.instrument(app)
    return instrumentator
