"use client"

import { useMemo, useState } from "react"

const seed = [
  { id: 1, title: "Design API contract", status: "open" },
  { id: 2, title: "Fix auth redirect", status: "done" },
  { id: 3, title: "Add metrics widget", status: "open" },
]

export default function Home() {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState(seed)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((x) => x.title.toLowerCase().includes(q))
  }, [query, items])

  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px" }}>
      <h1>Next Project Tracker</h1>
      <input
        placeholder="Search task..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", padding: 10, margin: "12px 0" }}
      />
      {filtered.map((item) => (
        <div key={item.id} style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <strong>{item.title}</strong>
          <p>Status: {item.status}</p>
          <button
            onClick={() =>
              setItems((prev) =>
                prev.map((p) => (p.id === item.id ? { ...p, status: p.status === "open" ? "done" : "open" } : p)),
              )
            }
          >
            Toggle
          </button>
        </div>
      ))}
    </main>
  )
}