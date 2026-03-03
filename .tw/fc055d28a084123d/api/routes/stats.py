from fastapi import APIRouter
from schemas.task import TaskStatsOut
from services.task_store import task_store

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("", response_model=TaskStatsOut)
def get_stats() -> TaskStatsOut:
    return task_store.stats()