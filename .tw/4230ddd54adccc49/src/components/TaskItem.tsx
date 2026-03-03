import type { Task } from '../types'

type Props = {
  task: Task
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}

const badgeByPriority: Record<Task['priority'], string> = {
  low: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  high: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
}

export default function TaskItem({ task, onToggle, onDelete }: Props) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={`text-lg font-semibold ${task.done ? 'line-through text-slate-500' : 'text-slate-100'}`}>
            {task.title}
          </h3>
          {task.description && <p className="mt-1 text-sm text-slate-300">{task.description}</p>}
        </div>
        <span className={`rounded-full border px-2 py-1 text-xs ${badgeByPriority[task.priority]}`}>
          {task.priority}
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onToggle(task.id)}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:border-cyan-400"
        >
          {task.done ? 'Mark Undone' : 'Mark Done'}
        </button>
        <button
          onClick={() => onDelete(task.id)}
          className="rounded-md border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10"
        >
          Delete
        </button>
      </div>
    </div>
  )
}