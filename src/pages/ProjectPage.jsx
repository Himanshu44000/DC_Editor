import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { apiRequest } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useAuth } from '../context/AuthContext'
import FileTree from '../components/FileTree'
import Terminal from '../components/Terminal'
import InteractiveConsole from '../components/InteractiveConsole'
import VoiceChannelPanel from '../components/VoiceChannelPanel'
import AIChatPopup from '../components/AIChatPopup'
import '../styles/ProjectPage.css'

const DEFAULT_AVATAR_PATH = '/branding/defaultAvatar.png'
const TYPING_ACTIVE_WINDOW_MS = 6000
const TYPING_SIGNAL_WINDOW_MS = 1800
const COLLAB_ACK_TIMEOUT_MS = 2500
const CURSOR_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185', '#f97316']
const GHOST_SUGGESTION_DEBOUNCE_MS = 620
const GHOST_CONTEXT_WINDOW_LINES = 30
const GHOST_PROJECT_SUMMARY_MAX_FILES = 24

const isPascalCase = (value = '') => /^[A-Z][A-Za-z0-9_$]*$/.test(String(value || '').trim())

const extractExportedSymbols = (source = '') => {
  const text = String(source || '')
  const symbols = new Set()

  const patterns = [
    /export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match?.[1]) symbols.add(String(match[1]))
    }
  }

  return Array.from(symbols)
}

const pickCursorColor = (userId = '') => {
  const source = String(userId || '')
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0
  }
  const offset = Math.abs(hash) % CURSOR_COLORS.length
  return CURSOR_COLORS[offset]
}

const chatMessageKey = (message) => String(message?.id || message?.clientMessageId || '').trim()

const mergeChatMessages = (snapshotChat, previousChat) => {
  const normalizedSnapshot = Array.isArray(snapshotChat) ? snapshotChat : []
  const normalizedPrevious = Array.isArray(previousChat) ? previousChat : []

  if (!normalizedPrevious.length) return normalizedSnapshot

  const mergedByKey = new Map()
  const fallbackItems = []

  for (const message of normalizedSnapshot) {
    const key = chatMessageKey(message)
    if (key) {
      mergedByKey.set(key, message)
    } else {
      fallbackItems.push(message)
    }
  }

  for (const message of normalizedPrevious) {
    const key = chatMessageKey(message)
    if (key) {
      if (!mergedByKey.has(key)) {
        mergedByKey.set(key, message)
      }
      continue
    }
    fallbackItems.push(message)
  }

  const merged = [...mergedByKey.values(), ...fallbackItems]
  merged.sort((a, b) => {
    const aTime = Date.parse(String(a?.createdAt || ''))
    const bTime = Date.parse(String(b?.createdAt || ''))
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime
    }
    return String(chatMessageKey(a) || '').localeCompare(String(chatMessageKey(b) || ''))
  })

  return merged
}

const normalizePath = (value = '') =>
  String(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')

const fileNameFromPath = (path) => {
  const normalized = normalizePath(path)
  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

const parentPathFromPath = (path) => {
  const normalized = normalizePath(path)
  if (!normalized || !normalized.includes('/')) return ''
  return normalized.slice(0, normalized.lastIndexOf('/'))
}

const fileStemFromPath = (filePath) => {
  const name = fileNameFromPath(filePath)
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0) return name
  return name.slice(0, dotIndex)
}

const toRelativeImportPath = (fromFilePath, toFilePath) => {
  const fromDir = parentPathFromPath(fromFilePath)
  const fromParts = (fromDir ? fromDir.split('/') : []).filter(Boolean)
  const toParts = normalizePath(toFilePath).split('/').filter(Boolean)

  if (!toParts.length) return './'

  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift()
    toParts.shift()
  }

  const up = fromParts.map(() => '..')
  const down = toParts
  const raw = [...up, ...down].join('/')
  if (!raw) return './'
  if (raw.startsWith('.')) return raw
  return `./${raw}`
}

const buildTreeRows = (folders, files) => {
  const root = { path: '', name: '', folders: new Map(), files: [] }

  const ensureNode = (folderPath) => {
    const normalized = normalizePath(folderPath)
    if (!normalized) return root

    const parts = normalized.split('/')
    let current = root
    let cumulative = ''
    for (const part of parts) {
      cumulative = cumulative ? `${cumulative}/${part}` : part
      if (!current.folders.has(part)) {
        current.folders.set(part, {
          path: cumulative,
          name: part,
          folders: new Map(),
          files: [],
        })
      }
      current = current.folders.get(part)
    }

    return current
  }

  for (const folderPath of folders) {
    ensureNode(folderPath)
  }

  for (const file of files) {
    const filePath = normalizePath(file.path || file.name)
    const folderNode = ensureNode(parentPathFromPath(filePath))
    folderNode.files.push({
      ...file,
      path: filePath,
      name: fileNameFromPath(filePath),
    })
  }

  const rows = []
  const walk = (node, depth) => {
    const folderChildren = Array.from(node.folders.values()).sort((a, b) => a.name.localeCompare(b.name))
    for (const folder of folderChildren) {
      rows.push({ type: 'folder', depth, path: folder.path, name: folder.name })
      walk(folder, depth + 1)
    }

    const fileChildren = [...node.files].sort((a, b) => a.path.localeCompare(b.path))
    for (const file of fileChildren) {
      rows.push({ type: 'file', depth, file })
    }
  }

  walk(root, 0)
  return rows
}

const languageForFile = (fileName, fallback) => {
  const normalizedFileName = String(fileName || '').trim().toLowerCase()
  if (normalizedFileName === '.gitignore' || normalizedFileName.endsWith('.gitignore')) return 'plaintext'
  if (normalizedFileName === '.gitattributes') return 'plaintext'
  if (normalizedFileName === '.editorconfig') return 'plaintext'
  if (normalizedFileName === '.npmrc' || normalizedFileName === '.nvmrc' || normalizedFileName === '.yarnrc') return 'plaintext'
  if (normalizedFileName === '.prettierignore' || normalizedFileName === '.eslintignore' || normalizedFileName === '.dockerignore') return 'plaintext'
  if (normalizedFileName === '.prettierrc' || normalizedFileName === '.eslintrc') return 'json'
  if (normalizedFileName.endsWith('.eslintrc.json') || normalizedFileName.endsWith('.prettierrc.json')) return 'json'
  if (normalizedFileName.endsWith('.eslintrc.js') || normalizedFileName.endsWith('.prettierrc.js')) return 'javascript'
  if (normalizedFileName.endsWith('.eslintrc.cjs') || normalizedFileName.endsWith('.prettierrc.cjs')) return 'javascript'
  if (normalizedFileName === '.env' || normalizedFileName.startsWith('.env.')) return 'shell'
  if (normalizedFileName === 'dockerfile') return 'dockerfile'

  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'editorconfig' || ext === 'gitattributes') return 'plaintext'
  if (ext === 'js') return 'javascript'
  if (ext === 'jsx') return 'javascript'
  if (ext === 'ts') return 'typescript'
  if (ext === 'tsx') return 'typescript'
  if (ext === 'html') return 'html'
  if (ext === 'vue') return 'html'
  if (ext === 'css') return 'css'
  if (ext === 'json') return 'jsonc'
  if (ext === 'md') return 'markdown'
  if (ext === 'py') return 'python'
  return fallback || 'javascript'
}

const isRunnablePath = (path = '') => {
  const lower = String(path || '').toLowerCase()
  return (
    lower.endsWith('.js') ||
    lower.endsWith('.py') ||
    lower.endsWith('.cpp') ||
    lower.endsWith('.cc') ||
    lower.endsWith('.cxx') ||
    lower.endsWith('.java') ||
    lower.endsWith('.ts')
  )
}

const runtimeForPath = (path = '') => {
  const lower = String(path || '').toLowerCase()
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.ts')) return 'typescript'
  return null
}

const normalizePracticeLanguage = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'c++') return 'cpp'
  if (normalized === 'js') return 'javascript'
  if (normalized === 'ts') return 'typescript'
  return normalized
}

const runtimeMatchesPracticeLanguage = (projectLanguage, filePath) => {
  const expected = normalizePracticeLanguage(projectLanguage)
  const actual = runtimeForPath(filePath)
  return Boolean(expected && actual && expected === actual)
}

const isImagePath = (path = '') => /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(String(path || ''))
const isSvgPath = (path = '') => /\.svg$/i.test(String(path || ''))

const normalizeProjectPayload = (project, userId) => {
  if (!project) return null

  const resolvedRole =
    project.role ||
    (project.ownerId && userId && project.ownerId === userId ? 'owner' : 'collaborator')

  const resolvedCanEdit =
    typeof project.canEdit === 'boolean' ? project.canEdit : resolvedRole === 'owner' || resolvedRole === 'collaborator'

  return {
    ...project,
    role: resolvedRole,
    canEdit: resolvedCanEdit,
    templateId: project.templateId || 'react-vite',
    templateVariantId: project.templateVariantId || null,
    files: Array.isArray(project.files) ? project.files : [],
    folders: Array.isArray(project.folders) ? project.folders : [],
    chat: Array.isArray(project.chat) ? project.chat : [],
  }
}

const prettyActivityType = (activityType = '') =>
  String(activityType || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())

const describeActivity = (entry) => {
  const type = String(entry?.activityType || '').toLowerCase()
  const data = entry?.activityData || {}

  const path = normalizePath(data.path || data.filePath || '')
  const oldPath = normalizePath(data.oldPath || '')
  const newPath = normalizePath(data.newPath || '')
  const role = String(data.role || '').trim()
  const code = String(data.code || '').trim()
  const runtime = String(data.runtime || '').trim().toUpperCase()

  if (type === 'file_created') return `Created file ${path || data.name || 'Unknown'}`
  if (type === 'file_deleted') return `Deleted file ${path || data.name || 'Unknown'}`
  if (type === 'file_renamed') {
    if (oldPath && newPath) return `Renamed file ${oldPath} → ${newPath}`
    if (newPath) return `Renamed file to ${newPath}`
    return 'Renamed file'
  }

  if (type === 'folder_created') return `Created folder ${path || 'Unknown'}`
  if (type === 'folder_deleted') return `Deleted folder ${path || 'Unknown'}`
  if (type === 'folder_renamed') {
    if (oldPath && newPath) return `Renamed folder ${oldPath} → ${newPath}`
    if (newPath) return `Renamed folder to ${newPath}`
    return 'Renamed folder'
  }

  if (type === 'member_joined') return role ? `Member joined as ${role}` : 'Member joined'
  if (type === 'member_removed') {
    const removedUserName = String(data.removedUserName || '').trim()
    return removedUserName ? `Removed access for ${removedUserName}` : 'Removed member access'
  }
  if (type === 'invite_created') return code ? `Invite created (${code})` : 'Invite created'

  if (type === 'execution_queued') {
    if (path && runtime) return `Execution queued for ${path} (${runtime})`
    return 'Execution queued'
  }
  if (type === 'execution_completed') {
    if (path && runtime) return `Execution completed for ${path} (${runtime})`
    return 'Execution completed'
  }
  if (type === 'execution_failed') {
    if (path && runtime) return `Execution failed for ${path} (${runtime})`
    return 'Execution failed'
  }

  return prettyActivityType(type)
}

const ProjectPage = () => {
  const { token, user, getAuthToken } = useAuth()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [files, setFiles] = useState([])
  const [folders, setFolders] = useState([])
  const [selectedFileId, setSelectedFileId] = useState(null)
  const [selectedFolderPath, setSelectedFolderPath] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatSearch, setChatSearch] = useState('')
  const [chat, setChat] = useState([])
  const [remoteCursors, setRemoteCursors] = useState({})
  const [inviteCode, setInviteCode] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteRole, setInviteRole] = useState('collaborator')
  const [activities, setActivities] = useState([])
  const [members, setMembers] = useState([])
  const [showMembersPanel, setShowMembersPanel] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState('')
  const [_RUN_RESULT, setRunResult] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runStatus, setRunStatus] = useState('idle')
  const [consoleOutput, setConsoleOutput] = useState('')
  const [practiceStdin, setPracticeStdin] = useState('')
  const [error, setError] = useState('')
  const [_LAST_SELECTED_FILE_ID, setLastSelectedFileId] = useState(null)
  const [isCreatingPracticeFile, setIsCreatingPracticeFile] = useState(false)
  const [practiceFileName, setPracticeFileName] = useState('')
  const [isRenamingPracticeFile, setIsRenamingPracticeFile] = useState(false)
  const [practiceRenameValue, setPracticeRenameValue] = useState('')
  const [pendingPracticeSelectPath, setPendingPracticeSelectPath] = useState('')
  const [showTerminalShareConfirm, setShowTerminalShareConfirm] = useState(false)
  const [isUploadingAsset, setIsUploadingAsset] = useState(false)
  const [runtimeHealth, setRuntimeHealth] = useState(null)
  const [isProjectLoading, setIsProjectLoading] = useState(true)
  const [isOpeningLivePreview, setIsOpeningLivePreview] = useState(false)
  const [templateCatalog, setTemplateCatalog] = useState([])
  const [isAiChatGenerating, setIsAiChatGenerating] = useState(false)
  const monacoConfiguredRef = useRef(false)
  const monacoRef = useRef(null)
  const editorRef = useRef(null)
  const practiceFileInputRef = useRef(null)
  const editorFocusedRef = useRef(false)
  const selectedFileIdRef = useRef(null)
  const typingGuardUntilRef = useRef(0)
  const latestLocalEditAtRef = useRef(new Map())
  const latestLocalEditVersionRef = useRef(new Map())
  const collabLastIssueAtRef = useRef(new Map())
  const disconnectWarnTimerRef = useRef(null)
  const latestProjectIdRef = useRef(projectId)
  const latestTokenRef = useRef(token)
  const ghostSuggestionTextRef = useRef('')
  const ghostSuggestionRangeRef = useRef(null)
  const ghostSuggestionFileIdRef = useRef('')
  const ghostRequestSeqRef = useRef(0)
  const ghostDebounceTimerRef = useRef(null)
  const ghostInlineProviderDisposeRef = useRef(null)
  const ghostEditorActionDisposablesRef = useRef([])
  const debugHoverWidgetRef = useRef(null)
  const debugHoverDisposablesRef = useRef([])
  const debugHoverHideTimerRef = useRef(null)

  useEffect(() => {
    latestProjectIdRef.current = projectId
    latestTokenRef.current = token
  }, [projectId, token])

  const reportCollabIssue = useCallback((message, details) => {
    const issueKey = String(message || 'unknown')
    const nowMs = Date.now()
    const previousAt = Number(collabLastIssueAtRef.current.get(issueKey) || 0)
    if (nowMs - previousAt < 1000) return
    collabLastIssueAtRef.current.set(issueKey, nowMs)

    if (details) {
      console.warn('[collab]', message, details)
    } else {
      console.warn('[collab]', message)
    }
  }, [])

  useEffect(() => {
    latestLocalEditAtRef.current.clear()
    latestLocalEditVersionRef.current.clear()
    typingGuardUntilRef.current = 0
  }, [projectId])

  const selectedFile = useMemo(() => {
    if (!selectedFileId) return null
    return files.find((file) => file.id === selectedFileId) || null
  }, [files, selectedFileId])

  const resolvedRole = project?.role || (project?.ownerId === user?.id ? 'owner' : undefined)
  const canEdit = Boolean(
    typeof project?.canEdit === 'boolean'
      ? project.canEdit
      : resolvedRole === 'owner' || resolvedRole === 'collaborator',
  )
  const isOwner = resolvedRole === 'owner'
  const canUseAiAssistant = canEdit

  const projectSymbolIndex = useMemo(() => {
    const byFile = new Map()
    const allComponents = new Set()
    const allExports = new Set()

    for (const file of files) {
      const pathValue = normalizePath(file?.path || file?.name || '')
      if (!pathValue) continue

      const stem = fileStemFromPath(pathValue)
      const exportsList = extractExportedSymbols(String(file?.content || ''))
      for (const symbol of exportsList) {
        allExports.add(symbol)
      }

      if (isPascalCase(stem)) {
        allComponents.add(stem)
      }

      byFile.set(pathValue, {
        path: pathValue,
        stem,
        exports: exportsList,
      })
    }

    return {
      byFile,
      allComponents: Array.from(allComponents),
      allExports: Array.from(allExports),
    }
  }, [files])

  const projectGhostSummary = useMemo(() => {
    const lines = files
      .map((file) => normalizePath(file.path || file.name || ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, GHOST_PROJECT_SUMMARY_MAX_FILES)

    if (!lines.length) return ''
    return lines.join('\n')
  }, [files])

  const clearGhostSuggestion = useCallback(() => {
    ghostSuggestionTextRef.current = ''
    ghostSuggestionRangeRef.current = null
    ghostSuggestionFileIdRef.current = ''

    const editor = editorRef.current
    if (editor) {
      editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.hide', {})
    }
  }, [])

  const fetchGhostSuggestion = useCallback(async () => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !selectedFile || !projectId || !canEdit || isAiChatGenerating) {
      clearGhostSuggestion()
      return
    }

    const model = editor.getModel()
    const position = editor.getPosition()
    if (!model || !position) {
      clearGhostSuggestion()
      return
    }

    const lineContent = model.getLineContent(position.lineNumber)
    const atLineEnd = position.column === lineContent.length + 1
    if (!atLineEnd) {
      clearGhostSuggestion()
      return
    }

    const lineCount = model.getLineCount()
    const startLine = Math.max(1, position.lineNumber - GHOST_CONTEXT_WINDOW_LINES)
    const endLine = Math.min(lineCount, position.lineNumber + GHOST_CONTEXT_WINDOW_LINES)

    const contextBefore = model.getValueInRange({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })

    const contextAfter = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: endLine,
      endColumn: model.getLineMaxColumn(endLine),
    })

    const requestSeq = ghostRequestSeqRef.current + 1
    ghostRequestSeqRef.current = requestSeq
    const linePrefix = lineContent.slice(0, Math.max(0, position.column - 1))
    const lineSuffix = lineContent.slice(Math.max(0, position.column - 1))

    const buildLocalGhostFallback = () => {
      const normalizedLanguage = String(languageForFile(selectedFile?.name ?? '', project?.language) || '').toLowerCase()
      const isJsTs = normalizedLanguage === 'typescript' || normalizedLanguage === 'javascript'
      if (!isJsTs) return ''

      const trimmedPrefix = linePrefix.trim()

      const importMatch = linePrefix.match(/^\s*import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)
      if (importMatch?.[1] && selectedFile?.path) {
        const symbolName = importMatch[1]
        const candidates = files
          .map((entry) => ({
            entry,
            pathValue: normalizePath(entry?.path || entry?.name || ''),
          }))
          .filter(({ pathValue }) => {
            if (!pathValue || pathValue === normalizePath(selectedFile.path || selectedFile.name || '')) return false
            const stem = fileStemFromPath(pathValue)
            const meta = projectSymbolIndex.byFile.get(pathValue)
            const hasExportPrefix = Array.isArray(meta?.exports)
              ? meta.exports.some((item) => item === symbolName || item.startsWith(symbolName))
              : false
            return stem === symbolName || stem.startsWith(symbolName) || hasExportPrefix
          })
          .sort((a, b) => {
            const stemA = fileStemFromPath(a.pathValue)
            const stemB = fileStemFromPath(b.pathValue)
            const score = (stem) => {
              if (stem === symbolName) return 0
              if (stem.startsWith(symbolName)) return 1
              return 2
            }
            const scoreA = score(stemA)
            const scoreB = score(stemB)
            if (scoreA !== scoreB) return scoreA - scoreB
            return stemA.length - stemB.length
          })

        const candidate = candidates[0]?.entry || null
        if (candidate) {
          const candidatePath = normalizePath(candidate.path || candidate.name || '')
          const stem = fileStemFromPath(candidatePath)
          const completionTail = stem.startsWith(symbolName)
            ? stem.slice(symbolName.length)
            : ''

          const candidateWithoutExt = candidatePath.replace(/\.[^.\/]+$/, '')
          const fromPath = normalizePath(selectedFile.path || selectedFile.name || '')
          const relative = toRelativeImportPath(fromPath, candidateWithoutExt)
          return `${completionTail} from '${relative}'`
        }

        const exact = files.find((entry) => {
          const pathValue = normalizePath(entry?.path || entry?.name || '')
          if (!pathValue || pathValue === normalizePath(selectedFile.path || selectedFile.name || '')) return false
          const stem = fileStemFromPath(pathValue)
          return stem === symbolName
        })

        if (exact) {
          const candidatePath = normalizePath(exact.path || exact.name || '')
          const candidateWithoutExt = candidatePath.replace(/\.[^.\/]+$/, '')
          const fromPath = normalizePath(selectedFile.path || selectedFile.name || '')
          const relative = toRelativeImportPath(fromPath, candidateWithoutExt)
          return ` from '${relative}'`
        }
      }

      if (trimmedPrefix === 'export') {
        const inferred = String(model.getValue().match(/function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/)?.[1] || 'App')
        return ` default ${inferred}`
      }

      const jsxTagMatch = linePrefix.match(/<([A-Z][A-Za-z0-9_$]*)$/)
      if (jsxTagMatch?.[1]) {
        const typedTag = jsxTagMatch[1]
        const source = model.getValue()
        const importedComponents = new Set()

        const inferJsxPropsSnippet = (componentName) => {
          const componentFile = files.find((entry) => {
            const entryPath = normalizePath(entry?.path || entry?.name || '')
            if (!entryPath) return false
            return fileStemFromPath(entryPath) === componentName
          })

          const componentSource = String(componentFile?.content || '')
          if (!componentSource.trim()) return ' />'

          const propsTypeMatch = componentSource.match(/type\s+\w*Props\s*=\s*\{([\s\S]*?)\}/m)
          if (!propsTypeMatch?.[1]) return ' />'

          const block = propsTypeMatch[1]
          const requiredProps = []
          const propRegex = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:\s*([^\n;]+)/gm
          for (const match of block.matchAll(propRegex)) {
            const propName = String(match?.[1] || '').trim()
            const propType = String(match?.[2] || '').trim()
            const optional = /\?\s*:/.test(match?.[0] || '')
            if (!propName || optional) continue

            let sampleValue = '""'
            if (/^on[A-Z]/.test(propName)) {
              sampleValue = '{() => {}}'
            } else if (/(^is[A-Z])|active|enabled|visible/i.test(propName) || propType.includes('boolean')) {
              sampleValue = '{false}'
            } else if (/count|num|age|points|score|id/i.test(propName) || /\bnumber\b/i.test(propType)) {
              sampleValue = '{0}'
            } else {
              const unionValue = propType.match(/'([^']+)'\s*(\||$)/)
              if (unionValue?.[1]) {
                sampleValue = `'${unionValue[1]}'`
              }
            }

            requiredProps.push(`${propName}=${sampleValue}`)
            if (requiredProps.length >= 3) break
          }

          if (!requiredProps.length) return ' />'
          return ` ${requiredProps.join(' ')} />`
        }

        const defaultImportRegex = /^\s*import\s+([A-Z][A-Za-z0-9_$]*)\s+from\s+['"][^'"]+['"]/gm
        for (const match of source.matchAll(defaultImportRegex)) {
          if (match?.[1]) importedComponents.add(match[1])
        }

        const namedImportRegex = /^\s*import\s*\{([^}]+)\}\s*from\s+['"][^'"]+['"]/gm
        for (const match of source.matchAll(namedImportRegex)) {
          const namesBlock = String(match?.[1] || '')
          for (const part of namesBlock.split(',')) {
            const aliasPart = String(part || '').trim()
            if (!aliasPart) continue
            const aliasMatch = aliasPart.match(/\bas\s+([A-Z][A-Za-z0-9_$]*)$/)
            const symbol = aliasMatch?.[1] || aliasPart
            if (/^[A-Z][A-Za-z0-9_$]*$/.test(symbol)) {
              importedComponents.add(symbol)
            }
          }
        }

        const projectComponentNames = projectSymbolIndex.allComponents

        const candidates = Array.from(
          new Set([
            ...importedComponents,
            ...projectComponentNames,
            ...projectSymbolIndex.allExports.filter((item) => isPascalCase(item)),
          ]),
        )
          .filter((name) => name.startsWith(typedTag))
          .sort((a, b) => a.length - b.length)

        const best = candidates[0] || ''
        if (best && best !== typedTag) {
          return best.slice(typedTag.length)
        }
        if (best === typedTag) {
          return inferJsxPropsSnippet(best)
        }
      }

      return ''
    }

    try {
      const language = languageForFile(selectedFile?.name ?? '', project?.language)
      const payload = await apiRequest(
        `/projects/${projectId}/ai/ghost-suggestion`,
        {
          method: 'POST',
          body: JSON.stringify({
            filename: selectedFile.path || selectedFile.name || 'untitled',
            language,
            fileContent: model.getValue(),
            contextBefore,
            contextAfter,
            cursorLine: position.lineNumber,
            cursorColumn: position.column,
            linePrefix,
            lineSuffix,
            projectSummary: projectGhostSummary,
          }),
        },
        getAuthToken,
      )

      if (requestSeq !== ghostRequestSeqRef.current) return

      const suggestionText = String(payload?.suggestionText || '')
      const looksMalformedGhost =
        /suggestionText/i.test(suggestionText) ||
        /^\s*\{/.test(suggestionText) ||
        /^\s*\[/.test(suggestionText) ||
        /```/.test(suggestionText)

      if (looksMalformedGhost) {
        const fallback = buildLocalGhostFallback()
        if (!fallback) {
          clearGhostSuggestion()
          return
        }
        ghostSuggestionTextRef.current = fallback
        ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
        ghostSuggestionRangeRef.current = {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }
        editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
        return
      }

      if (!suggestionText.trim()) {
        const fallback = buildLocalGhostFallback()
        if (!fallback) {
          clearGhostSuggestion()
          return
        }
        ghostSuggestionTextRef.current = fallback
        ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
        ghostSuggestionRangeRef.current = {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }
        editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
        return
      }

      ghostSuggestionTextRef.current = suggestionText
      ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
      ghostSuggestionRangeRef.current = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }

      editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
    } catch {
      if (requestSeq !== ghostRequestSeqRef.current) return
      const fallback = buildLocalGhostFallback()
      if (!fallback) {
        clearGhostSuggestion()
        return
      }
      ghostSuggestionTextRef.current = fallback
      ghostSuggestionFileIdRef.current = String(selectedFile.id || '')
      ghostSuggestionRangeRef.current = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }
      editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.trigger', {})
    }
  }, [
    files,
    projectSymbolIndex,
    selectedFile,
    projectId,
    canEdit,
    isAiChatGenerating,
    project?.language,
    projectGhostSummary,
    getAuthToken,
    clearGhostSuggestion,
  ])

  const scheduleGhostSuggestion = useCallback(() => {
    if (ghostDebounceTimerRef.current) {
      window.clearTimeout(ghostDebounceTimerRef.current)
      ghostDebounceTimerRef.current = null
    }

    clearGhostSuggestion()

    if (!canEdit || isAiChatGenerating) {
      return
    }

    ghostDebounceTimerRef.current = window.setTimeout(() => {
      ghostDebounceTimerRef.current = null
      fetchGhostSuggestion()
    }, GHOST_SUGGESTION_DEBOUNCE_MS)
  }, [canEdit, isAiChatGenerating, clearGhostSuggestion, fetchGhostSuggestion])

  const bindGhostEditorActions = useCallback((editor, monaco) => {
    if (!editor || !monaco) return

    for (const disposable of ghostEditorActionDisposablesRef.current) {
      disposable?.dispose?.()
    }
    ghostEditorActionDisposablesRef.current = []

    const disposables = [
      editor.addAction({
        id: 'dc-editor.ghost.accept-all',
        label: 'Accept Ghost Suggestion',
        keybindings: [monaco.KeyCode.Tab],
        precondition: 'inlineSuggestionVisible',
        run: () => {
          editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.commit', {})
          clearGhostSuggestion()
        },
      }),
      editor.addAction({
        id: 'dc-editor.ghost.accept-next-word',
        label: 'Accept Next Word Ghost Suggestion',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow],
        precondition: 'inlineSuggestionVisible',
        run: () => {
          editor.trigger('ghost-suggest', 'editor.action.inlineSuggest.acceptNextWord', {})
        },
      }),
      editor.addAction({
        id: 'dc-editor.ghost.dismiss',
        label: 'Dismiss Ghost Suggestion',
        keybindings: [monaco.KeyCode.Escape],
        precondition: 'inlineSuggestionVisible',
        run: () => {
          clearGhostSuggestion()
        },
      }),
    ]

    ghostEditorActionDisposablesRef.current = disposables
  }, [clearGhostSuggestion])

  const clearDebugHover = useCallback(() => {
    if (debugHoverHideTimerRef.current) {
      window.clearTimeout(debugHoverHideTimerRef.current)
      debugHoverHideTimerRef.current = null
    }

    const current = debugHoverWidgetRef.current
    if (current?.editor && current?.widget) {
      try {
        current.editor.removeContentWidget(current.widget)
      } catch {
        // Ignore editor disposal races.
      }
    }
    debugHoverWidgetRef.current = null
  }, [])

  const bindDebugHoverWidget = useCallback((editor, monaco) => {
    if (!editor || !monaco) return

    for (const disposable of debugHoverDisposablesRef.current) {
      disposable?.dispose?.()
    }
    debugHoverDisposablesRef.current = []
    clearDebugHover()

    const widgetDom = document.createElement('div')
    widgetDom.style.display = 'none'
    widgetDom.style.minWidth = '280px'
    widgetDom.style.maxWidth = '620px'
    widgetDom.style.padding = '8px 10px'
    widgetDom.style.border = '1px solid #334155'
    widgetDom.style.borderRadius = '8px'
    widgetDom.style.background = '#0f172a'
    widgetDom.style.color = '#e2e8f0'
    widgetDom.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.35)'
    widgetDom.style.zIndex = '25'
    widgetDom.style.pointerEvents = 'auto'

    const messageLine = document.createElement('div')
    messageLine.style.fontSize = '12px'
    messageLine.style.lineHeight = '1.35'
    messageLine.style.marginBottom = '8px'
    messageLine.style.whiteSpace = 'pre-wrap'
    widgetDom.appendChild(messageLine)

    const actionsRow = document.createElement('div')
    actionsRow.style.display = 'flex'
    actionsRow.style.gap = '8px'
    actionsRow.style.flexWrap = 'wrap'
    widgetDom.appendChild(actionsRow)

    const makeActionButton = (label, onClick) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.style.border = '1px solid #334155'
      button.style.borderRadius = '6px'
      button.style.background = '#111827'
      button.style.color = '#93c5fd'
      button.style.fontSize = '12px'
      button.style.padding = '3px 8px'
      button.style.cursor = 'pointer'
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick?.()
      })
      return button
    }

    let activeMarker = null
    let isHoveringDebugBox = false

    const viewProblemButton = makeActionButton('View Problem', () => {
      if (!activeMarker) return
      editor.focus()
      editor.setPosition({ lineNumber: activeMarker.startLineNumber, column: activeMarker.startColumn })
      editor.revealLineInCenter(activeMarker.startLineNumber)
    })

    const quickFixButton = makeActionButton('Quick Fix', () => {
      editor.focus()
      editor.trigger('debug-hover', 'editor.action.quickFix', {})
    })

    const fixButton = makeActionButton('Fix', () => {
      editor.focus()
      editor.trigger('debug-hover', 'editor.action.codeAction', {
        kind: 'quickfix',
        apply: 'first',
      })
    })

    actionsRow.appendChild(viewProblemButton)
    actionsRow.appendChild(quickFixButton)
    actionsRow.appendChild(fixButton)

    const widget = {
      getId: () => 'dc-editor-diagnostics-hover',
      getDomNode: () => widgetDom,
      getPosition: () => {
        if (!activeMarker) return null
        return {
          position: {
            lineNumber: Math.max(1, activeMarker.startLineNumber),
            column: Math.max(1, activeMarker.startColumn),
          },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
        }
      },
    }

    const hideSoon = () => {
      if (debugHoverHideTimerRef.current) {
        window.clearTimeout(debugHoverHideTimerRef.current)
      }
      debugHoverHideTimerRef.current = window.setTimeout(() => {
        if (isHoveringDebugBox) return
        widgetDom.style.display = 'none'
        activeMarker = null
        try {
          editor.removeContentWidget(widget)
        } catch {
          // Ignore disposal races.
        }
      }, 900)
    }

    const keepVisible = () => {
      if (debugHoverHideTimerRef.current) {
        window.clearTimeout(debugHoverHideTimerRef.current)
        debugHoverHideTimerRef.current = null
      }
    }

    widgetDom.addEventListener('mouseenter', () => {
      isHoveringDebugBox = true
      keepVisible()
    })
    widgetDom.addEventListener('mouseleave', () => {
      isHoveringDebugBox = false
      hideSoon()
    })

    const showForMarker = (marker) => {
      if (!marker) return
      activeMarker = marker
      messageLine.textContent = String(marker.message || 'Problem detected')
      widgetDom.style.display = 'block'
      editor.addContentWidget(widget)
      editor.layoutContentWidget(widget)
      debugHoverWidgetRef.current = { editor, widget }
    }

    const onMouseMoveDisposable = editor.onMouseMove((event) => {
      const model = editor.getModel()
      const position = event?.target?.position
      if (!model || !position) {
        if (isHoveringDebugBox) return
        hideSoon()
        return
      }

      const markers = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((marker) => Number(marker.severity) === Number(monaco.MarkerSeverity.Error))

      const marker = markers.find((item) => {
        const sameLine = position.lineNumber >= item.startLineNumber && position.lineNumber <= item.endLineNumber
        if (!sameLine) return false

        if (position.lineNumber === item.startLineNumber && position.column < item.startColumn) return false
        if (position.lineNumber === item.endLineNumber && position.column > item.endColumn) return false
        return true
      })

      if (!marker) {
        if (isHoveringDebugBox) return
        hideSoon()
        return
      }

      keepVisible()
      showForMarker(marker)
    })

    const onBlurDisposable = editor.onDidBlurEditorText(() => {
      hideSoon()
    })

    debugHoverDisposablesRef.current = [onMouseMoveDisposable, onBlurDisposable]
  }, [clearDebugHover])

  useEffect(() => {
    if (ghostDebounceTimerRef.current) {
      window.clearTimeout(ghostDebounceTimerRef.current)
      ghostDebounceTimerRef.current = null
    }
    ghostRequestSeqRef.current += 1
    clearGhostSuggestion()
  }, [selectedFile?.id, isAiChatGenerating, canEdit, clearGhostSuggestion])

  useEffect(() => () => {
    if (ghostDebounceTimerRef.current) {
      window.clearTimeout(ghostDebounceTimerRef.current)
      ghostDebounceTimerRef.current = null
    }

    ghostInlineProviderDisposeRef.current?.dispose?.()
    ghostInlineProviderDisposeRef.current = null

    for (const disposable of ghostEditorActionDisposablesRef.current) {
      disposable?.dispose?.()
    }
    ghostEditorActionDisposablesRef.current = []

    for (const disposable of debugHoverDisposablesRef.current) {
      disposable?.dispose?.()
    }
    debugHoverDisposablesRef.current = []
    clearDebugHover()
  }, [])

  useEffect(() => {
    selectedFileIdRef.current = selectedFileId
  }, [selectedFileId])

  const projectFilePathSet = useMemo(() => {
    const paths = new Set()
    for (const file of files) {
      const normalized = normalizePath(file.path || file.name || '')
      if (normalized) {
        paths.add(normalized)
      }
    }
    return paths
  }, [files])

  const dependencyNameSet = useMemo(() => {
    const deps = new Set(['react', 'react-dom'])
    const packageFile = files.find((file) => normalizePath(file.path || file.name || '') === 'package.json')
    const raw = String(packageFile?.content || '')
    if (!raw.trim()) return deps

    try {
      const parsed = JSON.parse(raw)
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const entry = parsed?.[section]
        if (entry && typeof entry === 'object') {
          for (const key of Object.keys(entry)) {
            deps.add(key)
          }
        }
      }
    } catch (parseError) {
      void parseError
    }

    return deps
  }, [files])

  const resolveImportPath = useCallback((fromPath, specifier) => {
    const normalizedFrom = normalizePath(fromPath || '')
    const fromParts = normalizedFrom ? normalizedFrom.split('/') : []
    fromParts.pop()

    const importParts = String(specifier || '').split('/').filter(Boolean)
    for (const part of importParts) {
      if (part === '.') continue
      if (part === '..') {
        if (fromParts.length > 0) fromParts.pop()
        continue
      }
      fromParts.push(part)
    }

    return fromParts.join('/')
  }, [])

  const importExistsInProject = useCallback(
    (fromPath, specifier) => {
      const normalizedSpecifier = String(specifier || '').trim()
      if (!normalizedSpecifier) return true

      const rootAbsolute = normalizedSpecifier.startsWith('/')
      const baseTarget = rootAbsolute
        ? normalizePath(normalizedSpecifier.slice(1))
        : resolveImportPath(fromPath, normalizedSpecifier)

      if (!baseTarget) return false

      const candidatePaths = new Set([baseTarget])
      const extensionMatch = baseTarget.match(/\.(mjs|cjs|js|jsx|ts|tsx|d\.ts)$/)
      if (extensionMatch) {
        const withoutExt = baseTarget.slice(0, -extensionMatch[0].length)
        candidatePaths.add(withoutExt)

        const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']
        for (const sourceExt of sourceExts) {
          candidatePaths.add(`${withoutExt}${sourceExt}`)
          candidatePaths.add(`${withoutExt}/index${sourceExt}`)
        }
      }

      for (const candidatePath of candidatePaths) {
        if (projectFilePathSet.has(candidatePath)) return true
        if (rootAbsolute && projectFilePathSet.has(`public/${candidatePath}`)) return true
      }

      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts', '.json', '.css', '.scss', '.svg', '.png', '.jpg', '.jpeg']
      for (const ext of extensions) {
        if (projectFilePathSet.has(`${baseTarget}${ext}`)) return true
        if (projectFilePathSet.has(`${baseTarget}/index${ext}`)) return true
        if (rootAbsolute && projectFilePathSet.has(`public/${baseTarget}${ext}`)) return true
        if (rootAbsolute && projectFilePathSet.has(`public/${baseTarget}/index${ext}`)) return true
      }

      return false
    },
    [projectFilePathSet, resolveImportPath],
  )

  const validateEditorImports = useCallback(
    (editorInstance, monacoInstance) => {
      if (!editorInstance || !monacoInstance) return
      const model = editorInstance.getModel()
      if (!model) return

      const fullPath = normalizePath(selectedFile?.path || selectedFile?.name || '')
      if (fullPath.startsWith('.next/types/')) {
        monacoInstance.editor.setModelMarkers(model, 'import-validator', [])
        return
      }

      const ext = fullPath.split('.').pop()?.toLowerCase() || ''
      const supportsImportValidation = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)

      if (!supportsImportValidation) {
        monacoInstance.editor.setModelMarkers(model, 'import-validator', [])
        return
      }

      const source = model.getValue()
      const markers = []
      const regex = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g

      for (const match of source.matchAll(regex)) {
        const specifier = match[1] || match[2] || ''
        if (!specifier) continue

        const fullMatch = match[0]
        const quoteWrapped = fullMatch.match(/["'][^"']+["']/)
        const quoteText = quoteWrapped?.[0] || ''
        const quoteInnerOffset = quoteText ? fullMatch.indexOf(quoteText) + 1 : 0
        const specStartIndex = (match.index || 0) + quoteInnerOffset
        const startPos = model.getPositionAt(specStartIndex)
        const endPos = model.getPositionAt(specStartIndex + specifier.length)

        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          if (!importExistsInProject(fullPath, specifier)) {
            markers.push({
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
              message: `Cannot resolve import path "${specifier}" in project files.`,
              severity: monacoInstance.MarkerSeverity.Error,
            })
          }
          continue
        }

        if (specifier.startsWith('node:')) continue

        const packageName = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0]

        if (!dependencyNameSet.has(packageName)) {
          markers.push({
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
            message: `Package "${packageName}" is not listed in package.json dependencies.`,
            severity: monacoInstance.MarkerSeverity.Error,
          })
        }
      }

      monacoInstance.editor.setModelMarkers(model, 'import-validator', markers)
    },
    [dependencyNameSet, importExistsInProject, selectedFile?.name, selectedFile?.path],
  )

  const configureMonaco = useCallback((monaco) => {
    if (!monaco || monacoConfiguredRef.current) return

    const providerLanguageIds = [
      'javascript',
      'typescript',
      'json',
      'html',
      'css',
      'markdown',
      'plaintext',
      'python',
      'java',
      'cpp',
      'c',
      'sql',
      'vue',
      'shell',
      'yaml',
      'xml',
      'go',
      'rust',
      'php',
    ]

    const providerDisposables = providerLanguageIds.map((languageId) =>
      monaco.languages.registerInlineCompletionsProvider(languageId, {
        provideInlineCompletions: (model, position) => {
          const editor = editorRef.current
          if (!editor || model !== editor.getModel()) {
            return { items: [] }
          }

          if (String(ghostSuggestionFileIdRef.current || '') !== String(selectedFileIdRef.current || '')) {
            return { items: [] }
          }

          const range = ghostSuggestionRangeRef.current
          const text = String(ghostSuggestionTextRef.current || '')
          if (!range || !text) {
            return { items: [] }
          }

          const samePosition =
            range.startLineNumber === position.lineNumber &&
            range.startColumn === position.column &&
            range.endLineNumber === position.lineNumber &&
            range.endColumn === position.column

          if (!samePosition) {
            return { items: [] }
          }

          return {
            items: [
              {
                insertText: text,
                range,
              },
            ],
          }
        },
        freeInlineCompletions: () => {},
      }),
    )

    const fixLanguageIds = ['javascript', 'typescript']
    const codeActionDisposables = fixLanguageIds.map((languageId) =>
      monaco.languages.registerCodeActionProvider(languageId, {
        provideCodeActions: (model, range, context) => {
          const actions = []
          const markers = Array.isArray(context?.markers) ? context.markers : []

          for (const marker of markers) {
            const message = String(marker?.message || '').toLowerCase()
            const lineNumber = Number(marker?.startLineNumber || range.startLineNumber || 1)
            const lineContent = model.getLineContent(Math.max(1, lineNumber))

            if (message.includes("'export' expected") || message.includes('export expected')) {
              if (/export\.\s*default/.test(lineContent)) {
                const fixedLine = lineContent.replace(/export\.\s*default/g, 'export default')
                actions.push({
                  title: 'Replace "export." with "export "',
                  kind: 'quickfix',
                  edit: {
                    edits: [
                      {
                        resource: model.uri,
                        textEdit: {
                          range: {
                            startLineNumber: lineNumber,
                            startColumn: 1,
                            endLineNumber: lineNumber,
                            endColumn: model.getLineMaxColumn(lineNumber),
                          },
                          text: fixedLine,
                        },
                      },
                    ],
                  },
                  diagnostics: [marker],
                  isPreferred: true,
                })
              }
            }

            if (message.includes('array element destructuring pattern expected')) {
              if (/\[.*?,\s*\./.test(lineContent)) {
                const fixedLine = lineContent.replace(/,\s*\./g, ', ')
                actions.push({
                  title: 'Remove invalid "." in array destructuring',
                  kind: 'quickfix',
                  edit: {
                    edits: [
                      {
                        resource: model.uri,
                        textEdit: {
                          range: {
                            startLineNumber: lineNumber,
                            startColumn: 1,
                            endLineNumber: lineNumber,
                            endColumn: model.getLineMaxColumn(lineNumber),
                          },
                          text: fixedLine,
                        },
                      },
                    ],
                  },
                  diagnostics: [marker],
                  isPreferred: true,
                })
              }
            }
          }

          return {
            actions,
            dispose: () => {},
          }
        },
      }),
    )

    ghostInlineProviderDisposeRef.current = {
      dispose: () => {
        for (const disposable of providerDisposables) {
          disposable?.dispose?.()
        }
        for (const disposable of codeActionDisposables) {
          disposable?.dispose?.()
        }
      },
    }

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: false,
    })

    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: false,
    })

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ES2022,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
    })

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ES2022,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowJs: true,
      checkJs: false,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
    })

    monacoConfiguredRef.current = true
  }, [])

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return
    validateEditorImports(editorRef.current, monacoRef.current)
  }, [validateEditorImports, selectedFile?.id, files])

  useEffect(() => {
    if (!selectedFile?.id || !projectId) return
    const selectedPath = selectedFile.path || selectedFile.name || ''
    const isSvgFile = isSvgPath(selectedPath)
    if (!selectedFile.blobUrl && !isSvgFile) return
    if (selectedFile.isBinary && !isSvgFile) return
    if (typeof selectedFile.content === 'string' && selectedFile.content.length > 0) return

    let cancelled = false

    const loadSelectedFileContent = async () => {
      try {
        const data = await apiRequest(`/projects/${projectId}/files/${selectedFile.id}/content`, {}, getAuthToken)
        if (cancelled) return
        setFiles((prev) =>
          prev.map((file) => (file.id === selectedFile.id ? { ...file, content: data.content ?? '' } : file)),
        )
      } catch (loadContentError) {
        void loadContentError
      }
    }

    loadSelectedFileContent()

    return () => {
      cancelled = true
    }
  }, [selectedFile?.id, selectedFile?.blobUrl, selectedFile?.path, selectedFile?.name, selectedFile?.content, selectedFile?.isBinary, projectId, getAuthToken])

  // Track the last non-null file selection to prevent losing context during operations
  useEffect(() => {
    if (selectedFileId) {
      setLastSelectedFileId(selectedFileId)
    }
  }, [selectedFileId])

  const selectedFileIsImage = Boolean(
    selectedFile && (selectedFile.isBinary || isImagePath(selectedFile.path || selectedFile.name || '')),
  )
  const selectedFilePreviewSrc = useMemo(() => {
    if (!selectedFile) return ''

    const filePath = selectedFile.path || selectedFile.name || ''
    if (isSvgPath(filePath) && typeof selectedFile.content === 'string' && selectedFile.content.trim().length > 0) {
      const rawContent = selectedFile.content.trim()
      if (rawContent.startsWith('data:image/')) {
        return rawContent
      }
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(selectedFile.content)}`
    }

    if (selectedFile.blobUrl) return selectedFile.blobUrl

    return ''
  }, [selectedFile])
  const _TREE_ROWS = useMemo(() => buildTreeRows(folders, files), [folders, files])
  const filteredChat = useMemo(() => {
    const query = String(chatSearch || '').trim().toLowerCase()
    if (!query) return chat
    return chat.filter((message) => {
      const text = String(message?.message || '').toLowerCase()
      const name = String(message?.userName || '').toLowerCase()
      return text.includes(query) || name.includes(query)
    })
  }, [chat, chatSearch])

  const formatLastSeen = (value) => {
    if (!value) return 'Never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString()
  }

  useEffect(() => {
    if (!token) return

    const loadProject = async () => {
      setIsProjectLoading(true)
      try {
        const data = await apiRequest(`/projects/${projectId}`, {}, getAuthToken)
        const normalizedProject = normalizeProjectPayload(data.project, user?.id)
        setProject(normalizedProject)
        setFiles(normalizedProject?.files || [])
        setFolders(normalizedProject?.folders || [])
        setChat(normalizedProject?.chat || [])
        setSelectedFileId((prev) => prev ?? normalizedProject?.files?.[0]?.id ?? null)
        setError('')
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsProjectLoading(false)
      }
    }

    loadProject()
  }, [projectId, token, getAuthToken, user?.id])

  useEffect(() => {
    let cancelled = false

    const loadTemplateCatalog = async () => {
      try {
        const data = await apiRequest('/templates')
        if (!cancelled) {
          setTemplateCatalog(Array.isArray(data.templates) ? data.templates : [])
        }
      } catch {
        if (!cancelled) {
          setTemplateCatalog([])
        }
      }
    }

    loadTemplateCatalog()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadHealth = async () => {
      try {
        const data = await apiRequest('/health')
        if (cancelled) return
        setRuntimeHealth(data)
        setError((prev) =>
          String(prev || '').includes('Cannot reach backend server')
            ? ''
            : prev,
        )
      } catch (healthError) {
        void healthError
      }
    }

    loadHealth()
    const timerId = setInterval(loadHealth, 12000)

    return () => {
      cancelled = true
      clearInterval(timerId)
    }
  }, [projectId])

  const cloudinaryOn = Boolean(runtimeHealth?.storage?.cloudinary)
  const postgresOn = Boolean(runtimeHealth?.storage?.postgres)
  const queueOn = Boolean(runtimeHealth?.queue?.enabled)
  const redisOn = Boolean(runtimeHealth?.queue?.redis)

  useEffect(() => {
    if (!token || !projectId) return

    let cancelled = false

    const loadActivity = async () => {
      try {
        const data = await apiRequest(`/projects/${projectId}/activity?limit=100`, {}, getAuthToken)
        if (!cancelled) {
          const normalized = Array.isArray(data.activities) ? data.activities : []
          const nonChatActivities = normalized.filter(
            (entry) => String(entry?.activityType || '').toLowerCase() !== 'chat_message_sent',
          )
          setActivities(nonChatActivities.slice(0, 25))
        }
      } catch (activityError) {
        void activityError
      }
    }

    loadActivity()
    const timerId = setInterval(loadActivity, 8000)

    return () => {
      cancelled = true
      clearInterval(timerId)
    }
  }, [projectId, token, getAuthToken])

  useEffect(() => {
    if (!token || !projectId || !isOwner || !showMembersPanel) return

    let cancelled = false

    const loadMembers = async () => {
      if (!cancelled) {
        setMembersLoading(true)
      }

      try {
        const data = await apiRequest(`/projects/${projectId}/members`, {}, getAuthToken)
        if (!cancelled) {
          setMembers(data.members || [])
        }
      } catch (membersError) {
        if (!cancelled) {
          setError(membersError.message || 'Failed to load members')
        }
      } finally {
        if (!cancelled) {
          setMembersLoading(false)
        }
      }
    }

    loadMembers()
    const timerId = setInterval(loadMembers, 6000)

    return () => {
      cancelled = true
      clearInterval(timerId)
    }
  }, [projectId, token, isOwner, showMembersPanel, getAuthToken])

  useEffect(() => {
    if (!pendingPracticeSelectPath) return
    const target = pendingPracticeSelectPath.toLowerCase()
    const created = files.find((file) => normalizePath(file.path || file.name).toLowerCase() === target)
    if (!created) return

    setSelectedFileId(created.id)
    setPendingPracticeSelectPath('')
  }, [files, pendingPracticeSelectPath])

  useEffect(() => {
    if (!isCreatingPracticeFile) return
    const input = practiceFileInputRef.current
    if (!input) return

    const fileName = String(practiceFileName || '')
    const dotIndex = fileName.lastIndexOf('.')
    const selectionEnd = dotIndex > 0 ? dotIndex : fileName.length

    setTimeout(() => {
      try {
        input.focus()
        input.setSelectionRange(0, selectionEnd)
      } catch (selectionError) {
        void selectionError
      }
    }, 0)
  }, [isCreatingPracticeFile, practiceFileName])

  useEffect(() => {
    if (!token) return

    const socket = getSocket(token)
    if (!socket || !projectId) return

    const joinProjectRoom = () => {
      socket.emit('project:join', { projectId })
    }

    const onSnapshot = (snapshot) => {
      if (snapshot.id !== projectId) return
      const normalizedSnapshot = normalizeProjectPayload(snapshot, user?.id)
      setProject(normalizedSnapshot)
      setFiles((prev) => {
        const now = Date.now()
        const typingGuardActive = now < Number(typingGuardUntilRef.current || 0)
        const previousById = new Map((prev || []).map((file) => [file.id, file]))
        return (normalizedSnapshot?.files || []).map((incomingFile) => {
          const previousFile = previousById.get(incomingFile.id)
          if (!previousFile || incomingFile.isBinary) return incomingFile

          const previousUpdatedAtMs = Date.parse(String(previousFile.updatedAt || ''))
          const incomingUpdatedAtMs = Date.parse(String(incomingFile.updatedAt || ''))
          if (
            Number.isFinite(previousUpdatedAtMs) &&
            Number.isFinite(incomingUpdatedAtMs) &&
            incomingUpdatedAtMs < previousUpdatedAtMs
          ) {
            return {
              ...incomingFile,
              content: previousFile.content ?? incomingFile.content,
              updatedAt: previousFile.updatedAt || incomingFile.updatedAt,
            }
          }

          const shouldProtectWhileTyping = typingGuardActive && selectedFileIdRef.current === incomingFile.id

          if (shouldProtectWhileTyping) {
            return {
              ...incomingFile,
              content: previousFile.content ?? incomingFile.content,
              updatedAt: previousFile.updatedAt || incomingFile.updatedAt,
            }
          }

          return incomingFile
        })
      })
      setFolders(normalizedSnapshot?.folders || [])
      setChat((prev) => mergeChatMessages(normalizedSnapshot?.chat, prev))
      // Maintain current file selection if it still exists, otherwise keep the selection
      setSelectedFileId((prev) => {
        // If something is currently selected, keep it
        if (prev) {
          // Check if the selected file still exists in the updated files
          const stillExists = (normalizedSnapshot?.files || []).some((f) => f.id === prev)
          if (stillExists) return prev
          // If it was deleted, keep null to trigger selection of first file
          return null
        }
        // If nothing is selected, select the first file
        return normalizedSnapshot?.files?.[0]?.id ?? null
      })
      setError('')
    }

    const onCreated = (file) => {
      setFiles((prev) => [...prev, file])
      setSelectedFileId((prev) => prev ?? file.id)
    }

    const onRenamed = (payload) => {
      setFiles((prev) => prev.map((file) => (file.id === payload.fileId ? { ...file, ...payload } : file)))
    }

    const onDeleted = ({ fileId }) => {
      setFiles((prev) => prev.filter((file) => file.id !== fileId))
      setSelectedFileId((prev) => (prev === fileId ? null : prev))
    }

    const onUpdated = ({ fileId, content, updatedAt, clientUpdatedAt, userId: eventUserId }) => {
      const incomingUpdatedAtMs = Date.parse(String(updatedAt || ''))
      const incomingClientVersion = Number(clientUpdatedAt)

      setFiles((prev) =>
        prev.map((file) =>
          file.id === fileId
            ? (() => {
                const previousUpdatedAtMs = Date.parse(String(file.updatedAt || ''))
                const latestLocalVersion = Number(latestLocalEditVersionRef.current.get(fileId) || 0)
                const isOwnEcho = String(eventUserId || '') === String(user?.id || '')

                if (
                  Number.isFinite(previousUpdatedAtMs) &&
                  Number.isFinite(incomingUpdatedAtMs) &&
                  incomingUpdatedAtMs < previousUpdatedAtMs
                ) {
                  return file
                }

                if (
                  isOwnEcho &&
                  Number.isFinite(incomingClientVersion) &&
                  latestLocalVersion > 0 &&
                  incomingClientVersion <= latestLocalVersion
                ) {
                  return file
                }

                return {
                  ...file,
                  content,
                  updatedAt,
                }
              })()
            : file,
        ),
      )
    }

    const onCursorUpdated = ({ fileId, position, userId, userName, avatarUrl, isTyping }) => {
      if (String(userId || '') === String(user?.id || '')) return
      if (!isTyping) return

      setRemoteCursors((prev) => ({
        ...prev,
        [userId]: {
          userName,
          fileId,
          position,
          avatarUrl: String(avatarUrl || '').trim(),
          color: pickCursorColor(userId),
          lastActiveAt: Date.now(),
          isTyping: true,
        },
      }))
    }

    const onChatMessage = (message) => {
      setChat((prev) => {
        if (message?.clientMessageId) {
          const index = prev.findIndex((entry) => entry.clientMessageId === message.clientMessageId)
          if (index >= 0) {
            const next = [...prev]
            next[index] = message
            return next
          }
        }
        return [...prev, message]
      })
    }

    const onSocketError = (payload) => {
      setError(payload?.message || 'Operation failed')
    }

    const onDisconnect = (reason) => {
      const normalizedReason = String(reason || '').trim().toLowerCase()
      if (normalizedReason === 'io client disconnect') return

      if (disconnectWarnTimerRef.current) {
        window.clearTimeout(disconnectWarnTimerRef.current)
      }

      disconnectWarnTimerRef.current = window.setTimeout(() => {
        if (socket.connected) return
        reportCollabIssue(`Realtime disconnected: ${String(reason || 'unknown_reason')}`)
      }, 1800)
    }

    const onProjectDeleted = ({ projectId: deletedProjectId }) => {
      if (deletedProjectId !== projectId) return
      navigate('/dashboard')
    }

    const onProjectAccessRemoved = ({ projectId: removedProjectId, message }) => {
      if (removedProjectId !== projectId) return
      setError(message || 'Your access to this project has been removed.')
      navigate('/dashboard')
    }

    const onConnectError = async (connectError) => {
      const message = connectError?.message || ''
      if (!/unauthorized/i.test(message)) return

      const freshToken = await getAuthToken(true)
      if (!freshToken) {
        setError('Session expired. Please login again.')
        return
      }

      const refreshedSocket = getSocket(freshToken)
      refreshedSocket?.connect()
    }

    const onConnect = () => {
      if (disconnectWarnTimerRef.current) {
        window.clearTimeout(disconnectWarnTimerRef.current)
        disconnectWarnTimerRef.current = null
      }
      joinProjectRoom()
    }

    if (socket.connected) {
      onConnect()
    }

    socket.on('connect', onConnect)
    socket.on('connect_error', onConnectError)
    socket.on('disconnect', onDisconnect)
    socket.on('project:snapshot', onSnapshot)
    socket.on('file:created', onCreated)
    socket.on('file:renamed', onRenamed)
    socket.on('file:deleted', onDeleted)
    socket.on('file:updated', onUpdated)
    socket.on('cursor:updated', onCursorUpdated)
    socket.on('chat:message', onChatMessage)
    socket.on('error:event', onSocketError)
    socket.on('project:deleted', onProjectDeleted)
    socket.on('project:access-removed', onProjectAccessRemoved)

    return () => {
      if (disconnectWarnTimerRef.current) {
        window.clearTimeout(disconnectWarnTimerRef.current)
        disconnectWarnTimerRef.current = null
      }
      socket.off('connect', onConnect)
      socket.off('connect_error', onConnectError)
      socket.off('disconnect', onDisconnect)
      socket.off('project:snapshot', onSnapshot)
      socket.off('file:created', onCreated)
      socket.off('file:renamed', onRenamed)
      socket.off('file:deleted', onDeleted)
      socket.off('file:updated', onUpdated)
      socket.off('cursor:updated', onCursorUpdated)
      socket.off('chat:message', onChatMessage)
      socket.off('error:event', onSocketError)
      socket.off('project:deleted', onProjectDeleted)
      socket.off('project:access-removed', onProjectAccessRemoved)
    }
  }, [projectId, token, getAuthToken, navigate, user?.id])

  useEffect(() => {
    return () => {
      const projectIdValue = latestProjectIdRef.current
      const tokenValue = latestTokenRef.current
      if (!projectIdValue || !tokenValue) return

      const socket = getSocket(tokenValue)
      if (!socket) return

      socket.emit('project:leave', { projectId: projectIdValue })
      socket.emit('terminal:stop-all', { projectId: projectIdValue })
    }
  }, [])

  const emit = useCallback((eventName, payload) => {
    const socket = getSocket(token)
    if (socket) {
      socket.emit(eventName, payload)
    }
  }, [token])

  const queueFileUpdate = useCallback(
    (fileId, content) => {
      if (!fileId) return

      const previousVersion = Number(latestLocalEditVersionRef.current.get(fileId) || 0)
      // Use a monotonic clock-based version so reconnects do not restart at 1 and get rejected as stale.
      const nowVersion = Date.now()
      const nextVersion = Math.max(nowVersion, previousVersion + 1)
      latestLocalEditVersionRef.current.set(fileId, nextVersion)

      const socket = getSocket(token)
      if (!socket) {
        reportCollabIssue('Socket unavailable while sending file update.')
        return
      }

      const shouldTrackAck = Boolean(socket.connected)

      let hasAck = false
      const ackTimeout = shouldTrackAck
        ? window.setTimeout(() => {
            if (hasAck) return
            reportCollabIssue('File update timed out waiting for server acknowledgement.', {
              projectId,
              fileId,
              clientUpdatedAt: nextVersion,
              socketConnected: socket.connected,
              socketId: socket.id || null,
            })
          }, COLLAB_ACK_TIMEOUT_MS)
        : null

      socket.emit('file:update', {
        projectId,
        fileId,
        content,
        clientUpdatedAt: nextVersion,
      }, (ack) => {
        hasAck = true
        if (ackTimeout) {
          window.clearTimeout(ackTimeout)
        }
        if (!ack || ack.ok !== false) return
        reportCollabIssue(`File update rejected: ${ack.reason || 'unknown_reason'}`, {
          projectId,
          fileId,
          clientUpdatedAt: nextVersion,
          ack,
        })
      })
    },
    [projectId, token, reportCollabIssue],
  )

  const createFile = (targetFolderPath = selectedFolderPath, fileName = '') => {
    if (!canEdit) return
    const name = String(fileName || '').trim()
    if (!name) return
    const parentPath = normalizePath(targetFolderPath || '')
    const nextPath = normalizePath(parentPath ? `${parentPath}/${name}` : name)
    emit('file:create', { projectId, path: nextPath, content: '' })
  }

  const createPracticeFile = () => {
    if (!canEdit) return
    setError('')
    setIsRenamingPracticeFile(false)
    setPracticeRenameValue('')
    setIsCreatingPracticeFile(true)
    if (practiceFileName.trim()) return

    const extensionMap = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      cpp: 'cpp',
      java: 'java',
    }
    const preferredExt = extensionMap[project?.language] || 'txt'
    setPracticeFileName(`file_${files.length + 1}.${preferredExt}`)
  }

  const cancelPracticeFileCreate = () => {
    setIsCreatingPracticeFile(false)
    setPracticeFileName('')
  }

  const startPracticeRename = () => {
    if (!canEdit || !selectedFile) return
    setError('')
    setIsCreatingPracticeFile(false)
    setPracticeFileName('')
    setIsRenamingPracticeFile(true)
    setPracticeRenameValue(selectedFile.path || selectedFile.name || '')
  }

  const cancelPracticeRename = () => {
    setIsRenamingPracticeFile(false)
    setPracticeRenameValue('')
  }

  const submitPracticeRename = () => {
    if (!canEdit || !selectedFile) return

    const name = practiceRenameValue.trim()
    if (!name) {
      setError('File name is required.')
      return
    }

    const duplicate = files.some(
      (file) =>
        file.id !== selectedFile.id &&
        normalizePath(file.path || file.name).toLowerCase() === normalizePath(name).toLowerCase(),
    )
    if (duplicate) {
      setError('A file with this name already exists.')
      return
    }

    renameFile(selectedFile.id, name)
    setError('')
    setIsRenamingPracticeFile(false)
    setPracticeRenameValue('')
  }

  const submitPracticeFileCreate = () => {
    if (!canEdit) return

    const name = practiceFileName.trim()
    if (!name) {
      setError('File name is required.')
      return
    }

    const nextPath = normalizePath(name)
    if (project?.projectType === 'practice' && !runtimeMatchesPracticeLanguage(project?.language, nextPath)) {
      setError(`This DSA project only supports ${String(project?.language || '').toUpperCase()} files.`)
      return
    }

    const duplicate = files.some((file) => normalizePath(file.path || file.name).toLowerCase() === nextPath.toLowerCase())
    if (duplicate) {
      setError('A file with this name already exists.')
      return
    }

    createFile('', name)
    setPendingPracticeSelectPath(normalizePath(name))
    setError('')
    setIsCreatingPracticeFile(false)
    setPracticeFileName('')
  }

  const renameFile = (fileId, newPathValue) => {
    if (!canEdit || !fileId) return
    const newPath = normalizePath(newPathValue || '')
    if (!newPath) return

    if (project?.projectType === 'practice' && !runtimeMatchesPracticeLanguage(project?.language, newPath)) {
      setError(`This DSA project only supports ${String(project?.language || '').toUpperCase()} files.`)
      return
    }

    const file = files.find((item) => item.id === fileId)
    if (file && normalizePath(file.path) === newPath) return

    emit('file:rename', { projectId, fileId, newPath })
  }

  const deleteFile = (fileId) => {
    if (!canEdit) return
    emit('file:delete', { projectId, fileId })
  }

  const createFolder = (targetFolderPath = selectedFolderPath, folderName = '') => {
    if (!canEdit) return
    const name = String(folderName || '').trim()
    if (!name) return
    const parentPath = normalizePath(targetFolderPath || '')
    const nextFolderPath = normalizePath(parentPath ? `${parentPath}/${name}` : name)
    emit('folder:create', { projectId, folderPath: nextFolderPath })
  }

  const uploadAssetFile = async (targetFolderPath = selectedFolderPath, file) => {
    if (!canEdit || !file) return
    if (!file.type.startsWith('image/')) {
      setError('Only image files are supported.')
      return
    }

    setError('')
    setIsUploadingAsset(true)

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('Failed to read selected image.'))
        reader.readAsDataURL(file)
      })

      const response = await apiRequest(
        `/projects/${projectId}/files/upload-image`,
        {
          method: 'POST',
          body: JSON.stringify({
            targetFolderPath: normalizePath(targetFolderPath || ''),
            fileName: file.name,
            dataUrl,
          }),
        },
        getAuthToken,
      )

      if (response?.file?.id) {
        setSelectedFileId(response.file.id)
      }
    } catch (uploadError) {
      setError(uploadError.message || 'Failed to upload image.')
    } finally {
      setIsUploadingAsset(false)
    }
  }

  const renameFolder = (folderPath, nextFolderPathValue) => {
    if (!canEdit || !folderPath) return
    const nextFolderPath = normalizePath(nextFolderPathValue || '')
    if (!nextFolderPath) return
    if (normalizePath(folderPath) === nextFolderPath) return

    emit('folder:rename', {
      projectId,
      oldPath: folderPath,
      newPath: nextFolderPath,
    })
  }

  const deleteFolder = (folderPath) => {
    if (!canEdit) return
    emit('folder:delete', { projectId, folderPath })
  }

  const onEditorChange = (value) => {
    if (!selectedFile || !canEdit) return

    const nextContent = value ?? ''
    if (nextContent === String(selectedFile.content ?? '')) return

    const localEditAt = Date.now()
    const localUpdatedAt = new Date(localEditAt).toISOString()
    latestLocalEditAtRef.current.set(selectedFile.id, localEditAt)
    typingGuardUntilRef.current = Date.now() + 120
    setFiles((prev) =>
      prev.map((file) =>
        file.id === selectedFile.id
          ? {
              ...file,
              content: nextContent,
              updatedAt: localUpdatedAt,
            }
          : file,
      ),
    )
    queueFileUpdate(selectedFile.id, nextContent)
    scheduleGhostSuggestion()
  }

  const onSendChat = (event) => {
    event.preventDefault()
    const message = chatInput.trim()
    if (!message) return

    const clientMessageId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    setChat((prev) => [
      ...prev,
      {
        id: clientMessageId,
        clientMessageId,
        message,
        userId: user?.id || 'me',
        userName: user?.name || 'You',
        createdAt: new Date().toISOString(),
      },
    ])

    const socket = getSocket(token)
    if (!socket) {
      reportCollabIssue('Socket unavailable while sending chat message.')
      return
    }

    const shouldTrackAck = Boolean(socket.connected)

    let hasAck = false
    const ackTimeout = shouldTrackAck
      ? window.setTimeout(() => {
          if (hasAck) return
          reportCollabIssue('Chat send timed out waiting for server acknowledgement.', {
            projectId,
            clientMessageId,
            socketConnected: socket.connected,
            socketId: socket.id || null,
          })
        }, COLLAB_ACK_TIMEOUT_MS)
      : null

    socket.emit('chat:send', {
      projectId,
      message,
      clientMessageId,
      userName: user?.name || '',
    }, (ack) => {
      hasAck = true
      if (ackTimeout) {
        window.clearTimeout(ackTimeout)
      }
      if (!ack || ack.ok !== false) return
      reportCollabIssue(`Chat send rejected: ${ack.reason || 'unknown_reason'}`, {
        projectId,
        clientMessageId,
        ack,
      })
    })
    setChatInput('')
  }

  const createInvite = async () => {
    try {
      const data = await apiRequest(
        `/projects/${projectId}/invite`,
        {
          method: 'POST',
          body: JSON.stringify({ role: inviteRole, actorName: user?.name || '' }),
        },
        getAuthToken,
      )
      setInviteCode(data.code)
      setInviteCopied(false)
      setError('')
    } catch (inviteError) {
      setError(inviteError.message)
    }
  }

  const removeMemberAccess = async (member) => {
    if (!member?.userId || removingMemberId) return
    const confirmed = window.confirm(`Remove ${member.userName || 'this user'} from this project?`)
    if (!confirmed) return

    setRemovingMemberId(member.userId)
    setError('')
    try {
      await apiRequest(`/projects/${projectId}/members/${member.userId}`, { method: 'DELETE' }, getAuthToken)
      setMembers((prev) => prev.filter((entry) => entry.userId !== member.userId))
    } catch (removeError) {
      setError(removeError.message || 'Failed to remove access')
    } finally {
      setRemovingMemberId('')
    }
  }

  const copyInviteCode = async () => {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setInviteCopied(true)
      setError('')
    } catch (copyError) {
      void copyError
      setError('Unable to copy invite code')
      setInviteCopied(false)
    }
  }

  const toggleSharedTerminal = (enabled) => {
    if (!isOwner) return
    emit('project:terminal-sharing:update', { projectId, enabled })
    setProject((prev) => (prev ? { ...prev, sharedTerminalEnabled: enabled } : prev))
  }

  const onSharedTerminalCheckboxChange = (enabled) => {
    if (!isOwner) return

    const currentlyEnabled = Boolean(project?.sharedTerminalEnabled)
    if (enabled && !currentlyEnabled) {
      setShowTerminalShareConfirm(true)
      return
    }

    toggleSharedTerminal(enabled)
  }

  const confirmSharedTerminalEnable = () => {
    setShowTerminalShareConfirm(false)
    toggleSharedTerminal(true)
  }

  const cancelSharedTerminalEnable = () => {
    setShowTerminalShareConfirm(false)
  }

  const handleRunClick = async () => {
    if (!selectedFile) {
      setError('No file selected.')
      return
    }

    const selectedPath = normalizePath(selectedFile.path || selectedFile.name)
    if (!isRunnablePath(selectedPath)) {
      setError('Selected file is not runnable. Use .js, .py, .cpp, .java, or .ts')
      return
    }

    if (isPracticeMode && !runtimeMatchesPracticeLanguage(project?.language, selectedPath)) {
      setError(`This DSA project is locked to ${String(project?.language || '').toUpperCase()} files only.`)
      return
    }

    setError('')
    setIsRunning(true)
    setRunStatus('queued')
    setConsoleOutput('')
    setRunResult(null)

    let sourceCode = selectedFile.content || ''
    if (!sourceCode && selectedFile.blobUrl) {
      try {
        const data = await apiRequest(`/projects/${projectId}/files/${selectedFile.id}/content`, {}, getAuthToken)
        sourceCode = data.content || ''
        setFiles((prev) =>
          prev.map((file) => (file.id === selectedFile.id ? { ...file, content: sourceCode } : file)),
        )
      } catch (loadBeforeRunError) {
        void loadBeforeRunError
        setError('Failed to load file content before run.')
        setIsRunning(false)
        return
      }
    }

    try {
      const runResponse = await apiRequest(
        `/projects/${projectId}/run`,
        {
          method: 'POST',
          body: JSON.stringify({
            filePath: selectedPath,
                stdin: practiceStdin,
          }),
        },
        getAuthToken,
      )

      if (!runResponse?.queued) {
        const stdout = runResponse?.stdout || ''
        const stderr = runResponse?.stderr || ''
        const output = [stdout, stderr].filter(Boolean).join('\n')
        setRunResult(runResponse)
        setConsoleOutput(output || '(no output)')
        setRunStatus(runResponse?.ok ? 'completed' : 'failed')
        setIsRunning(false)
        return
      }

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const maxPolls = 120
      let lastStatus = 'queued'

      for (let pollCount = 0; pollCount < maxPolls; pollCount += 1) {
        await sleep(1000)
        let jobResponse = null
        try {
          jobResponse = await apiRequest(`/executions/jobs/${runResponse.jobId}`, {}, getAuthToken)
        } catch (pollError) {
          if (pollCount < maxPolls - 1) {
            continue
          }
          throw pollError
        }
        const job = jobResponse?.job
        if (!job) continue

        if (job.status === 'queued' || job.status === 'running') {
          if (job.status !== lastStatus || pollCount === 0) {
            lastStatus = job.status
            setRunStatus(job.status)
          }
          continue
        }

        const result = job.result || {}
        const stdout = result.stdout || ''
        const stderr = result.stderr || job.errorText || ''
        const output = [stdout, stderr].filter(Boolean).join('\n')

        setRunResult(result)
        setConsoleOutput(output || '(no output)')
        setRunStatus(job.status === 'completed' ? 'completed' : 'failed')
        setIsRunning(false)
        return
      }

      setError('Execution timed out while waiting for job completion.')
      setConsoleOutput('Execution polling timed out.')
      setRunStatus('failed')
      setIsRunning(false)
    } catch (runError) {
      setError(runError.message || 'Execution error')
      setConsoleOutput(`Execution error: ${runError.message || 'Unknown error'}`)
      setRunStatus('failed')
      setIsRunning(false)
    }
  }

  const handleConsoleInput = (input) => {
    const socket = getSocket(token)
    if (socket) {
      socket.emit('code:input', { input })
    }
  }

  const handleCursorChange = (event) => {
    if (!selectedFile || !canEdit) return

    const lastLocalEditAt = Number(latestLocalEditAtRef.current.get(selectedFile.id) || 0)
    const isTyping = Date.now() - lastLocalEditAt <= TYPING_SIGNAL_WINDOW_MS
    if (!isTyping) return

    emit('cursor:update', {
      projectId,
      fileId: selectedFile.id,
      position: {
        lineNumber: event.position?.lineNumber,
        column: event.position?.column,
      },
      isTyping,
    })
  }

  const isPracticeMode = project?.projectType === 'practice'
  const isWebVanillaTemplate = project?.templateId === 'web-vanilla'
  const selectedFilePath = normalizePath(selectedFile?.path || selectedFile?.name || '')
  const selectedFileRunnable = Boolean(
    selectedFilePath &&
      isRunnablePath(selectedFilePath) &&
      (!isPracticeMode || runtimeMatchesPracticeLanguage(project?.language, selectedFilePath)),
  )

  const templateDisplayName = useMemo(() => {
    const templateId = String(project?.templateId || '').trim()
    if (!templateId) return 'Custom'

    const template = (templateCatalog || []).find((entry) => entry.id === templateId)
    const fallbackName = templateId
      .split('-')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')

    if (!template) return fallbackName

    const baseName = template.label || fallbackName
    const variants = Array.isArray(template.variants) ? template.variants : []
    if (!variants.length) return baseName

    const explicitVariantId = String(project?.templateVariantId || '').trim()
    const byId = explicitVariantId ? variants.find((variant) => variant.id === explicitVariantId) : null
    const byLanguage = variants.find(
      (variant) =>
        String(variant.defaultLanguage || '').trim().toLowerCase() ===
        String(project?.language || '').trim().toLowerCase(),
    )
    const fallbackVariant =
      variants.find((variant) => variant.id === template.defaultVariantId) || variants[0]
    const selectedVariant = byId || byLanguage || fallbackVariant

    return selectedVariant ? `${baseName} (${selectedVariant.label})` : baseName
  }, [project?.templateId, project?.templateVariantId, project?.language, templateCatalog])

  const visibleRemoteCursors = Object.entries(remoteCursors).filter(
    ([remoteUserId, value]) =>
      value.fileId === selectedFile?.id && String(remoteUserId || '') !== String(user?.id || ''),
  )

  const activeTypingUsers = useMemo(() => {
    const now = Date.now()

    return Object.entries(remoteCursors)
      .map(([remoteUserId, value]) => {
        const fileName = files.find((file) => file.id === value.fileId)?.name || 'Unknown file'
        return {
          userId: remoteUserId,
          userName: String(value.userName || 'User').trim() || 'User',
          fileId: value.fileId,
          fileName,
          avatarUrl: String(value.avatarUrl || '').trim(),
          color: String(value.color || pickCursorColor(remoteUserId)),
          lastActiveAt: Number(value.lastActiveAt || 0),
          position: value.position || null,
          isTyping: Boolean(value.isTyping),
        }
      })
      .filter(
        (entry) =>
          String(entry.userId || '') !== String(user?.id || '') &&
          entry.isTyping &&
          now - entry.lastActiveAt <= TYPING_ACTIVE_WINDOW_MS,
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }, [remoteCursors, files, user?.id])

  useEffect(() => {
    if (activeTypingUsers.length === 0) return undefined

    const timerId = window.setInterval(() => {
      const cutoff = Date.now() - TYPING_ACTIVE_WINDOW_MS
      setRemoteCursors((prev) => {
        let changed = false
        const next = {}

        for (const [remoteUserId, entry] of Object.entries(prev)) {
          if (Number(entry?.lastActiveAt || 0) < cutoff) {
            changed = true
            continue
          }
          next[remoteUserId] = entry
        }

        return changed ? next : prev
      })
    }, 1200)

    return () => {
      window.clearInterval(timerId)
    }
  }, [activeTypingUsers.length])

  const handleOpenLivePreview = async () => {
    if (!projectId || !isWebVanillaTemplate) return

    const previewTab = window.open('about:blank', '_blank')
    if (!previewTab) {
      setError('Popup blocked. Allow popups for this site and try again.')
      return
    }

    setError('')
    setIsOpeningLivePreview(true)

    try {
      const payload = await apiRequest(
        `/projects/${projectId}/live-session`,
        {
          method: 'POST',
        },
        getAuthToken,
      )

      const liveUrl = String(payload?.url || '').trim()
      if (!liveUrl) {
        throw new Error('Failed to start live preview')
      }

      previewTab.location.href = liveUrl
      previewTab.focus()
    } catch (liveError) {
      try {
        previewTab.close()
      } catch (closeError) {
        void closeError
      }
      setError(liveError.message || 'Failed to open live preview')
    } finally {
      setIsOpeningLivePreview(false)
    }
  }

  if (isProjectLoading && !project) {
    return (
      <section className="project-page project-mode">
        <p className="role-note">Loading project...</p>
      </section>
    )
  }

  // Practice/DSA Mode - Simplified UI
  if (isPracticeMode) {
    return (
      <section className="project-page practice-mode">
        <header className="practice-header">
          <div className="practice-header-left">
            <h2>{project?.name ?? 'Practice Project'}</h2>
            <span className="role-note">Practice Mode</span>
            <span className="language-badge">
              {(project?.language || 'JavaScript').toUpperCase()}
            </span>
          </div>
          <div className="practice-header-actions">
            <button 
              type="button" 
              className="run-btn"
              onClick={handleRunClick} 
              disabled={isRunning || !selectedFileRunnable}
            >
              {isRunning ? '● Running...' : '▶ Run Code'}
            </button>
            {isWebVanillaTemplate && (
              <button type="button" onClick={handleOpenLivePreview} disabled={isOpeningLivePreview}>
                {isOpeningLivePreview ? 'Opening...' : '🌐 Live Preview'}
              </button>
            )}
            <button type="button" onClick={() => navigate('/dashboard')}>
              ← Dashboard
            </button>
          </div>
        </header>

        <div className="practice-layout">
          {/* Left Panel - Code Editor */}
          <div className="practice-editor">
            <div className="practice-editor-controls">
              <div className="file-selector practice-file-toolbar">
                <label>File:</label>
                <select value={selectedFile?.id || ''} onChange={(e) => setSelectedFileId(e.target.value)}>
                  {files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                    </option>
                  ))}
                </select>
                {canEdit && (
                  <>
                    <button onClick={createPracticeFile} type="button">
                      + New
                    </button>
                    <button
                      onClick={startPracticeRename}
                      disabled={!selectedFile}
                      type="button"
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>
            </div>

            {files.length > 1 && (
              <div className="practice-file-tabs">
                {files.map((file) => {
                  const isActive = file.id === selectedFile?.id
                  return (
                    <div key={file.id} className={`practice-file-tab ${isActive ? 'active' : ''}`}>
                      <button
                        type="button"
                        className="practice-file-tab-open"
                        onClick={() => setSelectedFileId(file.id)}
                        title={file.path || file.name}
                      >
                        <span>{file.name}</span>
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="practice-file-tab-delete"
                          onClick={() => deleteFile(file.id)}
                          title={`Delete ${file.name}`}
                          aria-label={`Delete ${file.name}`}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path
                              fill="currentColor"
                              d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 1 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {canEdit && isCreatingPracticeFile && (
              <div className="practice-editor-controls practice-inline-form-row">
                <div className="file-selector practice-file-form">
                  <label>New file:</label>
                  <input
                    ref={practiceFileInputRef}
                    value={practiceFileName}
                    onChange={(event) => setPracticeFileName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitPracticeFileCreate()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelPracticeFileCreate()
                      }
                    }}
                    placeholder="example.js"
                    autoFocus
                  />
                  <button type="button" onClick={submitPracticeFileCreate}>
                    Create
                  </button>
                  <button type="button" onClick={cancelPracticeFileCreate}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {canEdit && isRenamingPracticeFile && (
              <div className="practice-editor-controls practice-inline-form-row">
                <div className="file-selector practice-file-form">
                  <label>Rename:</label>
                  <input
                    value={practiceRenameValue}
                    onChange={(event) => setPracticeRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitPracticeRename()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelPracticeRename()
                      }
                    }}
                    placeholder="example.js"
                    autoFocus
                  />
                  <button type="button" onClick={submitPracticeRename}>
                    Save
                  </button>
                  <button type="button" onClick={cancelPracticeRename}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <Editor
              key={selectedFile?.id || 'practice-editor'}
              height="100%"
              path={selectedFile?.path || selectedFile?.name || 'main.tsx'}
              language={languageForFile(selectedFile?.name ?? '', project?.language)}
              value={selectedFile?.content ?? ''}
              onChange={onEditorChange}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
                configureMonaco(monaco)
                bindGhostEditorActions(editor, monaco)
                bindDebugHoverWidget(editor, monaco)
                validateEditorImports(editor, monaco)
                editor.onDidFocusEditorText(() => {
                  editorFocusedRef.current = true
                })
                editor.onDidBlurEditorText(() => {
                  editorFocusedRef.current = false
                  clearGhostSuggestion()
                  clearDebugHover()
                })
                editor.onDidChangeModelContent(() => {
                  scheduleGhostSuggestion()
                })
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
                readOnly: !canEdit,
                hover: { enabled: false },
                inlineSuggest: { enabled: true },
              }}
            />
          </div>

          {/* Right Panel - Console & Output */}
          <div className="practice-console">
            <div className="practice-console-header">
              <h4>Interactive Console</h4>
            </div>
            
            <div className="stdin-box">
              <label htmlFor="practice-stdin">STDIN</label>
              <textarea
                id="practice-stdin"
                value={practiceStdin}
                onChange={(event) => setPracticeStdin(event.target.value)}
                placeholder="Input for the program (Optional)"
                spellCheck={false}
              />
            </div>
            
            {error && <p className="error-text">{error}</p>}
            
            <div className="practice-output-section">
              <div className="practice-output-header">
                <h5>Output</h5>
              </div>
              <InteractiveConsole
                isRunning={isRunning}
                runStatus={runStatus}
                onInput={handleConsoleInput}
                output={consoleOutput}
                projectId={projectId}
                token={token}
                filePath={selectedFilePath}
              />
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="project-page project-mode">
        <aside className="panel file-panel">
        <div className="panel-head">
          <h2>{project?.name ?? 'Project'}</h2>
          <button type="button" className="back-button" onClick={() => navigate('/dashboard')}>
            ← Back
          </button>
        </div>
        <p className="role-note">Role: {project?.role ?? '...'}</p>
        {!canEdit && <p className="role-note">Viewer mode: read-only access</p>}

        <FileTree
          files={files}
          folders={folders}
          projectName={project?.name || 'Project'}
          currentFile={selectedFile}
          selectedFolderPath={selectedFolderPath}
          onFolderSelect={setSelectedFolderPath}
          onFileSelect={(file) => setSelectedFileId(file?.id ?? null)}
          onFileCreate={createFile}
          onFolderCreate={createFolder}
          onFileRename={renameFile}
          onFolderRename={renameFolder}
          onFileDelete={deleteFile}
          onFolderDelete={deleteFolder}
          onAssetUpload={uploadAssetFile}
          canEdit={canEdit}
        />
      </aside>

      <div className="editor-panel">
        {/* Template Bar - Above Editor */}
        <div className="template-bar">
          <span>{templateDisplayName}</span>
          <div className="template-bar-side">
            <div className="typing-presence">
              {activeTypingUsers.length > 0 && (
                <div className="typing-presence-chips">
                  {activeTypingUsers.slice(0, 4).map((entry) => (
                    <div key={entry.userId} className="typing-chip" style={{ borderColor: entry.color }}>
                      <img
                        src={entry.avatarUrl || DEFAULT_AVATAR_PATH}
                        alt={`${entry.userName} avatar`}
                        onError={(event) => {
                          event.currentTarget.src = DEFAULT_AVATAR_PATH
                        }}
                      />
                      <span>{`${entry.userName} is typing in ${entry.fileName}`}</span>
                    </div>
                  ))}
                  {activeTypingUsers.length > 4 && (
                    <div className="typing-chip typing-chip-more">+{activeTypingUsers.length - 4}</div>
                  )}
                </div>
              )}
            </div>
            {isWebVanillaTemplate && (
              <div className="run-controls">
                <button type="button" onClick={handleOpenLivePreview} disabled={isOpeningLivePreview}>
                  {isOpeningLivePreview ? 'Opening...' : '🌐 Live'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="editor-workspace">
          {selectedFileIsImage ? (
            <div className="asset-preview-wrap">
              <p className="role-note">Image preview (read-only in editor)</p>
              {selectedFilePreviewSrc ? (
                <img className="asset-preview-image" src={selectedFilePreviewSrc} alt={selectedFile?.name || 'asset'} />
              ) : (
                <p className="role-note">Image URL not available.</p>
              )}
            </div>
          ) : (
            <Editor
              key={selectedFile?.id || 'project-editor'}
              height="100%"
              path={selectedFile?.path || selectedFile?.name || 'main.tsx'}
              language={languageForFile(selectedFile?.name ?? '', project?.language)}
              value={selectedFile?.content ?? ''}
              onChange={onEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
                readOnly: !canEdit,
                hover: { enabled: false },
                inlineSuggest: { enabled: true },
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
                configureMonaco(monaco)
                bindGhostEditorActions(editor, monaco)
                bindDebugHoverWidget(editor, monaco)
                validateEditorImports(editor, monaco)
                editor.onDidFocusEditorText(() => {
                  editorFocusedRef.current = true
                })
                editor.onDidBlurEditorText(() => {
                  editorFocusedRef.current = false
                  clearGhostSuggestion()
                  clearDebugHover()
                })
                editor.onDidChangeCursorPosition((event) => {
                  handleCursorChange(event)
                  scheduleGhostSuggestion()
                })
                editor.onDidChangeModelContent(() => {
                  scheduleGhostSuggestion()
                })
              }}
            />
          )}
        </div>

        {visibleRemoteCursors.length > 0 && (
          <div className="cursor-strip">
            {visibleRemoteCursors.map(([id, value]) => (
              <span key={id}>
                {value.userName} at {value.position?.lineNumber}:{value.position?.column}
              </span>
            ))}
          </div>
        )}

        <Terminal
          projectId={projectId}
          projectName={project?.name || ''}
          token={token}
          userId={user?.id || ''}
          ownerId={project?.ownerId || ''}
          sharedTerminalEnabled={Boolean(project?.sharedTerminalEnabled)}
          isOwner={Boolean(isOwner)}
          canEdit={Boolean(canEdit)}
        />

        {isUploadingAsset && <p className="role-note">Uploading image...</p>}
        {error && <p className="error-text">{error}</p>}
      </div>

      <aside className="panel chat-panel">
        {/* Voice Channel Section */}
        <div className="voice-channel-section">
          <VoiceChannelPanel projectId={projectId} getAuthToken={getAuthToken} />
        </div>

        {/* Invite Section */}
        {isOwner && (
          <div className="invite-section">
            <h4>Invite Members</h4>
            
            <label className="shared-terminal-toggle">
              <input
                type="checkbox"
                checked={Boolean(project?.sharedTerminalEnabled)}
                onChange={(event) => onSharedTerminalCheckboxChange(event.target.checked)}
              />
              <span>Share terminal with collaborators</span>
            </label>

            <div className="invite-role-options">
              <label className={`invite-role-checkbox ${inviteRole === 'collaborator' ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={inviteRole === 'collaborator'}
                  onChange={() => setInviteRole('collaborator')}
                />
                <span>Collaborator</span>
              </label>
              <label className={`invite-role-checkbox ${inviteRole === 'viewer' ? 'selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={inviteRole === 'viewer'}
                  onChange={() => setInviteRole('viewer')}
                />
                <span>Viewer</span>
              </label>
            </div>

            <div className="invite-actions">
              <button type="button" className="generate-btn" onClick={createInvite}>
                Generate Invite Code
              </button>
            </div>

            {inviteCode && (
              <div className="invite-code-display">
                <code>{inviteCode}</code>
                <button type="button" className="copy-btn" onClick={copyInviteCode}>
                  {inviteCopied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )}

            <button 
              type="button" 
              className="manage-members-btn"
              onClick={() => setShowMembersPanel((prev) => !prev)}
            >
              {showMembersPanel ? '▼ Hide Members' : '▶ Manage Members'}
            </button>

            {showMembersPanel && (
              <div className="members-panel">
                <h5>Collaborators & Viewers</h5>
                {membersLoading ? (
                  <p className="role-note">Loading members...</p>
                ) : members.length === 0 ? (
                  <p className="role-note">No members invited yet.</p>
                ) : (
                  <div className="members-list">
                    {members.map((member) => (
                      <div key={member.userId} className="member-item">
                        <div className="member-info">
                          <strong>{member.userName || member.email || 'Unknown'}</strong>
                          <small>
                            <span className={`member-status ${member.isOnline ? 'online' : 'offline'}`}>
                              {member.isOnline ? 'Online' : 'Offline'}
                            </span>
                            {' • '}{member.role}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="member-remove-btn"
                          onClick={() => removeMemberAccess(member)}
                          disabled={Boolean(removingMemberId)}
                        >
                          {removingMemberId === member.userId ? '...' : '✕'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat Section */}
        <div className="chat-section">
          <div className="chat-head-row">
            <h3>Project Chat</h3>
            <input
              className="chat-search-input"
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              placeholder="Search..."
            />
          </div>
          <div className="chat-messages-container">
            {filteredChat.map((message) => (
              <div key={message.id} className={`chat-item ${message.userId === user?.id ? 'self' : ''}`}>
                <strong>{message.userName || (message.userId === user?.id ? 'You' : 'User')}</strong>
                <p>{message.message}</p>
                <small>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</small>
              </div>
            ))}
            {filteredChat.length === 0 && <p className="role-note">No matching chats found.</p>}
          </div>

          <form onSubmit={onSendChat} className="chat-form">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a message..."
            />
            <button type="submit">Send</button>
          </form>
        </div>

        {/* Activity Feed Section */}
        <div className="activity-section">
          <h3>Activity Feed</h3>
          <div className="activity-feed">
            {activities.length === 0 && <p className="role-note">No recent activity yet.</p>}
            {activities.map((entry) => (
              <div key={entry.id} className="activity-item">
                <strong>{entry.userId === user?.id ? user?.name || entry.userName || 'You' : entry.userName || 'Unknown'}</strong>
                <p>{describeActivity(entry)}</p>
                <small>{new Date(entry.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
        </aside>
      </section>

      {/* AI Chatbot Popup */}
      <AIChatPopup 
        projectId={projectId}
        getAuthToken={getAuthToken}
        canUseAI={canUseAiAssistant}
        selectedFile={selectedFile}
        files={files}
        onSendingStateChange={setIsAiChatGenerating}
      />

      {showTerminalShareConfirm && (
        <div className="tree-confirm-backdrop" onClick={cancelSharedTerminalEnable}>
          <div className="tree-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>Are you sure you want to share the terminal with collaborators?</p>
            <div className="tree-confirm-actions">
              <button type="button" className="confirm-yes" onClick={confirmSharedTerminalEnable}>
                Yes
              </button>
              <button type="button" className="confirm-cancel" onClick={cancelSharedTerminalEnable}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ProjectPage
