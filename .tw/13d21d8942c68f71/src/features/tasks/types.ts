export type Priority = "low" | "medium" | "high"

export type Task = {
  id: number
  title: string
  done: boolean
  priority: Priority
}