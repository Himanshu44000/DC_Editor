import type { Task } from "./types"

export const seedTasks: Task[] = [
  { id: 1, title: "Write API docs", done: false, priority: "high" },
  { id: 2, title: "Refactor auth hook", done: true, priority: "medium" },
  { id: 3, title: "Add loading skeleton", done: false, priority: "low" },
]