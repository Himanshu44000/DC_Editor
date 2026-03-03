import { useState, useRef, useEffect } from 'react'
import { getSocket } from '../lib/socket'

const stripAnsi = (text = '') => {
  const source = String(text || '')
  let result = ''

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '\u001b' && next === '[') {
      index += 2
      while (index < source.length) {
        const code = source.charCodeAt(index)
        const isFinalByte = code >= 0x40 && code <= 0x7e
        if (isFinalByte) break
        index += 1
      }
      continue
    }

    result += char
  }

  return result
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g

const isWindowsHost = typeof navigator !== 'undefined' && /Win/i.test(String(navigator.platform || ''))

const TERMINAL_PROFILES = isWindowsHost
  ? [
      { id: 'powershell', label: 'PowerShell' },
      { id: 'cmd', label: 'Command Prompt' },
      { id: 'git-bash', label: 'Git Bash' },
    ]
  : [
      { id: 'bash', label: 'Bash' },
      { id: 'zsh', label: 'Zsh' },
      { id: 'sh', label: 'sh' },
    ]

const DEFAULT_TERMINAL_PROFILE_ID = TERMINAL_PROFILES[0]?.id || 'powershell'

const profileLabelById = new Map(TERMINAL_PROFILES.map((profile) => [profile.id, profile.label]))

const getTerminalProfileLabel = (profileId = '') =>
  profileLabelById.get(String(profileId || '').trim()) || profileLabelById.get(DEFAULT_TERMINAL_PROFILE_ID) || 'Shell'

let terminalIdCounter = 1
const nextTerminalId = () => {
  terminalIdCounter += 1
  return `terminal-${terminalIdCounter}`
}

const createTerminalState = (id, title, projectName = '', shellProfile = DEFAULT_TERMINAL_PROFILE_ID) => ({
  id,
  title,
  history: [{ type: 'system', text: `Terminal ready (${getTerminalProfileLabel(shellProfile)}). Run commands like npm install, npm run dev.` }],
  input: '',
  commandHistory: [],
  historyIndex: -1,
  isRunning: false,
  cwd: '',
  cwdDisplay: '/',
  projectName,
  completionSeed: '',
  completionSuggestions: [],
  completionIndex: -1,
  completionLastApplied: '',
  shellProfile,
})

const renderTextWithLinks = (text) => {
  const content = String(text || '')
  const parts = content.split(URL_REGEX)
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="terminal-link"
          title="Follow link (Ctrl + click)"
        >
          {part}
        </a>
      )
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

const Terminal = ({ projectId, projectName, token, userId, ownerId, sharedTerminalEnabled, isOwner, canEdit }) => {
  const [terminals, setTerminals] = useState(() => [createTerminalState('terminal-1', '1', projectName || '')])
  const [activeTerminalId, setActiveTerminalId] = useState('terminal-1')
  const [defaultProfileId, setDefaultProfileId] = useState(DEFAULT_TERMINAL_PROFILE_ID)
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [sharedReadOnly, setSharedReadOnly] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(() =>
    typeof window !== 'undefined' ? Math.max(240, Math.floor(window.innerHeight * 0.35)) : 320,
  )
  const [isResizing, setIsResizing] = useState(false)
  const terminalContainerRef = useRef(null)
  const terminalRef = useRef(null)
  const inputRef = useRef(null)
  const createMenuRef = useRef(null)
  const resizeStartYRef = useRef(0)
  const resizeStartHeightRef = useRef(0)
  const shouldAutoScrollRef = useRef(true)
  const terminalsRef = useRef(terminals)
  const latestProjectIdRef = useRef(projectId)
  const latestTokenRef = useRef(token)
  const latestCanEditRef = useRef(canEdit)

  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId) || terminals[0]
  const viewingOwnerId = sharedTerminalEnabled && !isOwner ? ownerId : userId
  const inputDisabled = sharedReadOnly || !canEdit
  const promptProjectName = activeTerminal?.projectName || projectName || 'project'
  const promptPath = activeTerminal?.cwdDisplay || '/'
  const promptLabel = `${promptProjectName}:${promptPath} $`
  const selectedProfileId = activeTerminal?.shellProfile || DEFAULT_TERMINAL_PROFILE_ID

  const updateTerminal = (terminalId, updater) => {
    setTerminals((prev) => prev.map((terminal) => (terminal.id === terminalId ? updater(terminal) : terminal)))
  }

  useEffect(() => {
    if (terminalRef.current && shouldAutoScrollRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [terminals, activeTerminalId])

  useEffect(() => {
    terminalsRef.current = terminals
  }, [terminals])

  useEffect(() => {
    latestProjectIdRef.current = projectId
    latestTokenRef.current = token
    latestCanEditRef.current = canEdit
  }, [projectId, token, canEdit])

  useEffect(() => {
    shouldAutoScrollRef.current = true
  }, [activeTerminalId])

  useEffect(() => {
    if (!isResizing) return undefined

    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'

    const onMouseMove = (event) => {
      const upwardDelta = resizeStartYRef.current - event.clientY

      const parentPanel = terminalContainerRef.current?.closest('.editor-panel')
      const parentHeight = parentPanel?.clientHeight || Math.floor(window.innerHeight * 0.8)
      const minHeight = 240
      const maxHeight = Math.max(280, parentHeight - 48)
      const nextHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartHeightRef.current + upwardDelta))
      setTerminalHeight(nextHeight)
    }

    const onMouseUp = () => {
      setIsResizing(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
    }
  }, [isResizing])

  useEffect(() => {
    if (!isCreateMenuOpen) return undefined

    const onClickOutside = (event) => {
      const menuNode = createMenuRef.current
      if (!menuNode) return
      if (menuNode.contains(event.target)) return
      setIsCreateMenuOpen(false)
    }

    window.addEventListener('mousedown', onClickOutside)
    return () => {
      window.removeEventListener('mousedown', onClickOutside)
    }
  }, [isCreateMenuOpen])

  useEffect(() => {
    if (inputRef.current) {
      try {
        inputRef.current.focus({ preventScroll: true })
      } catch {
        inputRef.current.focus()
      }
    }
  }, [activeTerminalId])

  useEffect(() => {
    const socket = getSocket(token)
    if (!socket) return

    const shouldHandlePayload = (payload) => {
      if (payload.projectId !== projectId) return false
      if (payload.terminalOwnerId && payload.terminalOwnerId !== viewingOwnerId) return false
      return true
    }

    const onStarted = (payload) => {
      if (!shouldHandlePayload(payload)) return
      updateTerminal(payload.terminalId || 'terminal-1', (terminal) => ({
        ...terminal,
        isRunning: true,
        shellProfile: payload.shellProfile || terminal.shellProfile,
        projectName: payload.projectName || terminal.projectName,
        cwd: payload.cwd || terminal.cwd,
        cwdDisplay: payload.cwdDisplay || terminal.cwdDisplay,
        history: [...terminal.history, { type: 'system', text: `Running: ${payload.command}` }],
      }))
    }

    const onOutput = (payload) => {
      if (!shouldHandlePayload(payload)) return
      const cleanText = stripAnsi(payload.text || '')
      if (!cleanText) return
      const type = payload.stream === 'stderr' ? 'error' : 'output-text'
      updateTerminal(payload.terminalId || 'terminal-1', (terminal) => ({
        ...terminal,
        history: [...terminal.history, { type, text: cleanText }],
      }))
    }

    const onExit = (payload) => {
      if (!shouldHandlePayload(payload)) return
      const codeText = payload.code == null ? 'unknown' : payload.code
      updateTerminal(payload.terminalId || 'terminal-1', (terminal) => ({
        ...terminal,
        isRunning: false,
        history: [...terminal.history, { type: 'system', text: `Process exited with code ${codeText}` }],
      }))
    }

    const onError = (payload) => {
      if (!shouldHandlePayload(payload)) return
      updateTerminal(payload.terminalId || 'terminal-1', (terminal) => ({
        ...terminal,
        isRunning: false,
        history: [...terminal.history, { type: 'error', text: payload.message || 'Terminal error' }],
      }))
    }

    const onCwd = (payload) => {
      if (!shouldHandlePayload(payload)) return
      updateTerminal(payload.terminalId || 'terminal-1', (terminal) => ({
        ...terminal,
        cwd: payload.cwd || terminal.cwd,
        cwdDisplay: payload.cwdDisplay || terminal.cwdDisplay,
        projectName: payload.projectName || terminal.projectName,
      }))
    }

    const onRestored = (payload) => {
      if (payload.projectId !== projectId) return
      const restored = payload.terminals || []
      setSharedReadOnly(Boolean(payload.sharedReadOnly))

      if (restored.length === 0) {
        setTerminals((prev) =>
          prev.length > 0
            ? prev.map((terminal) => ({ ...terminal, projectName: payload.projectName || terminal.projectName }))
            : [createTerminalState('terminal-1', '1', payload.projectName || projectName || '')],
        )
        return
      }

      setTerminals((prev) => {
        const nextTerminals = restored.map((entry, index) => {
          const existing = prev.find((terminal) => terminal.id === entry.terminalId)
          if (existing) {
            return {
              ...existing,
              title: existing.title || String(index + 1),
              isRunning: Boolean(entry.isRunning),
              shellProfile: entry.shellProfile || existing.shellProfile || DEFAULT_TERMINAL_PROFILE_ID,
              cwd: entry.cwd || existing.cwd,
              cwdDisplay: entry.cwdDisplay || existing.cwdDisplay || '/',
              projectName: payload.projectName || existing.projectName,
            }
          }

          return {
            ...createTerminalState(
              entry.terminalId,
              String(index + 1),
              payload.projectName || projectName || '',
              entry.shellProfile || DEFAULT_TERMINAL_PROFILE_ID,
            ),
            isRunning: Boolean(entry.isRunning),
            cwd: entry.cwd || '',
            cwdDisplay: entry.cwdDisplay || '/',
            history: [
              {
                type: 'system',
                text: entry.isRunning
                  ? 'Restored running terminal session.'
                  : 'Restored terminal session.',
              },
            ],
          }
        })

        setActiveTerminalId((currentId) => {
          if (nextTerminals.some((terminal) => terminal.id === currentId)) return currentId
          return nextTerminals[0].id
        })

        return nextTerminals
      })
    }

    socket.on('terminal:started', onStarted)
    socket.on('terminal:output', onOutput)
    socket.on('terminal:exit', onExit)
    socket.on('terminal:error', onError)
    socket.on('terminal:cwd', onCwd)
    socket.on('terminal:restored', onRestored)

    socket.emit('terminal:restore', { projectId })

    return () => {
      socket.off('terminal:started', onStarted)
      socket.off('terminal:output', onOutput)
      socket.off('terminal:exit', onExit)
      socket.off('terminal:error', onError)
      socket.off('terminal:cwd', onCwd)
      socket.off('terminal:restored', onRestored)
    }
  }, [projectId, token, viewingOwnerId, projectName])

  useEffect(() => {
    const emitStopAll = () => {
      const projectIdValue = latestProjectIdRef.current
      const tokenValue = latestTokenRef.current
      const canEditValue = latestCanEditRef.current
      if (!projectIdValue || !tokenValue || !canEditValue) return

      const socket = getSocket(tokenValue)
      if (!socket) return

      const runningTerminalIds = terminalsRef.current.filter((terminal) => terminal.isRunning).map((terminal) => terminal.id)
      if (runningTerminalIds.length === 0) return
      socket.emit('terminal:stop-all', { projectId: projectIdValue, terminalIds: runningTerminalIds })
    }

    const onBeforeUnload = () => {
      emitStopAll()
    }

    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      emitStopAll()
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  const executeCommand = async (command) => {
    if (!activeTerminal) return
    if (inputDisabled) return
    const trimmed = command.trim()
    if (!trimmed) return
    const hasRunPrefix = /^run\s+.+/i.test(trimmed)
    const normalizedCommand = trimmed.replace(/^run\s+(.+)$/i, '$1').trim()
    if (!normalizedCommand) return
    const isCdCommand = normalizedCommand === 'cd' || normalizedCommand.startsWith('cd ')

    updateTerminal(activeTerminal.id, (terminal) => ({
      ...terminal,
      history: [...terminal.history, { type: 'command', text: `${promptLabel} ${trimmed}` }],
      commandHistory: [...terminal.commandHistory, trimmed],
      historyIndex: -1,
      input: '',
      completionSeed: '',
      completionSuggestions: [],
      completionIndex: -1,
      completionLastApplied: '',
    }))

    if (normalizedCommand === 'clear') {
      updateTerminal(activeTerminal.id, (terminal) => ({
        ...terminal,
        history: [],
      }))
      return
    }

    const socket = getSocket(token)
    if (!socket) {
      updateTerminal(activeTerminal.id, (terminal) => ({
        ...terminal,
        history: [...terminal.history, { type: 'error', text: 'Terminal unavailable: backend socket disconnected.' }],
      }))
      return
    }

    if (activeTerminal.isRunning && hasRunPrefix && !isCdCommand) {
      const nextNumber = terminals.length + 1
      const forcedTerminalId = nextTerminalId()
      const forcedTerminal = createTerminalState(
        forcedTerminalId,
        String(nextNumber),
        projectName || '',
        activeTerminal.shellProfile || selectedProfileId || DEFAULT_TERMINAL_PROFILE_ID,
      )

      setTerminals((prev) => [
        ...prev,
        {
          ...forcedTerminal,
          history: [...forcedTerminal.history, { type: 'command', text: `${promptLabel} ${trimmed}` }],
          commandHistory: [trimmed],
        },
      ])
      setActiveTerminalId(forcedTerminalId)

      updateTerminal(activeTerminal.id, (terminal) => ({
        ...terminal,
        history: [...terminal.history, { type: 'system', text: `Opened in terminal ${nextNumber}: ${normalizedCommand}` }],
      }))

      socket.emit('terminal:run', {
        projectId,
        terminalId: forcedTerminalId,
        command: normalizedCommand,
        shellProfile: forcedTerminal.shellProfile,
      })
      return
    }

    if (activeTerminal.isRunning && !isCdCommand) {
      socket.emit('terminal:input', { projectId, terminalId: activeTerminal.id, input: normalizedCommand })
    } else {
      socket.emit('terminal:run', {
        projectId,
        terminalId: activeTerminal.id,
        command: normalizedCommand,
        shellProfile: activeTerminal.shellProfile || selectedProfileId || DEFAULT_TERMINAL_PROFILE_ID,
      })
    }
  }

  const stopCommand = () => {
    if (!activeTerminal) return
    if (inputDisabled) return
    const socket = getSocket(token)
    if (!socket) return
    const runningTerminalIds = terminals.filter((terminal) => terminal.isRunning).map((terminal) => terminal.id)
    if (runningTerminalIds.length === 0) {
      socket.emit('terminal:stop', { projectId, terminalId: activeTerminal.id })
    } else {
      socket.emit('terminal:stop-all', { projectId, terminalIds: runningTerminalIds })
    }
    updateTerminal(activeTerminal.id, (terminal) => ({
      ...terminal,
      history: [...terminal.history, { type: 'system', text: '^C' }],
    }))
  }

  const createTerminal = (profileId = defaultProfileId, splitFromTerminal = null) => {
    if (inputDisabled) return
    const nextNumber = terminals.length + 1
    const id = nextTerminalId()
    const nextProfileId = profileLabelById.has(profileId) ? profileId : DEFAULT_TERMINAL_PROFILE_ID
    const baseTerminal = splitFromTerminal || null
    const created = createTerminalState(id, String(nextNumber), projectName || '', nextProfileId)
    setTerminals((prev) => [
      ...prev,
      {
        ...created,
        cwd: baseTerminal?.cwd || created.cwd,
        cwdDisplay: baseTerminal?.cwdDisplay || created.cwdDisplay,
        projectName: baseTerminal?.projectName || created.projectName,
      },
    ])
    setActiveTerminalId(id)
  }

  const splitTerminal = () => {
    if (!activeTerminal) return
    createTerminal(activeTerminal.shellProfile || selectedProfileId || DEFAULT_TERMINAL_PROFILE_ID, activeTerminal)
  }

  const createTerminalWithProfile = (profileId) => {
    createTerminal(profileId)
    setIsCreateMenuOpen(false)
  }

  const renameTerminal = (terminalId) => {
    if (inputDisabled) return
    const selected = terminals.find((terminal) => terminal.id === terminalId)
    if (!selected) return
    const nextName = window.prompt('Rename terminal', selected.title)
    if (nextName == null) return
    const trimmedName = nextName.trim()
    if (!trimmedName) return
    updateTerminal(terminalId, (terminal) => ({
      ...terminal,
      title: trimmedName,
    }))
  }

  const closeTerminal = (terminalId) => {
    if (inputDisabled) return
    if (terminals.length === 1) return
    const closing = terminals.find((terminal) => terminal.id === terminalId)
    if (closing?.isRunning) {
      const socket = getSocket(token)
      socket?.emit('terminal:stop', { projectId, terminalId })
    }
    const next = terminals.filter((terminal) => terminal.id !== terminalId)
    setTerminals(next)
    if (activeTerminalId === terminalId) {
      setActiveTerminalId(next[0].id)
    }
  }

  const applyTabCompletion = (direction = 1) => {
    if (!activeTerminal || inputDisabled) return
    const normalizedInput = activeTerminal.input === 'cd' ? 'cd ' : activeTerminal.input

    if (
      activeTerminal.completionSuggestions.length > 0 &&
      activeTerminal.input === activeTerminal.completionLastApplied
    ) {
      const total = activeTerminal.completionSuggestions.length
      const nextIndex = (activeTerminal.completionIndex + direction + total) % total
      const nextValue = activeTerminal.completionSuggestions[nextIndex]
      updateTerminal(activeTerminal.id, (terminal) => ({
        ...terminal,
        input: nextValue,
        completionIndex: nextIndex,
        completionLastApplied: nextValue,
      }))
      return
    }

    const socket = getSocket(token)
    if (!socket) return

    socket.emit('terminal:complete', { projectId, terminalId: activeTerminal.id, input: normalizedInput }, (response) => {
      const suggestions = response?.suggestions || []
      if (!Array.isArray(suggestions) || suggestions.length === 0) return
      const initialIndex = direction === -1 ? suggestions.length - 1 : 0
      const nextValue = suggestions[initialIndex]
      updateTerminal(activeTerminal.id, (terminal) => ({
        ...terminal,
        input: nextValue,
        completionSeed: terminal.input,
        completionSuggestions: suggestions,
        completionIndex: initialIndex,
        completionLastApplied: nextValue,
      }))
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    executeCommand(activeTerminal?.input || '')
  }

  const handleKeyDown = (e) => {
    if (!activeTerminal) return

    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      if (activeTerminal.isRunning) {
        stopCommand()
      }
      return
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      updateTerminal(activeTerminal.id, (terminal) => ({
        ...terminal,
        history: [],
      }))
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      applyTabCompletion(e.shiftKey ? -1 : 1)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (activeTerminal.commandHistory.length > 0) {
        const newIndex =
          activeTerminal.historyIndex === -1
            ? activeTerminal.commandHistory.length - 1
            : Math.max(0, activeTerminal.historyIndex - 1)

        updateTerminal(activeTerminal.id, (terminal) => ({
          ...terminal,
          historyIndex: newIndex,
          input: terminal.commandHistory[newIndex],
        }))
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (activeTerminal.historyIndex !== -1) {
        const newIndex = activeTerminal.historyIndex + 1
        if (newIndex >= activeTerminal.commandHistory.length) {
          updateTerminal(activeTerminal.id, (terminal) => ({
            ...terminal,
            historyIndex: -1,
            input: '',
          }))
        } else {
          updateTerminal(activeTerminal.id, (terminal) => ({
            ...terminal,
            historyIndex: newIndex,
            input: terminal.commandHistory[newIndex],
          }))
        }
      }
    }
  }

  const handleResizeStart = (event) => {
    event.preventDefault()
    resizeStartYRef.current = event.clientY
    resizeStartHeightRef.current = terminalHeight
    setIsResizing(true)
  }

  const handleOutputScroll = () => {
    if (!terminalRef.current) return
    const node = terminalRef.current
    const threshold = 24
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom <= threshold
  }

  return (
    <div ref={terminalContainerRef} className="terminal-container" style={{ height: `${terminalHeight}px` }}>
      <div
        className={`terminal-resize-handle ${isResizing ? 'active' : ''}`}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
      />
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="Terminals">
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              className={`terminal-tab ${terminal.id === activeTerminalId ? 'active' : ''}`}
              onClick={() => setActiveTerminalId(terminal.id)}
              onDoubleClick={() => renameTerminal(terminal.id)}
              type="button"
              title="Double-click to rename"
            >
              {terminal.title}
              {terminals.length > 1 && (
                <span
                  className="terminal-tab-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTerminal(terminal.id)
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            className="terminal-tab add"
            onClick={() => createTerminal()}
            type="button"
            title={`New terminal (${getTerminalProfileLabel(defaultProfileId)})`}
            disabled={inputDisabled}
          >
            +
          </button>
          <div className="terminal-create-menu-wrap" ref={createMenuRef}>
            <button
              className="terminal-tab add-arrow"
              type="button"
              title="Create terminal options"
              aria-haspopup="menu"
              aria-expanded={isCreateMenuOpen}
              onClick={() => setIsCreateMenuOpen((prev) => !prev)}
              disabled={inputDisabled}
            >
              ▾
            </button>
            {isCreateMenuOpen && (
              <div className="terminal-create-menu" role="menu" aria-label="Terminal options">
                <button type="button" role="menuitem" onClick={() => createTerminalWithProfile(defaultProfileId)}>
                  New Terminal
                </button>
                <button type="button" role="menuitem" disabled>
                  New Terminal Window
                </button>
                <button type="button" role="menuitem" onClick={splitTerminal} disabled={!activeTerminal}>
                  Split Terminal
                </button>

                <div className="terminal-create-divider" />

                {TERMINAL_PROFILES.map((profile) => (
                  <button
                    key={`new-${profile.id}`}
                    type="button"
                    role="menuitem"
                    onClick={() => createTerminalWithProfile(profile.id)}
                  >
                    {profile.label}
                  </button>
                ))}
                <button type="button" role="menuitem" disabled>
                  JavaScript Debug Terminal
                </button>
                <button type="button" role="menuitem" disabled>
                  GitHub Copilot CLI
                </button>

                <div className="terminal-create-divider" />

                <button type="button" role="menuitem" disabled>
                  Configure Terminal Settings
                </button>

                <div className="terminal-create-label">Select Default Profile</div>
                {TERMINAL_PROFILES.map((profile) => (
                  <button
                    key={`default-${profile.id}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={defaultProfileId === profile.id}
                    onClick={() => {
                      setDefaultProfileId(profile.id)
                      setIsCreateMenuOpen(false)
                    }}
                  >
                    {defaultProfileId === profile.id ? '✓ ' : ''}
                    {profile.label}
                  </button>
                ))}

                <div className="terminal-create-divider" />

                <button type="button" role="menuitem" disabled>
                  Run Task...
                </button>
                <button type="button" role="menuitem" disabled>
                  Configure Tasks...
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="terminal-actions">
          <button
            onClick={stopCommand}
            title="Stop (Ctrl+C)"
            type="button"
            disabled={inputDisabled || !activeTerminal?.isRunning}
          >
            Stop
          </button>
          <button
            onClick={() =>
              activeTerminal &&
              updateTerminal(activeTerminal.id, (terminal) => ({
                ...terminal,
                history: [],
              }))
            }
            title="Clear"
            type="button"
            disabled={inputDisabled}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="terminal-output" ref={terminalRef} onScroll={handleOutputScroll}>
        {inputDisabled && (
          <div className="terminal-line terminal-system">Shared mode enabled: view-only terminal stream from project owner.</div>
        )}
        {activeTerminal?.history.map((entry, index) => (
          <div key={index} className={`terminal-line terminal-${entry.type}`}>
            {renderTextWithLinks(entry.text)}
          </div>
        ))}
        <form onSubmit={handleSubmit} className="terminal-inline-form">
          <span className="terminal-prompt">{promptLabel}</span>
          <input
            ref={inputRef}
            type="text"
            value={activeTerminal?.input || ''}
            onChange={(e) =>
              activeTerminal &&
              updateTerminal(activeTerminal.id, (terminal) => ({
                ...terminal,
                input: e.target.value,
                completionSeed: '',
                completionSuggestions: [],
                completionIndex: -1,
                completionLastApplied: '',
              }))
            }
            onKeyDown={handleKeyDown}
            className="terminal-input"
            placeholder={
              inputDisabled
                ? 'Shared view only (owner controls this terminal)'
                : activeTerminal?.isRunning
                  ? 'Type input for running process...'
                  : 'Type a command...'
            }
            autoComplete="off"
            disabled={inputDisabled}
          />
        </form>
      </div>
    </div>
  )
}

export default Terminal
