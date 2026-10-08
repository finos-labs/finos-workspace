"""Endpoints hit at regularly frequencies to run jobs"""

from fastapi import APIRouter, Depends

from api import auth_helpers, worker_tasks
from utilities import workers_queue

router = APIRouter(prefix="/run-tasks", tags=["run_tasks"])


@router.get("/delete-old-saves")
async def delete_old_saves(_=Depends(auth_helpers.check_lambda)):
    await workers_queue.worker_queue(worker_tasks.delete_old_saves, "delete_old_saves")
    return 200
