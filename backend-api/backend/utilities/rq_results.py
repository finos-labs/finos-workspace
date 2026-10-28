import asyncio
import re

from rq.job import JobStatus

from utilities.config import settings

if settings.REDIS_CLUSTER_MODE or settings.REDIS_RQ_HASH_TAGS:
    from rq import worker_registration

    from utilities.rq_cluster import ClusterQueue as Queue

    worker_registration.REDIS_WORKER_KEYS = "rq:{rq}:workers"  # type: ignore
    worker_registration.WORKERS_BY_QUEUE_KEY = "rq:{rq}:workers:%s"  # type: ignore
else:
    from rq import Queue

redis_conn_bots = settings.get_redis_session("bot")
rq_que = Queue(name="payments_queue", connection=redis_conn_bots, failure_ttl=5)

JOB_STATUSES = {
    JobStatus.CANCELED,
    JobStatus.FAILED,
    JobStatus.FINISHED,
    JobStatus.SCHEDULED,
    JobStatus.STOPPED,
}


async def get_results(sleep: int, job_key):
    j = rq_que.fetch_job(job_key)

    while (job_status := j.get_status()) not in JOB_STATUSES:
        await asyncio.sleep(sleep)

    if job_status == "finished":
        return j.result
    if job_status == "failed":
        exc_str = j.exc_info
        exc_info = re.sub(r"\\n", "\n", exc_str)

        rq_que.remove(j)

        # pylint: disable=broad-exception-raised
        raise Exception(exc_info)  # type: ignore  # noqa

    if job_status == "scheduled":
        return True

    return None
