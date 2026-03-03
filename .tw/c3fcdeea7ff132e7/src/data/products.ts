export type Product = {
  id: number
  name: string
  price: number
  category: string
}

export const products: Product[] = [
  { id: 1, name: "Mechanical Keyboard", price: 3499, category: "Accessories" },
  { id: 2, name: "Wireless Mouse", price: 1999, category: "Accessories" },
  { id: 3, name: "27 inch Monitor", price: 15999, category: "Displays" },
  { id: 4, name: "USB-C Hub", price: 2499, category: "Adapters" },
]