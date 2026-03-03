import type { Product } from "../data/products"

type Props = {
  item: Product
  onAdd: (product: Product) => void
}

export default function ProductCard({ item, onAdd }: Props) {
  return (
    <article className="card">
      <h3>{item.name}</h3>
      <p>Category: {item.category}</p>
      <p>Price: ₹{item.price}</p>
      <button onClick={() => onAdd(item)}>Add to cart</button>
    </article>
  )
}