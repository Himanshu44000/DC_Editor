'use client'

import { useEffect, useMemo, useState } from 'react'
import { readJSON, writeJSON } from '../lib/storage'

type Priority = 'low' | 'medium' | 'high'
type Filter = 'all' | 'open' | 'done'

type Task = {
  id: string
  title: string
  details: string
  priority: Priority
  done: boolean
  createdAt: number
}

const TASKS_KEY = 'next_productivity_tasks_v1'
const NOTES_KEY = 'next_productivity_notes_v1'

function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function ProductivityDashboard() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking')

  useEffect(() => {
    setTasks(readJSON<Task[]>(TASKS_KEY, []))
    setNotes(readJSON<string>(NOTES_KEY, ''))
  }, [])

  useEffect(() => {
    writeJSON(TASKS_KEY, tasks)
  }, [tasks])

  useEffect(() => {
    writeJSON(NOTES_KEY, notes)
  }, [notes])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    if (running) {
      timer = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            setRunning(false)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [running])

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? setApiStatus('ok') : setApiStatus('error')))
      .catch(() => setApiStatus('error'))
  }, [])

  const stats = useMemo(() => {
    const total = tasks.length
    const done = tasks.filter((t) => t.done).length
    const open = total - done
    const high = tasks.filter((t) => t.priority === 'high' && !t.done).length
    return { total, done, open, high }
  }, [tasks])

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks
      .filter((t) => {
        if (filter === 'open') return !t.done
        if (filter === 'done') return t.done
        return true
      })
      .filter((t) => (q ? t.title.toLowerCase().includes(q) || t.details.toLowerCase().includes(q) : true))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [tasks, filter, search])

  const addTask = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    const next: Task = {
      id: uid(),
      title: trimmed,
      details: details.trim(),
      priority,
      done: false,
      createdAt: Date.now(),
    }
    setTasks((prev) => [next, ...prev])
    setTitle('')
    setDetails('')
    setPriority('medium')
  }

  const toggleTask = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
  }

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  const priorityBadge: Record<Priority, string> = {
    low: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    high: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">FlowDesk</h1>
          <p className="text-slate-300">Tasks, notes, and focus timer in one clean workspace.</p>
        </div>
        <div
          className={`rounded-full border px-3 py-1 text-sm ${
            apiStatus === 'ok'
              ? 'border-emerald-500/40 text-emerald-300'
              : apiStatus === 'error'
              ? 'border-rose-500/40 text-rose-300'
              : 'border-slate-600 text-slate-300'
          }`}
        >
          API: {apiStatus}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Total Tasks" value={stats.total} />
        <Stat title="Open" value={stats.open} />
        <Stat title="Done" value={stats.done} />
        <Stat title="High Priority Open" value={stats.high} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={addTask} className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 lg:col-span-2">
          <h2 className="text-lg font-semibold text-white">Add Task</h2>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          />
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Details (optional)"
            className="min-h-[90px] w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
            >
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <button className="rounded-md bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400">
              Add Task
            </button>
          </div>
        </form>

        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold text-white">Focus Timer</h2>
          <p className="text-4xl font-bold text-cyan-300">{formatTime(secondsLeft)}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setRunning((prev) => !prev)}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-slate-100 hover:border-cyan-400"
            >
              {running ? 'Pause' : 'Start'}
            </button>
            <button
              onClick={() => {
                setRunning(false)
                setSecondsLeft(25 * 60)
              }}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-slate-100 hover:border-cyan-400"
            >
              Reset
            </button>
          </div>
          <p className="text-sm text-slate-400">Tip: complete one task before reset for best flow.</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="min-w-[180px] flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="done">Done</option>
            </select>
          </div>

          <div className="space-y-2">
            {visibleTasks.length === 0 ? (
              <div className="rounded-md border border-slate-700 p-4 text-slate-300">No matching tasks.</div>
            ) : (
              visibleTasks.map((task) => (
                <div key={task.id} className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className={`font-semibold ${task.done ? 'line-through text-slate-500' : 'text-slate-100'}`}>
                        {task.title}
                      </h3>
                      {task.details && <p className="text-sm text-slate-300">{task.details}</p>}
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-xs ${priorityBadge[task.priority]}`}>
                      {task.priority}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => toggleTask(task.id)}
                      className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:border-cyan-400"
                    >
                      {task.done ? 'Mark Open' : 'Mark Done'}
                    </button>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="rounded-md border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold text-white">Quick Notes</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Capture ideas, blockers, and next steps..."
            className="min-h-[280px] w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
          />
        </div>
      </section>
    </div>
  )
}

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <p className="text-sm text-slate-300">{title}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  )
}