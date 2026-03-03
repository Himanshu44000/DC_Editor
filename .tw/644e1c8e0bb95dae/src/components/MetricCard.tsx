type Props = {
  title: string
  value: string | number
}

export default function MetricCard({ title, value }: Props) {
  return (
    <div className="metric">
      <p>{title}</p>
      <h3>{value}</h3>
    </div>
  )
}