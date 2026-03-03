import { useState } from "react"
import "./App.css"

export default function App() {
  const [price, setPrice] = useState("")
  const [qty, setQty] = useState("")
  const total = (Number(price) || 0) * (Number(qty) || 0)

  return (
    <main className="app">
      <h1>Simple Invoice</h1>
      <div className="grid">
        <input placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} />
        <input placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <h2>Total: ₹{total}</h2>
    </main>
  )
}