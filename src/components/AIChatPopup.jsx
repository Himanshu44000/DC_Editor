import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../lib/api'

const API_BASE = 'http://localhost:4000/api'
const MAX_MESSAGE_LENGTH = 4000
const MAX_ATTACHMENT_CHARS = 12000

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

const deriveTitleFromPrompt = (messageText = '') => {
  const normalized = String(messageText || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'New conversation'
  const words = normalized.split(' ').filter(Boolean).slice(0, 8)
  return (words.join(' ').trim() || normalized).slice(0, 120)
}

const renderInlineMarkdown = (text = '', keyPrefix = 'inline') => {
  const source = String(text || '')
  if (!source) return ''

  const pattern = /(\*\*[^*\n][\s\S]*?\*\*|__[^_\n][\s\S]*?__|~~[^~\n][\s\S]*?~~|`[^`\n]+`|\*[^*\n][\s\S]*?\*)/g
  const parts = []
  let lastIndex = 0
  let match = pattern.exec(source)
  let segmentIndex = 0

  while (match) {
    if (match.index > lastIndex) {
      parts.push(source.slice(lastIndex, match.index))
    }

    const token = String(match[0] || '')
    const tokenKey = `${keyPrefix}-${segmentIndex}`

    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={tokenKey}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('__') && token.endsWith('__')) {
      parts.push(<strong key={tokenKey}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      parts.push(<del key={tokenKey}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={tokenKey}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={tokenKey}>{token.slice(1, -1)}</em>)
    } else {
      parts.push(token)
    }

    segmentIndex += 1
    lastIndex = match.index + token.length
    match = pattern.exec(source)
  }

  if (lastIndex < source.length) {
    parts.push(source.slice(lastIndex))
  }

  return parts
}

const renderMarkdownContent = (content = '') => {
  const text = String(content || '').replace(/\r\n/g, '\n')
  if (!text.trim()) return null

  const lines = text.split('\n')
  const blocks = []
  let lineIndex = 0
  let blockKey = 0

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    const trimmed = String(line || '').trim()

    if (!trimmed) {
      lineIndex += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.replace(/^```/, '').trim()
      lineIndex += 1
      const codeLines = []

      while (lineIndex < lines.length && !String(lines[lineIndex] || '').trim().startsWith('```')) {
        codeLines.push(lines[lineIndex])
        lineIndex += 1
      }

      if (lineIndex < lines.length) {
        lineIndex += 1
      }

      blocks.push(
        <pre className="ai-md-pre" key={`md-${blockKey}`}>
          <code data-lang={language || undefined}>{codeLines.join('\n')}</code>
        </pre>,
      )
      blockKey += 1
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length)
      const headingText = headingMatch[2]
      const key = `md-${blockKey}`
      const HeadingTag = `h${level}`
      blocks.push(<HeadingTag key={key}>{renderInlineMarkdown(headingText, `${key}-h`)}</HeadingTag>)
      blockKey += 1
      lineIndex += 1
      continue
    }

    const paragraphLines = [line]
    lineIndex += 1

    while (lineIndex < lines.length) {
      const next = String(lines[lineIndex] || '')
      const nextTrimmed = next.trim()
      const startsSpecial = !nextTrimmed || nextTrimmed.startsWith('```') || /^(#{1,6})\s+/.test(nextTrimmed)
      if (startsSpecial) break
      paragraphLines.push(next)
      lineIndex += 1
    }

    blocks.push(
      <p key={`md-${blockKey}`}>
        {paragraphLines.map((paraLine, paraIndex) => (
          <span key={`md-${blockKey}-line-${paraIndex}`}>
            {paraIndex > 0 ? <br /> : null}
            {renderInlineMarkdown(paraLine, `md-${blockKey}-line-${paraIndex}`)}
          </span>
        ))}
      </p>,
    )
    blockKey += 1
  }

  return blocks.length > 0 ? blocks : null
}

const AIChatPopup = ({ projectId, getAuthToken, canUseAI, avatarSrc, selectedFile, files, onSendingStateChange }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [viewMode, setViewMode] = useState('home')
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoadingConversations, setIsLoadingConversations] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [error, setError] = useState('')
  const [includeFileContext, setIncludeFileContext] = useState(true)
  const [aiUsage, setAiUsage] = useState(null)
  
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const scrollerRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isExpanded, viewMode])

  useEffect(() => {
    onSendingStateChange?.(isSending)
  }, [isSending, onSendingStateChange])

  useEffect(() => {
    if (!isExpanded || !canUseAI || !projectId) return
    let cancelled = false
    const loadConversations = async () => {
      setIsLoadingConversations(true)
      setError('')
      try {
        const data = await apiRequest(`/projects/${projectId}/ai/conversations`, {}, getAuthToken)
        if (cancelled) return
        setConversations(sortConversations(data.conversations || []))
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Failed to load conversations')
      } finally {
        if (!cancelled) setIsLoadingConversations(false)
      }
    }
    loadConversations()
    return () => { cancelled = true }
  }, [isExpanded, canUseAI, projectId, getAuthToken])

  useEffect(() => {
    if (!isExpanded || !canUseAI || !projectId) { setAiUsage(null); return }
    let cancelled = false
    const loadUsage = async () => {
      try {
        const data = await apiRequest(`/projects/${projectId}/ai/usage`, {}, getAuthToken)
        if (cancelled) return
        setAiUsage({
          promptLimit: Number(data?.promptLimit || 0),
          promptCount: Number(data?.promptCount || 0),
          remainingPrompts: Number(data?.remainingPrompts || 0),
          promptLimitReached: Boolean(data?.promptLimitReached),
        })
      } catch { if (!cancelled) setAiUsage(null) }
    }
    loadUsage()
    return () => { cancelled = true }
  }, [isExpanded, canUseAI, projectId, getAuthToken])

  useEffect(() => {
    if (!isExpanded || !canUseAI || !projectId || !activeConversationId || viewMode !== 'chat') {
      setMessages([])
      return
    }
    let cancelled = false
    const loadMessages = async () => {
      setIsLoadingMessages(true)
      setError('')
      try {
        const data = await apiRequest(`/projects/${projectId}/ai/conversations/${activeConversationId}/messages`, {}, getAuthToken)
        if (!cancelled) setMessages(Array.isArray(data.messages) ? data.messages : [])
      } catch (messagesError) {
        if (!cancelled) setError(messagesError.message || 'Failed to load messages')
      } finally {
        if (!cancelled) setIsLoadingMessages(false)
      }
    }
    loadMessages()
    return () => { cancelled = true }
  }, [isExpanded, canUseAI, projectId, activeConversationId, getAuthToken, viewMode])

  const handleToggle = () => setIsExpanded(prev => !prev)
  const handleClose = (e) => { e.stopPropagation(); setIsExpanded(false) }
  const openConversation = (conversationId) => { setActiveConversationId(conversationId); setViewMode('chat'); setError('') }
  const goToHome = () => { setViewMode('home'); setActiveConversationId(null); setMessages([]); setError('') }
  const handleNewChat = () => { setInputValue(''); setError(''); goToHome() }

  const handleDeleteConversation = async (conversationId, e) => {
    e.stopPropagation()
    if (!projectId || !conversationId) return
    if (!window.confirm('Delete this conversation?')) return
    setError('')
    try {
      await apiRequest(`/projects/${projectId}/ai/conversations/${conversationId}`, { method: 'DELETE' }, getAuthToken)
      setConversations((prev) => sortConversations(prev.filter((entry) => entry.id !== conversationId)))
      if (activeConversationId === conversationId) goToHome()
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete conversation')
    }
  }

  const handleSendMessage = async (e) => {
    e.preventDefault()
    const trimmedInput = inputValue.trim()
    if (!trimmedInput || isSending || !canUseAI || !projectId || aiUsage?.promptLimitReached) return

    let targetConversationId = activeConversationId
    if (!targetConversationId) {
      try {
        const title = deriveTitleFromPrompt(trimmedInput)
        const response = await apiRequest(`/projects/${projectId}/ai/conversations`, { method: 'POST', body: JSON.stringify({ title }) }, getAuthToken)
        if (response?.conversation?.id) {
          targetConversationId = response.conversation.id
          setConversations((prev) => sortConversations([response.conversation, ...prev]))
          setActiveConversationId(targetConversationId)
          setViewMode('chat')
        }
      } catch (error) {
        setError(error.message || 'Failed to create conversation')
        return
      }
    }
    if (!targetConversationId) return

    const attachments = []
    if (includeFileContext && selectedFile) {
      attachments.push({ name: selectedFile.name || selectedFile.path || 'current-file', content: (selectedFile.content || '').slice(0, MAX_ATTACHMENT_CHARS) })
    }

    const userLocalId = `local-user-${Date.now()}`
    const assistantLocalId = `local-assistant-${Date.now()}`
    const userMessage = { id: userLocalId, role: 'user', content: trimmedInput, attachments: attachments.map(a => ({ name: a.name })), createdAt: new Date().toISOString() }

    setMessages((prev) => [...prev, userMessage, { id: assistantLocalId, role: 'assistant', content: '', attachments: [] }])
    setInputValue('')
    setIsSending(true)
    setError('')

    try {
      const token = await getAuthToken()
      const response = await fetch(`${API_BASE}/projects/${projectId}/ai/conversations/${targetConversationId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: trimmedInput, attachments }),
      })

      if (!response.ok || !response.body) {
        const responseText = await response.text().catch(() => '')
        let serverMessage = ''
        if (responseText) { try { serverMessage = String(JSON.parse(responseText)?.message || '') } catch { serverMessage = responseText } }
        throw new Error(serverMessage || `AI request failed (${response.status})`)
      }

      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      let buffer = ''
      let accumulatedText = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          const dataLines = block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6))
          for (const line of dataLines) {
            let payload = null
            try { payload = JSON.parse(line) } catch { payload = null }
            if (!payload) continue

            if (payload.type === 'chunk') {
              accumulatedText += String(payload.chunk || '')
              setMessages((prev) => prev.map((entry) => entry.id === assistantLocalId ? { ...entry, content: accumulatedText } : entry))
            }

            if (payload.type === 'done' && payload.message?.id) {
              const serverAssistant = { ...payload.message, role: 'assistant', content: String(payload.message.content || accumulatedText), attachments: Array.isArray(payload.message.attachments) ? payload.message.attachments : [] }
              setMessages((prev) => prev.map((entry) => (entry.id === assistantLocalId ? serverAssistant : entry)))
              const nextTitle = String(payload.message?.conversationTitle || '').trim()
              if (nextTitle) {
                setConversations((prev) => sortConversations(prev.map((entry) => entry.id === targetConversationId ? { ...entry, title: nextTitle, updatedAt: new Date().toISOString() } : entry)))
              }
            }
            if (payload.type === 'error') throw new Error(payload.message || 'AI stream error')
          }
        }
      }
      try {
        const usageData = await apiRequest(`/projects/${projectId}/ai/usage`, {}, getAuthToken)
        setAiUsage({ promptLimit: Number(usageData?.promptLimit || 0), promptCount: Number(usageData?.promptCount || 0), remainingPrompts: Number(usageData?.remainingPrompts || 0), promptLimitReached: Boolean(usageData?.promptLimitReached) })
      } catch {}
    } catch (error) {
      setError(error.message || 'Failed to send message')
      setMessages((prev) => prev.filter(m => m.id !== userLocalId && m.id !== assistantLocalId))
      setInputValue(trimmedInput)
    } finally {
      setIsSending(false)
    }
  }

  if (!canUseAI) return null
  const activeConversation = conversations.find(c => c.id === activeConversationId)

  if (!isExpanded) {
    return (
      <div className="ai-chat-bar">
        <div className="ai-chat-bar-header" onClick={handleToggle}>
          <div className="ai-chat-bar-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
          </div>
          <span className="ai-chat-bar-title">AI Assistant</span>
          <div className="ai-chat-bar-actions">
            <button type="button" title="Expand"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg></button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ai-chat-expanded">
      <div className="ai-chat-expanded-header">
        {viewMode === 'chat' && (
          <button type="button" className="ai-chat-back-btn" onClick={goToHome} title="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
        <div className="ai-chat-expanded-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
        </div>
        <span className="ai-chat-expanded-title">{viewMode === 'chat' ? (activeConversation?.title || 'Chat') : 'AI Assistant'}</span>
        <div className="ai-chat-expanded-actions">
          <button type="button" onClick={handleNewChat} title="New chat" disabled={isSending}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></button>
          <button type="button" onClick={handleClose} title="Collapse"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg></button>
        </div>
      </div>

      {viewMode === 'home' ? (
        <>
          <div className="ai-chat-conversations">
            <div className="ai-chat-conversations-header"><span>Sessions</span></div>
            <div className="ai-chat-conversations-list" ref={scrollerRef}>
              {isLoadingConversations && <p className="ai-chat-note">Loading...</p>}
              {!isLoadingConversations && conversations.length === 0 && <p className="ai-chat-note">No conversations yet.</p>}
              {conversations.map((conversation) => (
                <div key={conversation.id} className="ai-chat-conversation-item">
                  <button type="button" className="ai-chat-conversation-open" onClick={() => openConversation(conversation.id)}>
                    <span className="ai-chat-conversation-title">{conversation.title}</span>
                    <small className="ai-chat-conversation-time">{formatConversationTime(conversation.updatedAt || conversation.createdAt)}</small>
                  </button>
                  <button type="button" className="ai-chat-conversation-delete" onClick={(e) => handleDeleteConversation(conversation.id, e)} title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
          {selectedFile && (
            <div className="ai-chat-file-context">
              <label className="ai-chat-file-toggle"><input type="checkbox" checked={includeFileContext} onChange={(e) => setIncludeFileContext(e.target.checked)} /><span>Include: {selectedFile.name || 'Current file'}</span></label>
            </div>
          )}
          <div className="ai-chat-input-area">
            <form onSubmit={handleSendMessage} className="ai-chat-input-wrapper">
              <input ref={inputRef} type="text" value={inputValue} onChange={e => setInputValue(e.target.value.slice(0, MAX_MESSAGE_LENGTH))} placeholder="Start a new conversation..." disabled={isSending || aiUsage?.promptLimitReached} />
              <button type="submit" className="ai-chat-send-btn" disabled={isSending || !inputValue.trim() || aiUsage?.promptLimitReached}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </form>
            {aiUsage && <small className="ai-chat-usage">{aiUsage.promptCount}/{aiUsage.promptLimit} prompts</small>}
          </div>
        </>
      ) : (
        <>
          <div className="ai-chat-messages" ref={scrollerRef}>
            {isLoadingMessages && <p className="ai-chat-note">Loading messages...</p>}
            {!isLoadingMessages && messages.length === 0 && <p className="ai-chat-note">Ask something to begin.</p>}
            {messages.map(msg => (
              <div key={msg.id} className={`ai-chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                <div className="ai-chat-message-header"><strong>{msg.role === 'user' ? 'You' : 'AI'}</strong>{msg.createdAt && <small>{new Date(msg.createdAt).toLocaleTimeString()}</small>}</div>
                {msg.role === 'assistant' ? <div className="ai-chat-markdown">{renderMarkdownContent(msg.content || (isSending ? 'Thinking...' : ''))}</div> : <p>{msg.content}</p>}
                {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                  <div className="ai-chat-attachments">{msg.attachments.map((att, idx) => <span key={idx} className="ai-chat-attachment-tag">📎 {att.name}</span>)}</div>
                )}
              </div>
            ))}
            {isSending && <div className="ai-chat-thinking"><span className="ai-chat-dot"></span><span>AI is thinking...</span></div>}
            <div ref={messagesEndRef} />
          </div>
          {selectedFile && (
            <div className="ai-chat-file-context">
              <label className="ai-chat-file-toggle"><input type="checkbox" checked={includeFileContext} onChange={(e) => setIncludeFileContext(e.target.checked)} /><span>Include: {selectedFile.name || 'Current file'}</span></label>
            </div>
          )}
          <div className="ai-chat-input-area">
            <form onSubmit={handleSendMessage} className="ai-chat-input-wrapper">
              <input ref={inputRef} type="text" value={inputValue} onChange={e => setInputValue(e.target.value.slice(0, MAX_MESSAGE_LENGTH))} placeholder="Write a message..." disabled={isSending || aiUsage?.promptLimitReached} />
              <button type="submit" className="ai-chat-send-btn" disabled={isSending || !inputValue.trim() || aiUsage?.promptLimitReached}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </form>
            {aiUsage && <small className="ai-chat-usage">{aiUsage.promptCount}/{aiUsage.promptLimit} prompts</small>}
          </div>
        </>
      )}
      {error && <p className="ai-chat-error">{error}</p>}
    </div>
  )
}

export default AIChatPopup
