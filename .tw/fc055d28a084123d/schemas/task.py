from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field


class TaskPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    priority: TaskPriority = TaskPriority.medium
    tags: list[str] = Field(default_factory=list)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    priority: TaskPriority | None = None
    done: bool | None = None
    tags: list[str] | None = None


class TaskOut(BaseModel):
    id: str
    title: str
    description: str
    priority: TaskPriority
    done: bool
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class TaskListOut(BaseModel):
    total: int
    items: list[TaskOut]


class TaskStatsOut(BaseModel):
    total: int
    open: int
    done: int
    high_priority_open: int