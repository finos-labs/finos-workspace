import logging
import sys
import time
from typing import Any, cast

from redis import Redis, RedisCluster, WatchError
from redis.cluster import ClusterPipeline
from redis.exceptions import RedisClusterException
from rq import Queue, Worker
from rq.exceptions import NoSuchJobError
from rq.job import Job
from rq.logutils import (
    DEFAULT_LOGGING_DATE_FORMAT,
    DEFAULT_LOGGING_FORMAT,
    setup_loghandlers,
)
from rq.registry import ScheduledJobRegistry, StartedJobRegistry
from rq.scheduler import RQScheduler
from rq.serializers import resolve_serializer
from rq.timeouts import BaseDeathPenalty
from rq.utils import (
    as_text,
    backend_class,
    current_timestamp,
    get_version,
    parse_names,
    utcnow,
)

from utilities.config import settings


def cast_cluster_pipeline(connection: RedisCluster, **kwargs) -> ClusterPipeline:
    return cast(ClusterPipeline, connection.pipeline(**kwargs))


class ClusterJob(Job):
    redis_job_namespace_prefix = "rq:{rq}:job:"


class ClusterQueue(Queue):
    redis_queue_namespace_prefix = "rq:{rq}:queue:"
    redis_queues_keys = "rq:{rq}:queues"
    job_class = ClusterJob

    @property
    def scheduler_pid(self) -> int:
        pid = self.connection.get(ClusterRQScheduler.get_locking_key(self.name))
        return int(pid.decode()) if pid is not None else None

    @property
    def registry_cleaning_key(self):
        return f"rq:{{rq}}:clean_registries:{self.name}"

    @classmethod
    def dequeue_any(  # noqa: PLR0913, PLR0917
        cls,
        queues: list["Queue"],
        timeout: int | None,
        connection: RedisCluster,
        job_class: type["Job"] | None = None,
        serializer: Any = None,
        death_penalty_class: type[BaseDeathPenalty] | None = None,
    ) -> tuple["Job", "Queue"] | tuple[None, None]:
        job_cls: type[Job] = backend_class(cls, "job_class", override=job_class)  # type: ignore

        while True:
            queue_keys = [q.key for q in queues]
            if len(queue_keys) == 1 and get_version(connection) >= (6, 2, 0):
                try:
                    result = cls.lmove(connection, queue_keys[0], timeout)
                except RedisClusterException:
                    result = cls.lpop(queue_keys, timeout, connection=connection)
            else:
                result = cls.lpop(queue_keys, timeout, connection=connection)
            if result is None:
                return None
            queue_key, job_id = map(as_text, result)
            queue = cls.from_queue_key(
                queue_key,
                connection=connection,
                job_class=job_cls,
                serializer=serializer,
                death_penalty_class=death_penalty_class,
            )
            try:
                job = job_cls.fetch(
                    job_id, connection=connection, serializer=serializer
                )
            except NoSuchJobError:
                continue
            except Exception as e:
                e.job_id = job_id
                e.queue = queue
                raise e
            return job, queue
        return None, None


class ClusterRQScheduler(RQScheduler):
    cluster_connection: RedisCluster

    def __init__(  # noqa
        self,
        queues,
        connection: RedisCluster,
        interval=1,
        logging_level=logging.INFO,
        date_format=DEFAULT_LOGGING_DATE_FORMAT,
        log_format=DEFAULT_LOGGING_FORMAT,
        serializer=None,
    ):
        self._queue_names = set(parse_names(queues))
        self._acquired_locks: set[str] = set()
        self._scheduled_job_registries: list[ScheduledJobRegistry] = []
        self.lock_acquisition_time = None
        self.serializer = resolve_serializer(serializer)

        self._connection = None
        self.cluster_connection = connection
        self.interval = interval
        self._stop_requested = False
        self._status = self.Status.STOPPED
        self._process = None
        self.log = logging.getLogger(__name__)
        setup_loghandlers(
            level=logging_level,
            name=__name__,
            log_format=log_format,
            date_format=date_format,
        )

    @property
    def connection(self):
        if self._connection:
            return self._connection

        return self.cluster_connection

    @classmethod
    def get_locking_key(cls, name: str):
        return f"rq:{{rq}}:scheduler-lock:{name}"

    def enqueue_scheduled_jobs(self):
        self._status = self.Status.WORKING

        if not self._scheduled_job_registries and self._acquired_locks:
            self.prepare_registries()

        for registry in self._scheduled_job_registries:
            timestamp = current_timestamp()

            job_ids = registry.get_jobs_to_schedule(timestamp)

            if not job_ids:
                continue

            queue = ClusterQueue(
                registry.name, connection=self.connection, serializer=self.serializer
            )

            with self.connection.pipeline() as pipeline:
                jobs = ClusterJob.fetch_many(
                    job_ids, connection=self.connection, serializer=self.serializer
                )
                for job in jobs:
                    if job is not None:
                        queue._enqueue_job(
                            job, pipeline=pipeline, at_front=bool(job.enqueue_at_front)
                        )
                        registry.remove(job, pipeline=pipeline)
                pipeline.execute()
        self._status = self.Status.STARTED


class ClusterWorker(Worker):
    queue_class = ClusterQueue
    job_class = ClusterJob
    connection: RedisCluster
    redis_workers_keys = "rq:{rq}:workers"
    redis_worker_namespace_prefix = "rq:{rq}:worker:"

    @property
    def pubsub_channel_name(self):
        return f"rq:{{rq}}:pubsub:{self.name}"

    def _start_scheduler(
        self,
        burst: bool = False,
        logging_level: str = "INFO",
        date_format: str = DEFAULT_LOGGING_DATE_FORMAT,
        log_format: str = DEFAULT_LOGGING_FORMAT,
    ):
        self.scheduler = ClusterRQScheduler(
            self.queues,
            connection=self.connection,
            logging_level=logging_level,
            date_format=date_format,
            log_format=log_format,
            serializer=self.serializer,
        )

        self.scheduler.acquire_locks()
        if self.scheduler.acquired_locks:
            if burst:
                self.scheduler.enqueue_scheduled_jobs()
                self.scheduler.release_locks()
            else:
                self.scheduler.start()

    def _set_connection(self, connection: RedisCluster) -> RedisCluster:
        try:
            current_socket_timeout = connection.connection_pool.connection_kwargs.get(
                "socket_timeout"
            )
            if current_socket_timeout is None:
                timeout_config = {"socket_timeout": self.connection_timeout}
                connection.connection_pool.connection_kwargs.update(timeout_config)
            return connection
        except AttributeError:
            manager = connection.nodes_manager
            current_socket_timeout = manager.connection_kwargs.get("socket_timeout")
            if current_socket_timeout is None:
                timeout_config = {"socket_timeout": self.connection_timeout}
                manager.connection_kwargs.update(timeout_config)

            for node in connection.get_nodes():
                redis_connection = node.redis_connection
                if redis_connection is None:
                    continue

                current_socket_timeout = (
                    redis_connection.connection_pool.connection_kwargs.get(
                        "socket_timeout"
                    )
                )
                if current_socket_timeout is None:
                    timeout_config = {"socket_timeout": self.connection_timeout}
                    node.redis_connection.connection_pool.connection_kwargs.update(
                        timeout_config
                    )
            return connection

    def prepare_job_execution(
        self, job: "Job", remove_from_intermediate_queue: bool = False
    ):
        self.log.debug("Preparing for execution of Job ID %s", job.id)
        with cast_cluster_pipeline(self.connection) as pipeline:
            self.set_current_job_id(job.id, pipeline=pipeline)
            self.set_current_job_working_time(0, pipeline=pipeline)

            heartbeat_ttl = self.get_heartbeat_ttl(job)
            self.heartbeat(heartbeat_ttl, pipeline=pipeline)
            job.heartbeat(utcnow(), heartbeat_ttl, pipeline=pipeline)

            job.prepare_for_execution(self.name, pipeline=pipeline)
            if remove_from_intermediate_queue:
                queue = ClusterQueue(job.origin, connection=self.connection)
                pipeline.lrem(queue.intermediate_queue_key, 1, job.id)
            pipeline.execute()
            self.log.debug("Job preparation finished.")

        msg = "Processing {0} from {1} since {2}"
        self.procline(msg.format(job.func_name, job.origin, time.time()))

    def handle_job_success(
        self, job: "Job", queue: "Queue", started_job_registry: StartedJobRegistry
    ):
        self.log.debug("Handling successful execution of job %s", job.id)

        while True:
            pipe = cast_cluster_pipeline(self.connection, transaction=True)
            try:
                pipe.watch(job.dependents_key)
                queue.enqueue_dependents(job, pipeline=pipe)
                pipe.execute()

                pipeline = cast_cluster_pipeline(self.connection)

                self.log.info(
                    f"Pipeline: {pipeline} for handling successful job {job.id}"
                )

                self.set_current_job_id(None, pipeline=pipeline)
                self.increment_successful_job_count(pipeline=pipeline)
                self.increment_total_working_time(job.ended_at - job.started_at, pipeline)  # type: ignore

                result_ttl = job.get_result_ttl(self.default_result_ttl)
                if result_ttl != 0:
                    self.log.debug(
                        "Saving job %s's successful execution result", job.id
                    )
                    job._handle_success(result_ttl, pipeline=pipeline)

                job.cleanup(result_ttl, pipeline=pipeline, remove_from_queue=False)
                self.log.debug("Removing job %s from StartedJobRegistry", job.id)
                started_job_registry.remove(job, pipeline=pipeline)

                pipeline.execute()
                self.log.debug(
                    "Finished handling successful execution of job %s", job.id
                )
                break
            except WatchError:
                continue


def get_key(job_id):
    return f"{{rq}}:results:{job_id}"


def base_registry_init(  # noqa
    self,
    name: str = "default",
    connection: type["Redis"] | None = None,
    job_class: type["Job"] | None = None,
    queue: type["Queue"] | None = None,
    serializer: Any = None,
    death_penalty_class: type[BaseDeathPenalty] | None = None,
):
    if queue:
        self.name = queue.name
        self.connection = queue.connection
        self.serializer = queue.serializer
    else:
        self.name = name
        self.connection = connection
        self.serializer = resolve_serializer(serializer)

    self.key_template = self.key_template.replace(":{0}", "")

    self.key = f"{self.key_template}:{self.name}"
    self.job_class = backend_class(self, "job_class", override=job_class)
    self.death_penalty_class = backend_class(
        self, "death_penalty_class", override=death_penalty_class
    )


def init_module_cluster_compatibility():
    import rq.results  # noqa

    sys.modules["rq.registry"].__dict__["REDIS_WORKER_KEYS"] = "rq:{rq}:workers"  # type: ignore
    sys.modules["rq.registry"].__dict__["WORKERS_BY_QUEUE_KEY"] = "rq:{rq}:workers:%s"  # type: ignore
    sys.modules["rq.suspension"].__dict__["WORKERS_SUSPENDED"] = "rq:{rq}:suspended"  # type: ignore
    sys.modules["rq.results"].__dict__["get_key"] = get_key  # type: ignore

    for call_name in [
        "BaseRegistry",
        "StartedJobRegistry",
        "FinishedJobRegistry",
        "FailedJobRegistry",
        "DeferredJobRegistry",
        "ScheduledJobRegistry",
        "CanceledJobRegistry",
    ]:
        cls = sys.modules["rq.registry"].__dict__[call_name]
        cls.key_template = cls.key_template.replace("rq:", "rq:{rq}:")
        cls.__init__ = base_registry_init  # type: ignore
        sys.modules["rq.registry"].__dict__[call_name] = cls


if (
    settings.REDIS_CLUSTER_MODE or settings.REDIS_RQ_HASH_TAGS
) and not settings.IS_WORKER_CONTAINER:
    init_module_cluster_compatibility()
