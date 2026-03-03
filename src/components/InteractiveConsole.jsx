import { useState, useRef, useEffect } from 'react'
import '../styles/InteractiveConsole.css'

const InteractiveConsole = ({ isRunning, runStatus = 'idle', onInput, output }) => {
  const [history, setHistory] = useState([])           // Complete lines (ended with \n)
  const [incompleteLine, setIncompleteLine] = useState('')  // Prompt waiting for input (no \n)
  const [userInput, setUserInput] = useState('')       // What user is currently typing
  const [lastProcessedOutput, setLastProcessedOutput] = useState('')  // Track what we've processed
  const consoleRef = useRef(null)
  const inputRef = useRef(null)

  // Reset when running starts
  useEffect(() => {
    if (isRunning) {
      setHistory([])
      setIncompleteLine('')
      setUserInput('')
      setLastProcessedOutput('')
    }
  }, [isRunning])

  // Process output: separate complete lines from incomplete lines
  useEffect(() => {
    if (!output || output === lastProcessedOutput) return
    
    // Get only the new part that we haven't processed yet
    const newOutput = output.slice(lastProcessedOutput.length)
    
    // Combine with previous incomplete line
    const fullText = incompleteLine + newOutput
    
    // Check if the full accumulated output ends with newline
    const endsWithNewline = output.endsWith('\n')
    const lines = fullText.split('\n')
    
    if (endsWithNewline) {
      // All lines are complete
      const completeLines = lines.slice(0, -1)
      if (completeLines.length > 0) {
        setHistory((prev) => [...prev, ...completeLines])
      }
      setIncompleteLine('')
    } else {
      // Last line is incomplete
      const completeLines = lines.slice(0, -1)
      const incomplete = lines[lines.length - 1] || ''
      
      if (completeLines.length > 0) {
        setHistory((prev) => [...prev, ...completeLines])
      }
      
      setIncompleteLine(incomplete)
    }
    
    // Track that we've processed this output
    setLastProcessedOutput(output)
  }, [output, lastProcessedOutput, incompleteLine])

  // Auto-scroll to bottom
  useEffect(() => {
    if (consoleRef.current) {
      setTimeout(() => {
        consoleRef.current.scrollTop = consoleRef.current.scrollHeight
      }, 0)
    }
  }, [history, incompleteLine, userInput])

  // Focus input when running
  useEffect(() => {
    if (isRunning && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isRunning])

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && isRunning) {
      e.preventDefault()
      
      // Combine incomplete line (prompt) with user input
      const completedLine = incompleteLine + userInput
      
      // Add to history
      setHistory((prev) => [...prev, completedLine])
      
      // Send only the input part to backend (not the prompt)
      if (onInput) {
        onInput(userInput)
      }
      
      // Reset for next input
      setIncompleteLine('')
      setUserInput('')
    }
  }

  const handleInputChange = (e) => {
    if (isRunning) {
      setUserInput(e.target.value)
    }
  }

  // When program finishes, move any remaining incomplete line to history
  useEffect(() => {
    if (!isRunning && incompleteLine.length > 0) {
      setHistory((prev) => [...prev, incompleteLine])
      setIncompleteLine('')
    }
  }, [isRunning, incompleteLine])

  const statusLabel =
    runStatus === 'queued'
      ? 'Queued'
      : runStatus === 'running'
        ? 'Running'
        : runStatus === 'completed'
          ? 'Completed'
          : runStatus === 'failed'
            ? 'Failed'
            : 'Idle'

  return (
    <div className="terminal-console">
      <div className={`console-status console-status--${runStatus}`}>
        <span className="console-status-dot" />
        {statusLabel}
      </div>

      <div className="console-output" ref={consoleRef}>
        {/* Display all completed lines */}
        {history.map((line, idx) => (
          <div key={idx} className="console-line">
            {line}
          </div>
        ))}
        
        {/* Current line with prompt + input field on same line - only when running */}
        {isRunning && (
          <div className="current-line">
            <span className="console-prompt">{incompleteLine}</span>
            <input
              ref={inputRef}
              type="text"
              className="console-input"
              value={userInput}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              autoComplete="off"
              spellCheck="false"
              autoFocus
            />
            <span className="cursor" />
          </div>
        )}

        {/* When finished, show completion message */}
        {!isRunning && history.length > 0 && (
          <div className="console-line finished" />
        )}
      </div>

    </div>
  )
}

export default InteractiveConsole
