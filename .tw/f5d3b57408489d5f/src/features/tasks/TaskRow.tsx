import type { Task } from "./types"

type Props = {
  task: Task
  onToggle: (id: number) => void
}

export default function TaskRow({ task, onToggle }: Props) {
  return (
    <li className="task-row">
      <label>
        <input type="checkbox" checked={task.done} onChange={() => onToggle(task.id)} />
        <span className={task.done ? "done" : ""}>{task.title}</span>
      </label>
      <small>{task.priority.toUpperCase()}</small>
    </li>
  )
}