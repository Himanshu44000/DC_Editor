import express from 'express'

const app = express()
const port = Number(process.env.PORT || 3000)

app.use(express.json())

app.get('/health', (_, res) => res.json({ ok: true }))
app.get('/', (_, res) => res.json({ message: 'Node + Express starter is running' }))

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
