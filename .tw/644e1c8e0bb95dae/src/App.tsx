import { useState } from "react"
import MetricCard from "./components/MetricCard"
import { averageExpense, expenses, totalExpense, type Expense } from "./lib/calc"
import "./App.css"

export default function App() {
  const [items, setItems] = useState<Expense[]>(expenses)
  const [label, setLabel] = useState("")
  const [amount, setAmount] = useState("")

  const addExpense = () => {
    const value = Number(amount)
    if (!label.trim() || !Number.isFinite(value) || value <= 0) return
    setItems(prev => [...prev, { id: Date.now(), label: label.trim(), amount: value }])
    setLabel("")
    setAmount("")
  }

  return (
    <main className="container">
      <h1>Expense Insights</h1>

      <section className="metrics">
        <MetricCard title="Total" value={`₹${totalExpense(items)}`} />
        <MetricCard title="Average" value={`₹${averageExpense(items)}`} />
        <MetricCard title="Entries" value={items.length} />
      </section>

      <section className="form">
        <input placeholder="Expense label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button onClick={addExpense}>Add</button>
      </section>

      <ul className="list">
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.label}</span>
            <strong>₹{item.amount}</strong>
          </li>
        ))}
      </ul>
    </main>
  )
}