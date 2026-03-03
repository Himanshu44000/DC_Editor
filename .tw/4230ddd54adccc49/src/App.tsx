import { useMemo, useState } from 'react'
import TaskForm from './components/TaskForm'
import TaskItem from './components/TaskItem'
import { loadTasks, saveTasks } from './lib/storage'
import type { Priority, Task } from './types'

type Filter = 'all' | 'open' | 'done'

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all')

  const updateTasks = (next: Task[]) => {
    setTasks(next)
    saveTasks(next)
  }

  const addTask = (title: string, description: string, priority: Priority) => {
    const next: Task[] = [
      {
        id: createId(),
        title,
        description,
        priority,
        done: false,
        createdAt: Date.now(),
      },
      ...tasks,
    ]
    updateTasks(next)
  }

  const toggleTask = (id: string) => {
    updateTasks(tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  }

  const deleteTask = (id: string) => {
    updateTasks(tasks.filter((task) => task.id !== id))
  }

  const filtered = useMemo(() => {
    return tasks
      .filter((task) => {
        if (filter === 'open') return !task.done
        if (filter === 'done') return task.done
        return true
      })
      .filter((task) => (priorityFilter === 'all' ? true : task.priority === priorityFilter))
      .filter((task) => {
        const q = search.trim().toLowerCase()
        if (!q) return true
        return task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q)
      })
  }, [tasks, filter, priorityFilter, search])

  const stats = useMemo(() => {
    const total = tasks.length
    const done = tasks.filter((task) => task.done).length
    const open = total - done
    const high = tasks.filter((task) => task.priority === 'high').length
    return { total, open, done, high }
  }, [tasks])

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">PulseBoard</h1>
          <p className="text-slate-300">Task dashboard with search, filters, priority tags, and local persistence.</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total" value={stats.total} />
          <Stat label="Open" value={stats.open} />
          <Stat label="Done" value={stats.done} />
          <Stat label="High Priority" value={stats.high} />
        </section>

        <TaskForm onAdd={addTask} />

        <section className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 md:grid-cols-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks..."
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          />
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          >
            <option value="all">All tasks</option>
            <option value="open">Open only</option>
            <option value="done">Done only</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as 'all' | Priority)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          >
            <option value="all">All priorities</option>
            <option value="low">Low only</option>
            <option value="medium">Medium only</option>
            <option value="high">High only</option>
          </select>
        </section>

        <section className="grid gap-3">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-6 text-slate-300">
              No tasks match current filters.
            </div>
          ) : (
            filtered.map((task) => (
              <TaskItem key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} />
            ))
          )}
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <p className="text-sm text-slate-300">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}