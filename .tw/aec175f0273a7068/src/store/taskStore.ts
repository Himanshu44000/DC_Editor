import type { Task } from '../types/task.js'

let nextId = 3
const tasks: Task[] = [
  { id: 1, title: 'Read docs', done: false },
  { id: 2, title: 'Ship feature', done: true },
]

export const listTasks = (): Task[] => tasks
export const addTask = (title: string): Task => {
  const task: Task = { id: nextId++, title: title.trim(), done: false }
  tasks.push(task)
  return task
}
export const toggleTask = (id: number): Task | null => {
  const task = tasks.find((t) => t.id === id)
  if (!task) return null
  task.done = !task.done
  return task
}