from fastapi import APIRouter, HTTPException, Query
from schemas.task import TaskCreate, TaskListOut, TaskOut, TaskPriority, TaskUpdate
from services.task_store import task_store

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=TaskListOut)
def list_tasks(
    done: bool | None = Query(default=None),
    priority: TaskPriority | None = Query(default=None),
    q: str | None = Query(default=None, description="search in title/description"),
) -> TaskListOut:
    items = task_store.list_tasks(done=done, priority=priority, q=q)
    return TaskListOut(total=len(items), items=items)


@router.post("", response_model=TaskOut, status_code=201)
def create_task(payload: TaskCreate) -> TaskOut:
    return task_store.create_task(payload)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: str) -> TaskOut:
    task = task_store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: str, payload: TaskUpdate) -> TaskOut:
    task = task_store.update_task(task_id, payload)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.delete("/{task_id}")
def delete_task(task_id: str) -> dict[str, str]:
    deleted = task_store.delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}