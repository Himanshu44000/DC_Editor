from datetime import datetime, timezone
from uuid import uuid4
from schemas.task import TaskCreate, TaskOut, TaskPriority, TaskUpdate, TaskStatsOut


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class TaskStore:
    def __init__(self) -> None:
        self._tasks: dict[str, TaskOut] = {}

    def list_tasks(
        self,
        done: bool | None = None,
        priority: TaskPriority | None = None,
        q: str | None = None,
    ) -> list[TaskOut]:
        items = list(self._tasks.values())

        if done is not None:
            items = [t for t in items if t.done == done]

        if priority is not None:
            items = [t for t in items if t.priority == priority]

        if q:
            needle = q.strip().lower()
            if needle:
                items = [
                    t for t in items
                    if needle in t.title.lower() or needle in t.description.lower()
                ]

        items.sort(key=lambda x: x.updated_at, reverse=True)
        return items

    def create_task(self, payload: TaskCreate) -> TaskOut:
        ts = now_utc()
        task = TaskOut(
            id=str(uuid4()),
            title=payload.title.strip(),
            description=payload.description.strip(),
            priority=payload.priority,
            done=False,
            tags=payload.tags,
            created_at=ts,
            updated_at=ts,
        )
        self._tasks[task.id] = task
        return task

    def get_task(self, task_id: str) -> TaskOut | None:
        return self._tasks.get(task_id)

    def update_task(self, task_id: str, payload: TaskUpdate) -> TaskOut | None:
        current = self._tasks.get(task_id)
        if not current:
            return None

        data = current.model_dump()
        patch = payload.model_dump(exclude_unset=True)

        for key, value in patch.items():
            data[key] = value

        data["updated_at"] = now_utc()
        updated = TaskOut(**data)
        self._tasks[task_id] = updated
        return updated

    def delete_task(self, task_id: str) -> bool:
        return self._tasks.pop(task_id, None) is not None

    def stats(self) -> TaskStatsOut:
        items = list(self._tasks.values())
        total = len(items)
        done = sum(1 for t in items if t.done)
        open_tasks = total - done
        high_priority_open = sum(
            1 for t in items if (not t.done and t.priority == TaskPriority.high)
        )
        return TaskStatsOut(
            total=total,
            open=open_tasks,
            done=done,
            high_priority_open=high_priority_open,
        )


task_store = TaskStore()