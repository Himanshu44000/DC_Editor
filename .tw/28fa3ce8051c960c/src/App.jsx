import { useMemo, useState } from "react"
import "./App.css"

const seed = ["Walk 20 min", "Read 10 pages", "Drink 2L water"]

export default function App() {
  const [done, setDone] = useState({})
  const completed = useMemo(() => Object.values(done).filter(Boolean).length, [done])

  return (
    <main className="app">
      <h1>Habit Tracker</h1>
      {seed.map((h) => (
        <label key={h} className="item">
          <input type="checkbox" checked={!!done[h]} onChange={() => setDone((p) => ({ ...p, [h]: !p[h] }))} />
          <span>{h}</span>
        </label>
      ))}
      <p>Completed: {completed}/{seed.length}</p>
    </main>
  )
}