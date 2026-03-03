import { useMemo, useState } from "react"
import TaskRow from "./features/tasks/TaskRow"
import { seedTasks } from "./features/tasks/data"
import type { Task } from "./features/tasks/types"
import "./App.css"

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(seedTasks)
  const [filter, setFilter] = useState<"all" | "open" | "done">("all")

  const visible = useMemo(() => {
    if (filter === "open") return tasks.filter(t => !t.done)
    if (filter === "done") return tasks.filter(t => t.done)
    return tasks
  }, [tasks, filter])

  const doneCount = tasks.filter(t => t.done).length

  return (
    <main className="wrap">
      <h1>Sprint Task Tracker</h1>

      <div className="filters">
        <button onClick={() => setFilter("all")}>All</button>
        <button onClick={() => setFilter("open")}>Open</button>
        <button onClick={() => setFilter("done")}>Done</button>
      </div>

      <ul>
        {visible.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            onToggle={(id) =>
              setTasks(prev => prev.map(t => (t.id === id ? { ...t, done: !t.done } : t)))
            }
          />
        ))}
      </ul>

      <p>Completed: {doneCount}/{tasks.length}</p>
    </main>
  )
}