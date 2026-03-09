import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../lib/api'

const API_BASE = 'http://localhost:4000/api'
const MAX_ATTACHMENT_FILES = 5
const MAX_ATTACHMENT_CHARS = 12000
const AI_PANEL_MIN_WIDTH = 360
const AI_PANEL_DEFAULT_WIDTH = 420
const AI_HOME_TEXTAREA_MAX_HEIGHT = 132
const AI_CHAT_TEXTAREA_MAX_HEIGHT = 280

const DEFAULT_TITLE_PATTERN = /^\s*new\s+conversation\s*$/i

const deriveTitleFromPrompt = (messageText = '') => {
  const normalized = String(messageText || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return 'New conversation'
  const words = normalized.split(' ').filter(Boolean).slice(0, 8)
  const candidate = words.join(' ').trim()
  return (candidate || normalized).slice(0, 120)
}

const normalizeAttachmentFile = async (file) => {
  const name = String(file?.name || '').trim() || 'attachment.txt'
  const rawText = await file.text()
  const normalized = String(rawText || '').slice(0, MAX_ATTACHMENT_CHARS)
  if (!normalized.trim()) return null

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    content: normalized,
  }
}

const sortConversations = (items) =>
  [...(Array.isArray(items) ? items : [])].sort(
    (a, b) => new Date(String(b?.updatedAt || 0)).getTime() - new Date(String(a?.updatedAt || 0)).getTime(),
  )

const formatConversationTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

const AIAssistantPanel = ({
  isOpen,
  canUseAI,
  projectId,
  getAuthToken,
  onClose,
  onSendingStateChange,
}) => {
  const [viewMode, setViewMode] = useState('home')
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState([])
  const [isLoadingConversations, setIsLoadingConversations] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [responsePhase, setResponsePhase] = useState('idle')
  const [error, setError] = useState('')
  const [panelWidth, setPanelWidth] = useState(AI_PANEL_DEFAULT_WIDTH)
  const attachmentInputRef = useRef(null)
  const composeTextareaRef = useRef(null)
  const scrollerRef = useRef(null)
  const dragStateRef = useRef({
    dragging: false,
    startX: 0,
    startWidth: AI_PANEL_DEFAULT_WIDTH,
  })

  const maxPanelWidth = useMemo(() => {
    if (typeof window === 'undefined') return 1200
    return Math.max(AI_PANEL_MIN_WIDTH, window.innerWidth - 28)
  }, [isOpen])

  const activeConversation = useMemo(
    () => conversations.find((entry) => entry.id === activeConversationId) || null,
    [conversations, activeConversationId],
  )

  useEffect(() => {
    if (typeof onSendingStateChange !== 'function') return
    onSendingStateChange(Boolean(isSending))
    return () => {
      onSendingStateChange(false)
    }
  }, [isSending, onSendingStateChange])

  useEffect(() => {
    if (!isOpen) return
    if (viewMode !== 'chat') return
    if (!scrollerRef.current) return
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
  }, [messages, isOpen, viewMode])

  useEffect(() => {
    const textarea = composeTextareaRef.current
    if (!textarea) return

    const maxHeight = viewMode === 'home' ? AI_HOME_TEXTAREA_MAX_HEIGHT : AI_CHAT_TEXTAREA_MAX_HEIGHT
    textarea.style.height = '0px'
    const nextHeight = Math.min(maxHeight, Math.max(46, textarea.scrollHeight))
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [draft, viewMode, isOpen])

  useEffect(() => {
    if (!isOpen) return

    const onMouseMove = (event) => {
      const state = dragStateRef.current
      if (!state.dragging) return

      const deltaX = state.startX - event.clientX
      const nextWidth = Math.min(maxPanelWidth, Math.max(AI_PANEL_MIN_WIDTH, state.startWidth + deltaX))
      setPanelWidth(nextWidth)
    }

    const onMouseUp = () => {
      const state = dragStateRef.current
      if (!state.dragging) return
      state.dragging = false
      document.body.classList.remove('ai-panel-resizing')
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.classList.remove('ai-panel-resizing')
    }
  }, [isOpen, maxPanelWidth])

  const startResize = (event) => {
    dragStateRef.current.dragging = true
    dragStateRef.current.startX = event.clientX
    dragStateRef.current.startWidth = panelWidth
    document.body.classList.add('ai-panel-resizing')
    event.preventDefault()
  }

  useEffect(() => {
    if (!isOpen || !canUseAI || !projectId) return

    let cancelled = false

    const loadConversations = async () => {
      setIsLoadingConversations(true)
      setError('')
      try {
        const data = await apiRequest(`/projects/${projectId}/ai/conversations`, {}, getAuthToken)
        if (cancelled) return

        const items = sortConversations(data.conversations || [])
        setConversations(items)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load AI conversations')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingConversations(false)
        }
      }
    }

    loadConversations()

    return () => {
      cancelled = true
    }
  }, [isOpen, canUseAI, projectId, getAuthToken])

  useEffect(() => {
    if (!isOpen || !canUseAI || !projectId || !activeConversationId || viewMode !== 'chat') {
      setMessages([])
      return
    }

    let cancelled = false

    const loadMessages = async () => {
      setIsLoadingMessages(true)
      setError('')
      try {
        const data = await apiRequest(
          `/projects/${projectId}/ai/conversations/${activeConversationId}/messages`,
          {},
          getAuthToken,
        )
        if (!cancelled) {
          setMessages(Array.isArray(data.messages) ? data.messages : [])
        }
      } catch (messagesError) {
        if (!cancelled) {
          setError(messagesError.message || 'Failed to load AI messages')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMessages(false)
        }
      }
    }

    loadMessages()

    return () => {
      cancelled = true
    }
  }, [isOpen, canUseAI, projectId, activeConversationId, getAuthToken, viewMode])

  const openConversation = (conversationId) => {
    setActiveConversationId(conversationId)
    setViewMode('chat')
    setError('')
  }

  const goToSessionsHome = () => {
    setViewMode('home')
    setActiveConversationId('')
    setMessages([])
    setError('')
  }

  const handleCreateConversation = () => {
    setDraft('')
    setAttachments([])
    setError('')
    goToSessionsHome()
  }

  const handleDeleteConversation = async (conversationId) => {
    if (!projectId || !conversationId) return
    const confirmed = window.confirm('Delete this AI conversation?')
    if (!confirmed) return

    setError('')

    try {
      await apiRequest(
        `/projects/${projectId}/ai/conversations/${conversationId}`,
        { method: 'DELETE' },
        getAuthToken,
      )

      setConversations((prev) => {
        const next = prev.filter((entry) => entry.id !== conversationId)
        const sorted = sortConversations(next)
        setActiveConversationId((current) => (current === conversationId ? '' : current))
        return sorted
      })
      if (activeConversationId === conversationId) {
        goToSessionsHome()
      }
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete conversation')
    }
  }

  const handleAttachmentClick = () => {
    attachmentInputRef.current?.click()
  }

  const handleAttachmentSelect = async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    const selected = files.slice(0, MAX_ATTACHMENT_FILES)
    const nextAttachments = []

    for (const file of selected) {
      try {
        const normalized = await normalizeAttachmentFile(file)
        if (normalized) {
          nextAttachments.push(normalized)
        }
      } catch {
        // Ignore unreadable files so one bad file does not block the request.
      }
    }

    if (nextAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...nextAttachments].slice(0, MAX_ATTACHMENT_FILES))
    }

    event.target.value = ''
  }

  const removeAttachment = (attachmentId) => {
    setAttachments((prev) => prev.filter((entry) => entry.id !== attachmentId))
  }

  const handleSend = async (event) => {
    event.preventDefault()

    const messageText = String(draft || '').trim()
    if (!messageText || !projectId || isSending) return

    let targetConversationId = activeConversationId
    if (!targetConversationId) {
      try {
        const firstPromptTitle = deriveTitleFromPrompt(messageText)
        const created = await apiRequest(
          `/projects/${projectId}/ai/conversations`,
          { method: 'POST', body: JSON.stringify({ title: firstPromptTitle }) },
          getAuthToken,
        )
        if (created?.conversation?.id) {
          targetConversationId = created.conversation.id
          setConversations((prev) => sortConversations([created.conversation, ...prev]))
          setActiveConversationId(created.conversation.id)
          setViewMode('chat')
        }
      } catch (createError) {
        setError(createError.message || 'Failed to create conversation')
        return
      }
    }
    if (!targetConversationId) return

    const userLocalId = `local-user-${Date.now()}`
    const assistantLocalId = `local-assistant-${Date.now()}`
    const userMessage = {
      id: userLocalId,
      role: 'user',
      content: messageText,
      attachments: attachments.map((entry) => ({ name: entry.name, content: entry.content })),
      createdAt: new Date().toISOString(),
      userId: 'me',
    }

    setMessages((prev) => [...prev, userMessage, { id: assistantLocalId, role: 'assistant', content: '', attachments: [] }])
    setDraft('')
    setIsSending(true)
    setResponsePhase('thinking')
    setError('')

    try {
      const token = await getAuthToken()
      const response = await fetch(`${API_BASE}/projects/${projectId}/ai/conversations/${targetConversationId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: messageText,
          attachments: attachments.map((entry) => ({ name: entry.name, content: entry.content })),
        }),
      })

      if (!response.ok || !response.body) {
        const responseText = await response.text().catch(() => '')
        let serverMessage = ''
        if (responseText) {
          try {
            const parsed = JSON.parse(responseText)
            serverMessage = String(parsed?.message || '')
          } catch {
            serverMessage = responseText
          }
        }
        throw new Error(serverMessage || `AI stream failed (${response.status})`)
      }

      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      let buffer = ''
      let accumulatedAssistantText = ''
      let sawFirstChunk = false
      let completedSuccessfully = false

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          const dataLines = block
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))

          for (const line of dataLines) {
            let payload = null
            try {
              payload = JSON.parse(line)
            } catch {
              payload = null
            }
            if (!payload) continue

            if (payload.type === 'chunk') {
              if (!sawFirstChunk) {
                sawFirstChunk = true
                setResponsePhase('streaming')
              }
              accumulatedAssistantText += String(payload.chunk || '')
            }

            if (payload.type === 'done' && payload.message?.id) {
              const serverAssistant = {
                ...payload.message,
                role: 'assistant',
                content: String(payload.message.content || accumulatedAssistantText),
                attachments: Array.isArray(payload.message.attachments) ? payload.message.attachments : [],
              }

              setMessages((prev) =>
                prev.map((entry) => (entry.id === assistantLocalId ? serverAssistant : entry)),
              )

              const nextTitle = String(payload.message?.conversationTitle || '').trim()
              if (nextTitle) {
                setConversations((prev) =>
                  sortConversations(
                    prev.map((entry) =>
                      entry.id === targetConversationId
                        ? {
                            ...entry,
                            title: nextTitle,
                            updatedAt: new Date().toISOString(),
                          }
                        : entry,
                    ),
                  ),
                )
              } else {
                // Fallback: if server title payload is empty, preserve discoverable naming from first prompt.
                setConversations((prev) =>
                  sortConversations(
                    prev.map((entry) => {
                      if (entry.id !== targetConversationId) return entry
                      const currentTitle = String(entry.title || '').trim()
                      if (!currentTitle || DEFAULT_TITLE_PATTERN.test(currentTitle)) {
                        return {
                          ...entry,
                          title: deriveTitleFromPrompt(messageText),
                        }
                      }
                      return entry
                    }),
                  ),
                )
              }

              completedSuccessfully = true
              setIsSending(false)
              setResponsePhase('idle')
            }

            if (payload.type === 'error') {
              throw new Error(payload.message || 'AI stream failed')
            }
          }
        }
      }

      setAttachments([])
      setConversations((prev) => {
        const next = prev.map((entry) =>
          entry.id === targetConversationId
            ? {
                ...entry,
                updatedAt: new Date().toISOString(),
              }
            : entry,
        )
        return sortConversations(next)
      })
    } catch (sendError) {
      setMessages((prev) => prev.filter((entry) => entry.id !== assistantLocalId))
      setError(sendError.message || 'Failed to send AI message')
      setIsSending(false)
      setResponsePhase('idle')
    } finally {
      if (!completedSuccessfully) {
        setIsSending(false)
        setResponsePhase('idle')
      }
    }
  }

  if (!isOpen) return null

  const renderComposer = () => (
    <form className="ai-assistant-form" onSubmit={handleSend}>
      {attachments.length > 0 && (
        <div className="ai-attachment-list">
          {attachments.map((attachment) => (
            <button type="button" key={attachment.id} onClick={() => removeAttachment(attachment.id)}>
              {attachment.name} x
            </button>
          ))}
        </div>
      )}

      <div className="ai-compose-row">
        <button type="button" onClick={handleAttachmentClick} disabled={isSending || !canUseAI}>
          +
        </button>

        <input
          type="file"
          ref={attachmentInputRef}
          className="hidden-input"
          onChange={handleAttachmentSelect}
          multiple
          accept=".txt,.md,.js,.jsx,.ts,.tsx,.json,.css,.html,.py,.java,.cpp,.c,.sql"
        />

        <textarea
          ref={composeTextareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe what to build next"
          rows={1}
          disabled={!canUseAI || isSending}
        />

        <button type="submit" disabled={!canUseAI || isSending || !draft.trim()}>
          {isSending ? 'Running' : 'Send'}
        </button>
      </div>
    </form>
  )

  return (
    <div className="ai-assistant-overlay" style={{ width: `${panelWidth}px` }}>
      <div
        className="ai-assistant-resizer"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize AI panel"
      />
      <div className="ai-assistant-head">
        <h3>{viewMode === 'chat' ? 'Chat' : ''}</h3>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      {viewMode === 'home' ? (
        <>
          <div className="ai-sessions-head">
            <strong>Sessions</strong>
            <button
              type="button"
              onClick={handleCreateConversation}
              disabled={!canUseAI || isLoadingConversations}
              title="Create new chat"
            >
              +
            </button>
          </div>

          <div className="ai-assistant-conversations">
            {isLoadingConversations && <p className="role-note">Loading conversations...</p>}
            {!isLoadingConversations && conversations.length === 0 && (
              <p className="role-note">No conversations yet.</p>
            )}
            {conversations.map((conversation) => (
              <div key={conversation.id} className="ai-conversation-row">
                <button
                  type="button"
                  className="ai-conversation-open"
                  onClick={() => openConversation(conversation.id)}
                  title={conversation.title}
                >
                  <span>{conversation.title}</span>
                  <small>{formatConversationTime(conversation.updatedAt || conversation.createdAt)}</small>
                </button>
                <button
                  type="button"
                  className="ai-conversation-delete"
                  onClick={() => handleDeleteConversation(conversation.id)}
                  aria-label={`Delete ${conversation.title}`}
                  title="Delete conversation"
                  disabled={isSending}
                >
                  x
                </button>
              </div>
            ))}
          </div>

          {renderComposer()}
        </>
      ) : (
        <>
          <div className="ai-chat-head">
            <button type="button" onClick={goToSessionsHome} aria-label="Back to sessions">
              {'<'}
            </button>
            <strong>{activeConversation?.title || 'Conversation'}</strong>
            <button
              type="button"
              className="ai-chat-new"
              onClick={handleCreateConversation}
              title="Create new chat"
              aria-label="Create new chat"
              disabled={!canUseAI || isLoadingConversations || isSending}
            >
              +
            </button>
          </div>

          {isSending && (
            <div className="ai-run-state" role="status" aria-live="polite">
              <span className="ai-run-dot" />
              <span>AI is thinking...</span>
            </div>
          )}

          <div className="ai-assistant-messages" ref={scrollerRef}>
            {isLoadingMessages && <p className="role-note">Loading messages...</p>}
            {!isLoadingMessages && messages.length === 0 && <p className="role-note">Ask something to begin this chat.</p>}
            {messages.map((message) => (
              <div key={message.id} className={`ai-message-item ${message.role === 'user' ? 'self' : 'assistant'}`}>
                <strong>{message.role === 'user' ? 'You' : 'AI'}</strong>
                <p>{message.content || (isSending && message.role === 'assistant' ? 'Thinking...' : '')}</p>
                {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                  <div className="ai-message-attachments">
                    {message.attachments.map((attachment, index) => (
                      <span key={`${message.id}-${index}`}>{attachment.name || 'attachment'}</span>
                    ))}
                  </div>
                )}
                <small>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</small>
              </div>
            ))}
          </div>

          {renderComposer()}
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {!canUseAI && <p className="role-note">AI assistant is available for owner and collaborators only.</p>}
    </div>
  )
}

export default AIAssistantPanel
