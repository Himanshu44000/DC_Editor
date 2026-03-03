import { useMemo, useState } from "react"
import ProductCard from "./components/ProductCard"
import { products, type Product } from "./data/products"
import "./App.css"

export default function App() {
  const [query, setQuery] = useState("")
  const [cart, setCart] = useState<Product[]>([])

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products
    return products.filter((item) => item.name.toLowerCase().includes(q))
  }, [query])

  const totalPrice = cart.reduce((sum, item) => sum + item.price, 0)

  return (
    <main className="container">
      <h1>Mini Store Dashboard</h1>

      <input
        className="search"
        placeholder="Search product..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <section className="grid">
        {filteredProducts.map((item) => (
          <ProductCard
            key={item.id}
            item={item}
            onAdd={(product) => setCart((prev) => [...prev, product])}
          />
        ))}
      </section>

      <hr />

      <section className="summary">
        <h2>Cart: {cart.length} items</h2>
        <p>Total: ₹{totalPrice}</p>
      </section>
    </main>
  )
}