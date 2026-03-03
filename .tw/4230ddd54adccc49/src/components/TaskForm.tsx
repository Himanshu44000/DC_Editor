import { useState } from 'react'
import type { Priority } from '../types'

type Props = {
  onAdd: (title: string, description: string, priority: Priority) => void
}

export default function TaskForm({ onAdd }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onAdd(trimmed, description.trim(), priority)
    setTitle('')
    setDescription('')
    setPriority('medium')
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Task title"
        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Short description (optional)"
        className="min-h-[90px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
      />
      <div className="flex items-center gap-3">
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
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
  )
}