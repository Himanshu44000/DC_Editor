import ProductivityDashboard from '../components/ProductivityDashboard'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <ProductivityDashboard />
      </div>
    </main>
  )
}