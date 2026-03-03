import { useState } from "react"
import "./App.css"

export default function App() {
  const [text, setText] = useState("")
  const [notes, setNotes] = useState(["Ship MVP", "Fix auth warning"])

  const addNote = () => {
    const value = text.trim()
    if (!value) return
    setNotes((prev) => [value, ...prev])
    setText("")
  }

  return (
    <main className="app">
      <h1>Notes Board</h1>
      <div className="row">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write a note..."
        />
        <button onClick={addNote}>Add</button>
      </div>
      <ul>
        {notes.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
    </main>
  )
}