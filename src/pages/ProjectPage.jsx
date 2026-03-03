import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { apiRequest } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useAuth } from '../context/AuthContext'
import FileTree from '../components/FileTree'
import Terminal from '../components/Terminal'
import InteractiveConsole from '../components/InteractiveConsole'

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
  const [pendingPracticeSelectPath, setPendingPracticeSelectPath] = useState('')
  const [showTerminalShareConfirm, setShowTerminalShareConfirm] = useState(false)
  const [isUploadingAsset, setIsUploadingAsset] = useState(false)
  const [runtimeHealth, setRuntimeHealth] = useState(null)
  const [isProjectLoading, setIsProjectLoading] = useState(true)
  const [isOpeningLivePreview, setIsOpeningLivePreview] = useState(false)
  const [templateCatalog, setTemplateCatalog] = useState([])
  const monacoConfiguredRef = useRef(false)
  const monacoRef = useRef(null)
  const editorRef = useRef(null)
  const practiceFileInputRef = useRef(null)
  const pendingFileUpdateTimersRef = useRef(new Map())
  const pendingFileUpdatePayloadRef = useRef(new Map())
  const editorFocusedRef = useRef(false)
  const selectedFileIdRef = useRef(null)
  const typingGuardUntilRef = useRef(0)
  const latestProjectIdRef = useRef(projectId)
  const latestTokenRef = useRef(token)

  useEffect(() => {
    latestProjectIdRef.current = projectId
    latestTokenRef.current = token
  }, [projectId, token])

  const selectedFile = useMemo(() => {
    if (!selectedFileId) return null
    return files.find((file) => file.id === selectedFileId) || null
  }, [files, selectedFileId])

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

  const resolvedRole = project?.role || (project?.ownerId === user?.id ? 'owner' : undefined)
  const canEdit = Boolean(
    typeof project?.canEdit === 'boolean'
      ? project.canEdit
      : resolvedRole === 'owner' || resolvedRole === 'collaborator',
  )
  const isOwner = resolvedRole === 'owner'
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

          const isCurrentlyEditingThisFile =
            editorFocusedRef.current && selectedFileIdRef.current && selectedFileIdRef.current === incomingFile.id
          const hasPendingLocalUpdate = pendingFileUpdatePayloadRef.current.has(incomingFile.id)
          const shouldProtectWhileTyping = typingGuardActive && selectedFileIdRef.current === incomingFile.id

          if (isCurrentlyEditingThisFile || hasPendingLocalUpdate || shouldProtectWhileTyping) {
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
      setChat(normalizedSnapshot?.chat || [])
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

    const onUpdated = ({ fileId, content, updatedAt }) => {
      const typingGuardActive = Date.now() < Number(typingGuardUntilRef.current || 0)
      if (typingGuardActive && selectedFileIdRef.current && selectedFileIdRef.current === fileId) {
        return
      }

      setFiles((prev) =>
        prev.map((file) =>
          file.id === fileId
            ? {
                ...file,
                content,
                updatedAt,
              }
            : file,
        ),
      )
    }

    const onCursorUpdated = ({ fileId, position, userId, userName }) => {
      setRemoteCursors((prev) => ({
        ...prev,
        [userId]: { userName, fileId, position },
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

    if (socket.connected) {
      joinProjectRoom()
    }

    socket.on('connect', joinProjectRoom)
    socket.on('connect_error', onConnectError)
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
      socket.off('connect', joinProjectRoom)
      socket.off('connect_error', onConnectError)
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

  useEffect(() => {
    const timersRef = pendingFileUpdateTimersRef.current
    const payloadRef = pendingFileUpdatePayloadRef.current

    return () => {
      for (const timerId of timersRef.values()) {
        clearTimeout(timerId)
      }
      const projectIdValue = latestProjectIdRef.current
      const tokenValue = latestTokenRef.current
      if (projectIdValue && tokenValue) {
        const socket = getSocket(tokenValue)
        if (socket) {
          for (const pendingPayload of payloadRef.values()) {
            if (!pendingPayload) continue
            socket.emit('file:update', {
              projectId: pendingPayload.projectId || projectIdValue,
              fileId: pendingPayload.fileId,
              content: pendingPayload.content ?? '',
              clientUpdatedAt: pendingPayload.clientUpdatedAt || Date.now(),
            })
          }
        }
      }
      timersRef.clear()
      payloadRef.clear()
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
      const clientUpdatedAt = Date.now()

      pendingFileUpdatePayloadRef.current.set(fileId, {
        projectId,
        fileId,
        content,
        clientUpdatedAt,
      })

      const existingTimer = pendingFileUpdateTimersRef.current.get(fileId)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      const nextTimer = setTimeout(() => {
        const payload = pendingFileUpdatePayloadRef.current.get(fileId)
        pendingFileUpdatePayloadRef.current.delete(fileId)
        pendingFileUpdateTimersRef.current.delete(fileId)
        if (!payload) return
        emit('file:update', payload)
      }, 220)

      pendingFileUpdateTimersRef.current.set(fileId, nextTimer)
    },
    [emit, projectId],
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
    typingGuardUntilRef.current = Date.now() + 1400
    setFiles((prev) => prev.map((file) => (file.id === selectedFile.id ? { ...file, content: nextContent } : file)))
    queueFileUpdate(selectedFile.id, nextContent)
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

    emit('chat:send', {
      projectId,
      message,
      clientMessageId,
      userName: user?.name || '',
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
    if (!selectedFile) return
    emit('cursor:update', {
      projectId,
      fileId: selectedFile.id,
      position: {
        lineNumber: event.position?.lineNumber,
        column: event.position?.column,
      },
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
        <div className="practice-header">
          <div>
            <h2>{project?.name ?? 'Practice Project'}</h2>
            <span className="role-note">Practice Mode - {templateDisplayName}</span>
            <div className="runtime-status-row">
              <span className={`runtime-status-pill ${cloudinaryOn ? 'on' : 'off'}`}>Cloudinary: {cloudinaryOn ? 'ON' : 'OFF'}</span>
              <span className={`runtime-status-pill ${postgresOn ? 'on' : 'off'}`}>Postgres: {postgresOn ? 'ON' : 'OFF'}</span>
              <span className={`runtime-status-pill ${queueOn ? 'on' : 'off'}`}>Queue: {queueOn ? 'ON' : 'OFF'}</span>
              <span className={`runtime-status-pill ${redisOn ? 'on' : 'off'}`}>Redis: {redisOn ? 'ON' : 'OFF'}</span>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
        </div>

        <div className="practice-layout">
          <div className="practice-editor">
            <div className="practice-editor-controls">
              <div className="file-selector">
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
                      + File
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedFile) return
                        const nextPath = window.prompt('Rename file path', selectedFile.path)
                        if (!nextPath?.trim()) return
                        renameFile(selectedFile.id, nextPath)
                      }}
                      disabled={!selectedFile}
                      type="button"
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>
              <div className="run-controls">
                <button type="button" onClick={handleRunClick} disabled={isRunning || !selectedFileRunnable}>
                  {isRunning ? 'Running...' : '▶ Run'}
                </button>
                {isWebVanillaTemplate && (
                  <button type="button" onClick={handleOpenLivePreview} disabled={isOpeningLivePreview}>
                    {isOpeningLivePreview ? 'Opening...' : '🌐 Live'}
                  </button>
                )}
              </div>
            </div>

            {canEdit && isCreatingPracticeFile && (
              <div className="practice-editor-controls">
                <div className="file-selector">
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

            <Editor
              key={selectedFile?.id || 'practice-editor'}
              height="60vh"
              path={selectedFile?.path || selectedFile?.name || 'main.tsx'}
              language={languageForFile(selectedFile?.name ?? '', project?.language)}
              defaultValue={selectedFile?.content ?? ''}
              onChange={onEditorChange}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
                configureMonaco(monaco)
                validateEditorImports(editor, monaco)
                editor.onDidFocusEditorText(() => {
                  editorFocusedRef.current = true
                })
                editor.onDidBlurEditorText(() => {
                  editorFocusedRef.current = false
                })
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
                readOnly: !canEdit,
              }}
            />
          </div>

          <div className="practice-console">
            <h4>Interactive Console</h4>
            <div className="stdin-box">
              <label htmlFor="practice-stdin">stdin</label>
              <textarea
                id="practice-stdin"
                value={practiceStdin}
                onChange={(event) => setPracticeStdin(event.target.value)}
                placeholder="Provide custom input for DSA tests..."
                rows={6}
                spellCheck={false}
              />
            </div>
            {error && <p className="error-text">{error}</p>}
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
      </section>
    )
  }

  // Full Project Mode - Complete IDE experience
  const visibleRemoteCursors = Object.entries(remoteCursors).filter(([, value]) => value.fileId === selectedFile?.id)

  return (
    <>
      <section className="project-page project-mode">
        <aside className="panel file-panel">
        <div className="panel-head">
          <h2>{project?.name ?? 'Project'}</h2>
          <button type="button" onClick={() => navigate('/dashboard')}>
            Back
          </button>
        </div>
        <p className="role-note">Role: {project?.role ?? '...'}</p>
        <div className="runtime-status-row">
          <span className={`runtime-status-pill ${cloudinaryOn ? 'on' : 'off'}`}>Cloudinary: {cloudinaryOn ? 'ON' : 'OFF'}</span>
          <span className={`runtime-status-pill ${postgresOn ? 'on' : 'off'}`}>Postgres: {postgresOn ? 'ON' : 'OFF'}</span>
          <span className={`runtime-status-pill ${queueOn ? 'on' : 'off'}`}>Queue: {queueOn ? 'ON' : 'OFF'}</span>
          <span className={`runtime-status-pill ${redisOn ? 'on' : 'off'}`}>Redis: {redisOn ? 'ON' : 'OFF'}</span>
        </div>
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
        <div className="editor-head">
          <div className="editor-head-row">
            <strong>{selectedFile?.name ?? 'No file selected'}</strong>
            <span className="role-note">Template: {templateDisplayName}</span>
          </div>
          {isWebVanillaTemplate && (
            <div className="run-controls">
              <button type="button" onClick={handleOpenLivePreview} disabled={isOpeningLivePreview}>
                {isOpeningLivePreview ? 'Opening...' : '🌐 Live'}
              </button>
            </div>
          )}
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
              defaultValue={selectedFile?.content ?? ''}
              onChange={onEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                automaticLayout: true,
                readOnly: !canEdit,
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
                configureMonaco(monaco)
                validateEditorImports(editor, monaco)
                editor.onDidFocusEditorText(() => {
                  editorFocusedRef.current = true
                })
                editor.onDidBlurEditorText(() => {
                  editorFocusedRef.current = false
                })
                editor.onDidChangeCursorPosition(handleCursorChange)
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
        {isOwner && (
          <div className="invite-box stack-sm">
            <label className="shared-terminal-toggle">
              <input
                type="checkbox"
                checked={Boolean(project?.sharedTerminalEnabled)}
                onChange={(event) => onSharedTerminalCheckboxChange(event.target.checked)}
              />
              Share terminal with collaborators
            </label>
            <label>
              Invite Role
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                <option value="collaborator">Collaborator</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <button type="button" onClick={createInvite}>
              Generate Invite Code
            </button>
            <button type="button" onClick={() => setShowMembersPanel((prev) => !prev)}>
              {showMembersPanel ? 'Hide Members' : 'Manage Members'}
            </button>
            {inviteCode && (
              <div className="invite-code-row">
                <p>Code: {inviteCode}</p>
                <button type="button" onClick={copyInviteCode}>
                  {inviteCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
            {showMembersPanel && (
              <div className="members-box">
                <h4>Collaborators & Viewers</h4>
                {membersLoading ? (
                  <p className="role-note">Loading members...</p>
                ) : members.length === 0 ? (
                  <p className="role-note">No members invited yet.</p>
                ) : (
                  <div className="members-list">
                    {members.map((member) => (
                      <div key={member.userId} className="member-item">
                        <div>
                          <strong>{member.userName || member.email || 'Unknown'}</strong>
                          <p>
                            <span className={member.isOnline ? 'member-online' : 'member-offline'}>
                              {member.isOnline ? 'Online' : 'Offline'}
                            </span>
                            {' • '}
                            {member.role}
                          </p>
                          <small>Last seen: {member.isOnline ? 'Active now' : formatLastSeen(member.lastSeenAt)}</small>
                        </div>
                        <button
                          type="button"
                          className="member-remove-btn"
                          onClick={() => removeMemberAccess(member)}
                          disabled={Boolean(removingMemberId)}
                        >
                          {removingMemberId === member.userId ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="chat-head-row">
          <h3>Project Chat</h3>
          <input
            className="chat-search-input"
            value={chatSearch}
            onChange={(event) => setChatSearch(event.target.value)}
            placeholder="Search chat"
          />
        </div>
        <div className="chat-box">
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
            placeholder="Type a message"
          />
          <button type="submit">Send</button>
        </form>

        <h3>Activity Feed</h3>
        <div className="activity-box">
          {activities.length === 0 && <p className="role-note">No recent activity yet.</p>}
          {activities.map((entry) => (
            <div key={entry.id} className="activity-item">
              <strong>{entry.userId === user?.id ? user?.name || entry.userName || 'You' : entry.userName || 'Unknown'}</strong>
              <p>{describeActivity(entry)}</p>
              <small>{new Date(entry.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </div>
        </aside>
      </section>
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
