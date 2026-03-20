import { useEffect, useRef, useState } from 'react'
import {
  File as FileIcon,
  FileCode2,
  FileImage,
  FileJson,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  ImagePlus,
  Palette,
} from 'lucide-react'

const FileTree = ({
  files,
  folders,
  projectName,
  currentFile,
  selectedFolderPath,
  onFolderSelect,
  onFileSelect,
  onFileCreate,
  onFolderCreate,
  onFileRename,
  onFolderRename,
  onFileDelete,
  onFolderDelete,
  onAssetUpload,
  canEdit,
}) => {
  const [expandedFolders, setExpandedFolders] = useState(new Set(['']))
  const [contextMenu, setContextMenu] = useState(null)
  const [activeTarget, setActiveTarget] = useState({ type: 'root', folderPath: '' })
  const [pendingCreate, setPendingCreate] = useState(null)
  const [pendingRename, setPendingRename] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [dragItem, setDragItem] = useState(null)
  const [moveConfirm, setMoveConfirm] = useState(null)
  const treeRef = useRef(null)
  const createInputRef = useRef(null)
  const renameInputRef = useRef(null)
  const assetInputRef = useRef(null)
  const createFocusKeyRef = useRef('')
  const renameFocusKeyRef = useRef('')

  const focusTree = () => {
    if (!treeRef.current) return
    try {
      treeRef.current.focus({ preventScroll: true })
    } catch {
      treeRef.current.focus()
    }
  }

  useEffect(() => {
    if (!pendingCreate) {
      createFocusKeyRef.current = ''
      return
    }

    const focusKey = `${pendingCreate.type}:${pendingCreate.parentPath}`
    if (createFocusKeyRef.current === focusKey) return
    createFocusKeyRef.current = focusKey

    if (createInputRef.current) {
      createInputRef.current.focus()
    }
  }, [pendingCreate?.type, pendingCreate?.parentPath])

  useEffect(() => {
    if (!pendingRename) {
      renameFocusKeyRef.current = ''
      return
    }

    const focusKey =
      pendingRename.type === 'file'
        ? `file:${pendingRename.fileId}`
        : `folder:${normalizePathKey(pendingRename.folderPath)}`
    if (renameFocusKeyRef.current === focusKey) return
    renameFocusKeyRef.current = focusKey

    if (renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [pendingRename?.type, pendingRename?.fileId, pendingRename?.folderPath])

  const normalizePath = (value = '') =>
    String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .trim()

  const normalizePathKey = (value = '') => normalizePath(value).toLowerCase()

  const rootLabel = String(projectName || '').trim() || 'Project'
  const getIndentPx = (depth = 0, isFile = false) => {
    const base = Math.max(0, Number(depth) || 0) * 12 + (isFile ? 16 : 0)
    return Math.min(base, 108)
  }

  const hasDuplicateAtTarget = (parent, name) => {
    const trimmedName = String(name || '').trim()
    if (!trimmedName) return false

    const fullPath = normalizePath(parent ? `${parent}/${trimmedName}` : trimmedName)
    if (!fullPath) return false
    const fullPathKey = normalizePathKey(fullPath)

    const fileExists = files.some((file) => normalizePathKey(file.path) === fullPathKey)
    const folderExists = Array.from(folders).some((folder) => normalizePathKey(folder) === fullPathKey)
    return fileExists || folderExists
  }

  const toggleFolder = (folderPath) => {
    setExpandedFolders((prev) => {
      const updated = new Set(prev)
      if (updated.has(folderPath)) {
        updated.delete(folderPath)
      } else {
        updated.add(folderPath)
      }
      return updated
    })
  }

  const getParentPath = (fullPath = '') => {
    const normalizedPath = normalizePath(fullPath)
    if (!normalizedPath.includes('/')) return ''
    return normalizedPath.slice(0, normalizedPath.lastIndexOf('/'))
  }

  const buildTree = () => {
    const tree = { path: '', name: '', type: 'folder', children: [] }
    const folderMap = new Map([['', tree]])

    // Build folder structure
    const sortedFolders = Array.from(folders).sort()
    for (const folderPath of sortedFolders) {
      const parts = folderPath.split('/')
      let current = tree
      let cumulative = ''

      for (const part of parts) {
        cumulative = cumulative ? `${cumulative}/${part}` : part
        if (!folderMap.has(cumulative)) {
          const folderNode = { path: cumulative, name: part, type: 'folder', children: [] }
          current.children.push(folderNode)
          folderMap.set(cumulative, folderNode)
        }
        current = folderMap.get(cumulative)
      }
    }

    // Add files to appropriate folders
    for (const file of files) {
      const parentPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''
      const parent = folderMap.get(parentPath) || tree
      parent.children.push({ path: file.path, name: file.name, type: 'file', fileId: file.id })
    }

    // Sort children (folders first, then files, alphabetically)
    const sortChildren = (node) => {
      if (node.children) {
        node.children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        node.children.forEach(sortChildren)
      }
    }
    sortChildren(tree)

    return tree.children
  }

  const startCreate = (type, parentPathValue = '') => {
    const normalizedParent = normalizePath(parentPathValue)
    if (normalizedParent) {
      setExpandedFolders((prev) => {
        const updated = new Set(prev)
        updated.add(normalizedParent)
        return updated
      })
      onFolderSelect?.(normalizedParent)
    }
    if (!normalizedParent) {
      onFolderSelect?.('')
    }
    setPendingCreate({ type, parentPath: normalizedParent, name: '', error: '' })
    setPendingRename(null)
    setContextMenu(null)
  }

  const cancelCreate = () => {
    setPendingCreate(null)
  }

  const submitCreate = () => {
    if (!pendingCreate) return
    const trimmedName = String(pendingCreate.name || '').trim()
    if (!trimmedName) return

    if (hasDuplicateAtTarget(pendingCreate.parentPath, trimmedName)) {
      setPendingCreate((prev) =>
        prev
          ? {
              ...prev,
              error: `A file or folder "${trimmedName}" already exists at this location. Please choose a different name.`,
            }
          : prev,
      )
      return
    }

    if (pendingCreate.type === 'file') {
      onFileCreate?.(pendingCreate.parentPath, trimmedName)
    } else {
      onFolderCreate?.(pendingCreate.parentPath, trimmedName)
    }
    setPendingCreate(null)
  }

  const openDeleteConfirm = (payload) => {
    setDeleteConfirm(payload)
    setContextMenu(null)
  }

  const hasRenameDuplicate = (renamePayload, nextName) => {
    if (!renamePayload) return false
    const targetName = String(nextName || '').trim()
    if (!targetName) return false

    const nextPath = normalizePath(renamePayload.parentPath ? `${renamePayload.parentPath}/${targetName}` : targetName)
    if (!nextPath) return false
    const nextPathKey = normalizePathKey(nextPath)

    if (renamePayload.type === 'file') {
      const fileExists = files.some((file) => normalizePathKey(file.path) === nextPathKey && file.id !== renamePayload.fileId)
      const folderExists = Array.from(folders).some((folder) => normalizePathKey(folder) === nextPathKey)
      return fileExists || folderExists
    }

    const folderExists = Array.from(folders).some(
      (folder) => normalizePathKey(folder) === nextPathKey && normalizePathKey(folder) !== normalizePathKey(renamePayload.folderPath),
    )
    const fileExists = files.some((file) => normalizePathKey(file.path) === nextPathKey)
    return folderExists || fileExists
  }

  const hasMoveDuplicate = (movePayload) => {
    if (!movePayload) return false
    const nextPath = normalizePath(movePayload.newPath)
    if (!nextPath) return false
    const nextPathKey = normalizePathKey(nextPath)

    if (movePayload.type === 'file') {
      const fileExists = files.some((file) => normalizePathKey(file.path) === nextPathKey && file.id !== movePayload.fileId)
      const folderExists = Array.from(folders).some((folder) => normalizePathKey(folder) === nextPathKey)
      return fileExists || folderExists
    }

    const folderExists = Array.from(folders).some(
      (folder) => normalizePathKey(folder) === nextPathKey && normalizePathKey(folder) !== normalizePathKey(movePayload.sourcePath),
    )
    const fileExists = files.some((file) => normalizePathKey(file.path) === nextPathKey)
    return folderExists || fileExists
  }

  const requestMove = (item, targetFolderPath = '') => {
    if (!canEdit || !item) return

    const normalizedTarget = normalizePath(targetFolderPath)

    if (item.type === 'file') {
      const sourcePath = normalizePath(item.path)
      if (!sourcePath) return
      const fileName = sourcePath.split('/').pop() || item.name || ''
      const newPath = normalizePath(normalizedTarget ? `${normalizedTarget}/${fileName}` : fileName)
      if (!newPath || newPath === sourcePath) return

      const payload = {
        type: 'file',
        fileId: item.fileId,
        sourcePath,
        newPath,
        targetPath: normalizedTarget,
        targetLabel: normalizedTarget || rootLabel,
      }

      if (hasMoveDuplicate(payload)) return
      setMoveConfirm(payload)
      return
    }

    if (item.type === 'folder') {
      const sourcePath = normalizePath(item.folderPath)
      if (!sourcePath) return

      if (normalizedTarget === sourcePath || normalizedTarget.startsWith(`${sourcePath}/`)) {
        return
      }

      const folderName = sourcePath.split('/').pop() || item.name || ''
      const newPath = normalizePath(normalizedTarget ? `${normalizedTarget}/${folderName}` : folderName)
      if (!newPath || newPath === sourcePath) return

      const payload = {
        type: 'folder',
        sourcePath,
        newPath,
        targetPath: normalizedTarget,
        targetLabel: normalizedTarget || rootLabel,
      }

      if (hasMoveDuplicate(payload)) return
      setMoveConfirm(payload)
    }
  }

  const confirmMove = () => {
    if (!moveConfirm) return
    if (moveConfirm.type === 'file') {
      onFileRename?.(moveConfirm.fileId, moveConfirm.newPath)
    } else {
      onFolderRename?.(moveConfirm.sourcePath, moveConfirm.newPath)
    }
    setMoveConfirm(null)
  }

  const startRename = (payload) => {
    if (!canEdit || !payload || payload.targetType === 'root') return

    if (payload.targetType === 'file') {
      const fullPath = normalizePath(payload.path)
      const parentPath = getParentPath(fullPath)
      setPendingCreate(null)
      setPendingRename({
        type: 'file',
        fileId: payload.fileId,
        path: fullPath,
        parentPath,
        name: payload.name,
        error: '',
      })
      setContextMenu(null)
      return
    }

    const folderPath = normalizePath(payload.folderPath)
    const parentPath = getParentPath(folderPath)
    const folderName = folderPath.split('/').pop() || folderPath
    setPendingCreate(null)
    setPendingRename({
      type: 'folder',
      folderPath,
      parentPath,
      name: folderName,
      error: '',
    })
    setContextMenu(null)
  }

  const cancelRename = () => {
    setPendingRename(null)
  }

  const submitRename = () => {
    if (!pendingRename) return
    const nextName = String(pendingRename.name || '').trim()
    if (!nextName) return

    if (hasRenameDuplicate(pendingRename, nextName)) {
      setPendingRename((prev) =>
        prev
          ? {
              ...prev,
              error: `A file or folder "${nextName}" already exists at this location. Please choose a different name.`,
            }
          : prev,
      )
      return
    }

    const nextPath = normalizePath(pendingRename.parentPath ? `${pendingRename.parentPath}/${nextName}` : nextName)

    if (pendingRename.type === 'file') {
      if (nextPath !== normalizePath(pendingRename.path)) {
        onFileRename?.(pendingRename.fileId, nextPath)
      }
      setPendingRename(null)
      return
    }

    if (nextPath !== normalizePath(pendingRename.folderPath)) {
      onFolderRename?.(pendingRename.folderPath, nextPath)
    }
    setPendingRename(null)
  }

  const onDeleteConfirm = () => {
    if (!deleteConfirm) return
    if (deleteConfirm.type === 'file') {
      onFileDelete?.(deleteConfirm.fileId)
    }
    if (deleteConfirm.type === 'folder') {
      onFolderDelete?.(deleteConfirm.folderPath)
    }
    setDeleteConfirm(null)
  }

  const openAssetPicker = () => {
    if (!canEdit) return
    assetInputRef.current?.click()
  }

  const onAssetInputChange = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      onAssetUpload?.(selectedFolderPath || '', file)
    }
    event.target.value = ''
  }

  const renderInlineCreateRow = (depth = 0) => {
    if (!pendingCreate) return null
    const InlineIcon = pendingCreate.type === 'file' ? FileIcon : Folder
    const canSubmit = Boolean(String(pendingCreate.name || '').trim()) && !pendingCreate.error
    return (
      <div className="tree-inline-create" style={{ marginLeft: `${getIndentPx(depth, true)}px` }}>
        <div className="tree-inline-row">
          <span className="tree-icon"><InlineIcon size={16} aria-hidden="true" /></span>
          <input
            ref={createInputRef}
            className="tree-inline-input"
            value={pendingCreate.name}
            onChange={(event) => {
              const nextName = event.target.value
              const duplicate = hasDuplicateAtTarget(pendingCreate.parentPath, nextName)
              setPendingCreate((prev) =>
                prev
                  ? {
                      ...prev,
                      name: nextName,
                      error: duplicate
                        ? `A file or folder "${String(nextName || '').trim()}" already exists at this location. Please choose a different name.`
                        : '',
                    }
                  : prev,
              )
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitCreate()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelCreate()
              }
            }}
            placeholder={pendingCreate.type === 'file' ? 'file name' : 'folder name'}
          />
          <div className="tree-inline-actions">
            <button
              type="button"
              className="tree-inline-action-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={submitCreate}
              disabled={!canSubmit}
            >
              Create
            </button>
            <button
              type="button"
              className="tree-inline-action-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={cancelCreate}
            >
              Cancel
            </button>
          </div>
        </div>
        {pendingCreate.error && <div className="tree-inline-error">{pendingCreate.error}</div>}
      </div>
    )
  }

  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedFolders.has(node.path)
    const isCurrent = node.type === 'file' && currentFile?.id === node.fileId
    const isSelectedFolder = node.type === 'folder' && selectedFolderPath === node.path
    const isRenamingFolder = pendingRename?.type === 'folder' && pendingRename.folderPath === node.path
    const isRenamingFile = pendingRename?.type === 'file' && pendingRename.fileId === node.fileId
    const folderIndentPx = getIndentPx(depth, false)
    const fileIndentPx = getIndentPx(depth, true)

    if (node.type === 'folder') {
      return (
        <div key={node.path || 'root'} style={{ marginLeft: `${folderIndentPx}px` }}>
          {isRenamingFolder ? (
            <div className={`tree-item tree-folder ${isExpanded ? 'expanded' : ''} ${isSelectedFolder ? 'selected' : ''}`}>
              <span className="tree-icon">{isExpanded ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}</span>
              <div className="tree-inline-edit">
                <input
                  ref={renameInputRef}
                  className="tree-inline-input"
                  value={pendingRename.name}
                  onChange={(event) => {
                    const nextName = event.target.value
                    const duplicate = hasRenameDuplicate(pendingRename, nextName)
                    setPendingRename((prev) =>
                      prev
                        ? {
                            ...prev,
                            name: nextName,
                            error: duplicate
                              ? `A file or folder "${String(nextName || '').trim()}" already exists at this location. Please choose a different name.`
                              : '',
                          }
                        : prev,
                    )
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitRename()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelRename()
                    }
                  }}
                  onBlur={submitRename}
                  placeholder="folder name"
                />
              </div>
            </div>
          ) : (
            <button
              className={`tree-item tree-folder ${isExpanded ? 'expanded' : ''} ${isSelectedFolder ? 'selected' : ''}`}
              draggable={canEdit}
              onDragStart={(event) => {
                if (!canEdit) return
                event.dataTransfer.effectAllowed = 'move'
                setDragItem({
                  type: 'folder',
                  folderPath: node.path,
                  name: node.name,
                })
              }}
              onDragEnd={() => {
                setDragItem(null)
              }}
              onDragOver={(event) => {
                if (!canEdit || !dragItem) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                if (!canEdit || !dragItem) return
                event.preventDefault()
                requestMove(dragItem, node.path)
                setDragItem(null)
              }}
              onClick={() => {
                onFolderSelect?.(node.path)
                setActiveTarget({ type: 'folder', folderPath: node.path, name: node.name })
                toggleFolder(node.path)
                setContextMenu(null)
                focusTree()
              }}
              onContextMenu={(event) => {
                if (!canEdit) return
                event.preventDefault()
                onFolderSelect?.(node.path)
                setContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  targetType: 'folder',
                  folderPath: node.path,
                  name: node.name,
                })
                setActiveTarget({ type: 'folder', folderPath: node.path, name: node.name })
                focusTree()
              }}
              type="button"
            >
              <span className="tree-icon">{isExpanded ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}</span>
              <span className="tree-label">{node.name || 'Project'}</span>
            </button>
          )}
          {isRenamingFolder && pendingRename.error && (
            <div className="tree-inline-error" style={{ marginLeft: '1.6rem' }}>
              {pendingRename.error}
            </div>
          )}
          {isExpanded && node.children && (
            <div className="tree-children">
              {pendingCreate?.parentPath === node.path && renderInlineCreateRow(depth + 1)}
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      )
    }

    if (isRenamingFile) {
      return (
        <div key={node.path} style={{ marginLeft: `${fileIndentPx}px` }}>
          <div className={`tree-item tree-file ${isCurrent ? 'active' : ''}`}>
            <span className="tree-icon">{getFileIcon(node.name)}</span>
            <div className="tree-inline-edit">
              <input
                ref={renameInputRef}
                className="tree-inline-input"
                value={pendingRename.name}
                onChange={(event) => {
                  const nextName = event.target.value
                  const duplicate = hasRenameDuplicate(pendingRename, nextName)
                  setPendingRename((prev) =>
                    prev
                      ? {
                          ...prev,
                          name: nextName,
                          error: duplicate
                            ? `A file or folder "${String(nextName || '').trim()}" already exists at this location. Please choose a different name.`
                            : '',
                        }
                      : prev,
                  )
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitRename()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelRename()
                  }
                }}
                onBlur={submitRename}
                placeholder="file name"
              />
            </div>
          </div>
          {pendingRename.error && <div className="tree-inline-error">{pendingRename.error}</div>}
        </div>
      )
    }

    return (
      <button
        key={node.path}
        className={`tree-item tree-file ${isCurrent ? 'active' : ''}`}
        draggable={canEdit}
        onDragStart={(event) => {
          if (!canEdit) return
          event.dataTransfer.effectAllowed = 'move'
          setDragItem({
            type: 'file',
            fileId: node.fileId,
            path: node.path,
            name: node.name,
          })
        }}
        onDragEnd={() => {
          setDragItem(null)
        }}
        onClick={() => {
          const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
          onFolderSelect?.(parentPath)
          onFileSelect(files.find((f) => f.id === node.fileId))
          setActiveTarget({ type: 'file', fileId: node.fileId, path: node.path, name: node.name })
          setContextMenu(null)
          focusTree()
        }}
        onContextMenu={(event) => {
          if (!canEdit) return
          event.preventDefault()
          const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
          onFolderSelect?.(parentPath)
          onFileSelect(files.find((f) => f.id === node.fileId))
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            targetType: 'file',
            fileId: node.fileId,
            path: node.path,
            name: node.name,
          })
          setActiveTarget({ type: 'file', fileId: node.fileId, path: node.path, name: node.name })
          focusTree()
        }}
        style={{ marginLeft: `${fileIndentPx}px` }}
        type="button"
      >
        <span className="tree-icon">{getFileIcon(node.name)}</span>
        <span className="tree-label">{node.name}</span>
      </button>
    )
  }

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase()
    const iconMap = {
      js: FileCode2,
      jsx: FileCode2,
      ts: FileCode2,
      tsx: FileCode2,
      py: FileCode2,
      html: Globe,
      css: Palette,
      json: FileJson,
      md: FileText,
      txt: FileText,
      png: FileImage,
      jpg: FileImage,
      jpeg: FileImage,
      gif: FileImage,
      webp: FileImage,
      svg: FileImage,
      bmp: FileImage,
      ico: FileImage,
    }
    const Icon = iconMap[ext] || FileIcon
    return <Icon size={16} aria-hidden="true" />
  }

  const tree = buildTree()
  const isRootSelected = !selectedFolderPath

  return (
    <div
      ref={treeRef}
      className={`file-tree ${isRootSelected ? 'root-selected' : ''}`}
      onClick={() => setContextMenu(null)}
      onKeyDown={(event) => {
        if (!canEdit || pendingCreate || pendingRename) return
        if (event.key !== 'Delete') return
        if (event.target.closest('input, textarea, .monaco-editor')) return

        if (activeTarget?.type === 'file' && activeTarget.fileId) {
          event.preventDefault()
          openDeleteConfirm({ type: 'file', fileId: activeTarget.fileId, name: activeTarget.name || currentFile?.name })
          return
        }

        if (activeTarget?.type === 'folder' && activeTarget.folderPath) {
          event.preventDefault()
          const name = activeTarget.name || activeTarget.folderPath.split('/').pop() || activeTarget.folderPath
          openDeleteConfirm({ type: 'folder', folderPath: activeTarget.folderPath, name })
          return
        }

        if (currentFile?.id) {
          event.preventDefault()
          openDeleteConfirm({ type: 'file', fileId: currentFile.id, name: currentFile.name })
        }
      }}
      tabIndex={0}
    >
      <div className="file-tree-header">
        <span>EXPLORER</span>
        {canEdit && (
          <div className="file-tree-actions">
            <button
              onClick={() => startCreate('file', selectedFolderPath || '')}
              title={selectedFolderPath ? `New File in ${selectedFolderPath}` : 'New File in root'}
              type="button"
            >
              <FilePlus2 size={15} aria-hidden="true" />
            </button>
            <button
              onClick={() => startCreate('folder', selectedFolderPath || '')}
              title={selectedFolderPath ? `New Folder in ${selectedFolderPath}` : 'New Folder in root'}
              type="button"
            >
              <FolderPlus size={15} aria-hidden="true" />
            </button>
            <button
              onClick={openAssetPicker}
              title={selectedFolderPath ? `Upload image to ${selectedFolderPath}` : 'Upload image to root'}
              type="button"
            >
              <ImagePlus size={15} aria-hidden="true" />
            </button>
            <input
              ref={assetInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onAssetInputChange}
            />
          </div>
        )}
      </div>
      <div className="file-tree-target">
        <span>Target: {selectedFolderPath || rootLabel}</span>
      </div>
      <div
        className="file-tree-content"
        onDragOver={(event) => {
          if (!canEdit || !dragItem) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          if (!canEdit || !dragItem) return
          event.preventDefault()
          requestMove(dragItem, '')
          setDragItem(null)
        }}
        onClick={(event) => {
          if (event.target.closest('.tree-item')) return
          onFolderSelect?.('')
          setActiveTarget({ type: 'root', folderPath: '' })
          setContextMenu(null)
          focusTree()
        }}
        onContextMenu={(event) => {
          if (!canEdit) return
          if (event.target.closest('.tree-item')) return
          event.preventDefault()
          onFolderSelect?.('')
          setActiveTarget({ type: 'root', folderPath: '' })
          setContextMenu({ x: event.clientX, y: event.clientY, targetType: 'root', folderPath: '' })
          focusTree()
        }}
      >
        {pendingCreate?.parentPath === '' && renderInlineCreateRow(0)}
        {tree.map((node) => renderTreeNode(node, 0))}
      </div>
      {canEdit && contextMenu && (
        <div
          className="tree-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.targetType !== 'file' && (
            <>
              <button
                type="button"
                className="tree-context-item"
                onClick={() => {
                  startCreate('file', contextMenu.folderPath || '')
                }}
              >
                New File
              </button>
              <button
                type="button"
                className="tree-context-item"
                onClick={() => {
                  startCreate('folder', contextMenu.folderPath || '')
                }}
              >
                New Folder
              </button>
            </>
          )}
          {contextMenu.targetType !== 'root' && (
            <button
              type="button"
              className="tree-context-item"
              onClick={() => {
                if (contextMenu.targetType === 'file') {
                  startRename(contextMenu)
                  return
                }
                if (contextMenu.targetType === 'folder') {
                  startRename(contextMenu)
                }
              }}
            >
              Rename
            </button>
          )}
          {contextMenu.targetType !== 'root' && (
            <button
              type="button"
              className="tree-context-item tree-context-item-danger"
              onClick={() => {
                if (contextMenu.targetType === 'file') {
                  openDeleteConfirm({ type: 'file', fileId: contextMenu.fileId, name: contextMenu.name })
                  return
                }
                if (contextMenu.targetType === 'folder') {
                  openDeleteConfirm({
                    type: 'folder',
                    folderPath: contextMenu.folderPath,
                    name: contextMenu.name,
                  })
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {deleteConfirm && (
        <div className="tree-confirm-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="tree-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>
              Are you sure you want to delete "{deleteConfirm.name}"?
            </p>
            <div className="tree-confirm-actions">
              <button type="button" className="confirm-yes" onClick={onDeleteConfirm}>
                Yes
              </button>
              <button type="button" className="confirm-cancel" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {moveConfirm && (
        <div className="tree-confirm-backdrop" onClick={() => setMoveConfirm(null)}>
          <div className="tree-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>
              Are you sure you want to move "{moveConfirm.sourcePath}" to "{moveConfirm.targetLabel}"?
            </p>
            <div className="tree-confirm-actions">
              <button type="button" className="confirm-yes" onClick={confirmMove}>
                Confirm
              </button>
              <button type="button" className="confirm-cancel" onClick={() => setMoveConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FileTree
