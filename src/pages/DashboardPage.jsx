import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'

const DashboardPage = () => {
  const { token, user, getAuthToken } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [templates, setTemplates] = useState([])
  const [allTemplates, setAllTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createError, setCreateError] = useState('')
  const [createForm, setCreateForm] = useState({
    name: '',
    templateId: 'practice-javascript',
    templateVariantId: '',
    projectType: 'practice',
  })
  const [inviteCode, setInviteCode] = useState('')
  const [projectToDelete, setProjectToDelete] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [downloadingProjectId, setDownloadingProjectId] = useState('')
  const [githubStatus, setGithubStatus] = useState({ connected: false, username: '' })
  const [githubMessage, setGithubMessage] = useState('')
  const [githubDialogProject, setGithubDialogProject] = useState(null)
  const [githubRepos, setGithubRepos] = useState([])
  const [isLoadingGithubRepos, setIsLoadingGithubRepos] = useState(false)
  const [isUploadingGithub, setIsUploadingGithub] = useState(false)
  const [githubUploadForm, setGithubUploadForm] = useState({
    mode: 'existing',
    repositoryFullName: '',
    repositoryName: '',
    isPrivate: true,
  })

  // Load templates based on projectType
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const category = createForm.projectType === 'practice' ? 'practice' : 'project'
        const data = await apiRequest(`/templates?category=${category}`)
        setTemplates(data.templates || [])
        
        // Set default template based on mode
        if (data.templates?.length) {
          const defaultTemplate = data.templates[0]
          const defaultVariantId = defaultTemplate.defaultVariantId || defaultTemplate.variants?.[0]?.id || ''
          setCreateForm((prev) => ({
            ...prev,
            templateId: defaultTemplate.id,
            templateVariantId: defaultVariantId,
          }))
        }
      } catch {
        setTemplates([])
      }
    }

    loadTemplates()
  }, [createForm.projectType])

  useEffect(() => {
    let cancelled = false

    const loadAllTemplates = async () => {
      try {
        const data = await apiRequest('/templates')
        if (!cancelled) {
          setAllTemplates(Array.isArray(data.templates) ? data.templates : [])
        }
      } catch {
        if (!cancelled) {
          setAllTemplates([])
        }
      }
    }

    loadAllTemplates()

    return () => {
      cancelled = true
    }
  }, [])

  const fetchProjects = useCallback(async () => {
    if (!token) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/projects', {}, getAuthToken)
      setProjects(data.projects)
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [token, getAuthToken])

  const fetchGithubStatus = useCallback(async () => {
    if (!token) {
      setGithubStatus({ connected: false, username: '' })
      return
    }

    try {
      const data = await apiRequest('/github/status', {}, getAuthToken)
      setGithubStatus({
        connected: Boolean(data?.connected),
        username: String(data?.username || '').trim(),
      })
    } catch {
      setGithubStatus({ connected: false, username: '' })
    }
  }, [token, getAuthToken])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    fetchGithubStatus()
  }, [fetchGithubStatus])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthState = String(params.get('github_oauth') || '').trim().toLowerCase()
    const message = String(params.get('message') || '').trim()
    if (!oauthState) return

    if (oauthState === 'success') {
      setGithubMessage('GitHub connected successfully. You can now upload owner projects.')
      void fetchGithubStatus()
    } else {
      setError(message || 'GitHub connection failed.')
    }

    params.delete('github_oauth')
    params.delete('message')
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`
    window.history.replaceState({}, '', nextUrl)
  }, [fetchGithubStatus])

  const createProject = async (event) => {
    event.preventDefault()
    if (!token) return
    setCreateError('')
    setError('')
    try {
      const data = await apiRequest(
        '/projects',
        {
          method: 'POST',
          body: JSON.stringify(createForm),
        },
        getAuthToken,
      )
      navigate(`/project/${data.project.id}`)
    } catch (createError) {
      const message = String(createError?.message || 'Failed to create project')
      setCreateError(message)
    }
  }

  const selectedTemplate = templates.find((template) => template.id === createForm.templateId)
  const selectedTemplateVariants = selectedTemplate?.variants || []
  const selectedVariant = selectedTemplateVariants.find(
    (variant) =>
      variant.id ===
      (createForm.templateVariantId || selectedTemplate?.defaultVariantId || selectedTemplateVariants[0]?.id || ''),
  )
  const templateById = useMemo(
    () => new Map((allTemplates || []).map((template) => [template.id, template])),
    [allTemplates],
  )

  const getProjectTemplateDisplay = useCallback(
    (project) => {
      const template = templateById.get(project?.templateId)
      if (!template) return project?.templateId || 'Custom'

      const base = template.label || template.id
      const variants = Array.isArray(template.variants) ? template.variants : []
      if (!variants.length) return base

      const explicitVariantId = String(project?.templateVariantId || '').trim()
      const byId = explicitVariantId ? variants.find((variant) => variant.id === explicitVariantId) : null
      const byLanguage = variants.find(
        (variant) =>
          String(variant.defaultLanguage || '').trim().toLowerCase() ===
          String(project?.language || '').trim().toLowerCase(),
      )
      const fallback = variants.find((variant) => variant.id === template.defaultVariantId) || variants[0]
      const selectedVariant = byId || byLanguage || fallback

      return selectedVariant ? `${base} (${selectedVariant.label})` : base
    },
    [templateById],
  )

  const joinProject = async (event) => {
    event.preventDefault()
    if (!token) return
    setError('')
    try {
      await apiRequest(
        '/projects/join',
        {
          method: 'POST',
          body: JSON.stringify({
            code: inviteCode,
            actorName: user?.name || user?.email?.split('@')[0] || '',
          }),
        },
        getAuthToken,
      )
      setInviteCode('')
      fetchProjects()
    } catch (joinError) {
      setError(joinError.message)
    }
  }

  const deleteProject = async () => {
    if (!projectToDelete?.id || isDeleting) return
    setIsDeleting(true)
    setError('')
    try {
      await apiRequest(`/projects/${projectToDelete.id}`, { method: 'DELETE' }, getAuthToken)
      setProjects((prev) => prev.filter((project) => project.id !== projectToDelete.id))
      setProjectToDelete(null)
    } catch (deleteError) {
      setError(deleteError.message)
    } finally {
      setIsDeleting(false)
    }
  }

  const downloadProjectZip = async (project) => {
    if (!project?.id || downloadingProjectId) return
    if (!project?.canEdit) return

    setDownloadingProjectId(project.id)
    setError('')

    try {
      let authToken = await getAuthToken()
      if (!authToken) {
        throw new Error('Session expired. Please login again.')
      }

      const makeDownloadRequest = (tokenValue) =>
        fetch(`http://localhost:4000/api/projects/${project.id}/download`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${tokenValue}`,
          },
        })

      let response = await makeDownloadRequest(authToken)
      if (response.status === 401) {
        const refreshedToken = await getAuthToken(true)
        if (refreshedToken && refreshedToken !== authToken) {
          authToken = refreshedToken
          response = await makeDownloadRequest(authToken)
        }
      }

      if (!response.ok) {
        let message = `Failed to download ZIP (${response.status})`
        try {
          const payload = await response.json()
          if (payload?.message) {
            message = payload.message
          }
        } catch {
          // Keep default error message when body is not JSON.
        }
        throw new Error(message)
      }

      const zipBlob = await response.blob()
      const objectUrl = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      const fallbackName = `${String(project.name || 'project').trim() || 'project'}.zip`
      const contentDisposition = response.headers.get('content-disposition') || ''
      const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
      link.href = objectUrl
      link.download = fileNameMatch?.[1] || fallbackName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
    } catch (downloadError) {
      setError(downloadError.message || 'Failed to download project ZIP')
    } finally {
      setDownloadingProjectId('')
    }
  }

  const connectGithub = async () => {
    setError('')
    setGithubMessage('')

    try {
      const data = await apiRequest('/github/oauth/start?redirectPath=/dashboard', {}, getAuthToken)
      const url = String(data?.url || '').trim()
      if (!url) {
        throw new Error('Failed to start GitHub connection flow.')
      }
      window.location.href = url
    } catch (connectError) {
      setError(connectError.message || 'Failed to connect GitHub')
    }
  }

  const loadGithubRepos = async () => {
    setIsLoadingGithubRepos(true)
    setError('')
    try {
      const data = await apiRequest('/github/repos', {}, getAuthToken)
      const repos = Array.isArray(data?.repos) ? data.repos : []
      setGithubRepos(repos)
      setGithubUploadForm((prev) => ({
        ...prev,
        repositoryFullName: prev.repositoryFullName || repos[0]?.fullName || '',
      }))
    } catch (reposError) {
      setError(reposError.message || 'Failed to load GitHub repositories')
      setGithubRepos([])
    } finally {
      setIsLoadingGithubRepos(false)
    }
  }

  const openGithubUploadDialog = async (project) => {
    if (!project?.id || project.role !== 'owner') return

    if (!githubStatus.connected) {
      await connectGithub()
      return
    }

    setGithubDialogProject(project)
    setGithubMessage('')
    setGithubUploadForm({
      mode: 'existing',
      repositoryFullName: '',
      repositoryName: project.name
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
      isPrivate: true,
    })
    await loadGithubRepos()
  }

  const uploadProjectToGithub = async () => {
    const project = githubDialogProject
    if (!project?.id || isUploadingGithub) return

    setIsUploadingGithub(true)
    setError('')
    setGithubMessage('')

    try {
      const payload = {
        mode: githubUploadForm.mode,
        repositoryFullName: githubUploadForm.repositoryFullName,
        repositoryName: githubUploadForm.repositoryName,
        isPrivate: Boolean(githubUploadForm.isPrivate),
      }

      const data = await apiRequest(
        `/projects/${project.id}/github/upload`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        getAuthToken,
      )

      setGithubMessage(`Uploaded to ${data?.repository?.fullName || 'GitHub repository'} on branch main.`)
      setGithubDialogProject(null)
    } catch (uploadError) {
      setError(uploadError.message || 'Failed to upload project to GitHub')
    } finally {
      setIsUploadingGithub(false)
    }
  }

  return (
    <>
      <AppHeader />
      <section className="dashboard-grid">
        <div className="card">
        <h2>Create Project</h2>
        <form onSubmit={createProject} className="stack-sm">
          <label>
            Project Name
            <input
              value={createForm.name}
              onChange={(event) => {
                setCreateError('')
                setCreateForm((prev) => ({ ...prev, name: event.target.value }))
              }}
              required
              placeholder="My Awesome Project"
            />
          </label>
          {createError && <p className="error-text">{createError}</p>}

          <label>
            Project Type
            <select
              value={createForm.projectType}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, projectType: event.target.value }))}
            >
              <option value="practice">🎯 Practice/DSA - Simple editor with Run button</option>
              <option value="project">💼 Full Project - File tree + Terminal</option>
            </select>
          </label>

          {createForm.projectType === 'practice' && (
            <label>
              Language
              <select
                value={createForm.templateId}
                onChange={(event) => {
                  const nextTemplate = templates.find((template) => template.id === event.target.value)
                  const nextVariantId = nextTemplate?.defaultVariantId || nextTemplate?.variants?.[0]?.id || ''
                  setCreateForm((prev) => ({
                    ...prev,
                    templateId: event.target.value,
                    templateVariantId: nextVariantId,
                  }))
                }}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {createForm.projectType === 'project' && (
            <>
              <label>
                Template
                <select
                  value={createForm.templateId}
                  onChange={(event) => {
                    const nextTemplate = templates.find((template) => template.id === event.target.value)
                    const nextVariantId = nextTemplate?.defaultVariantId || nextTemplate?.variants?.[0]?.id || ''
                    setCreateForm((prev) => ({
                      ...prev,
                      templateId: event.target.value,
                      templateVariantId: nextVariantId,
                    }))
                  }}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedTemplate?.description && <p className="role-note">{selectedTemplate.description}</p>}

              {selectedTemplateVariants.length > 0 && (
                <label>
                  Variant
                  <select
                    value={createForm.templateVariantId || selectedTemplate.defaultVariantId || selectedTemplateVariants[0]?.id || ''}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        templateVariantId: event.target.value,
                      }))
                    }
                  >
                    {selectedTemplateVariants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selectedVariant?.description && <p className="role-note">{selectedVariant.description}</p>}
            </>
          )}

          <button type="submit">Create Project</button>
        </form>
        </div>

        <div className="card">
        <h2>Join by Invite Code</h2>
        <form onSubmit={joinProject} className="stack-sm">
          <input
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
            required
            placeholder="Enter invite code"
          />
          <button type="submit">Join Project</button>
        </form>
        </div>

        <div className="card wide">
          <h2>Your Projects</h2>
          <p className="role-note">
            GitHub: {githubStatus.connected ? `Connected as ${githubStatus.username || 'account'}` : 'Not connected'}
          </p>
          {loading ? (
            <p>Loading projects...</p>
          ) : projects.length === 0 ? (
            <p>No projects yet. Create one to start collaborating.</p>
          ) : (
            <div className="project-list">
              {projects.map((project) => (
                <div key={project.id} className="project-item-row">
                  <button
                    className="project-item"
                    type="button"
                    onClick={() => navigate(`/project/${project.id}`)}
                  >
                    <strong>{project.name}</strong>
                    <span>
                      {project.projectType === 'practice' ? '🎯 Practice Mode' : '💼 Full Project'} • {project.role}
                    </span>
                    <span>Template: {getProjectTemplateDisplay(project)}</span>
                    <span>Updated: {new Date(project.updatedAt).toLocaleString()}</span>
                  </button>
                  <div className="project-item-actions">
                    {project.role === 'owner' && (
                      <button
                        type="button"
                        className="project-github-btn"
                        title={githubStatus.connected ? `Upload ${project.name} to GitHub` : 'Connect GitHub to upload projects'}
                        aria-label={githubStatus.connected ? `Upload ${project.name} to GitHub` : 'Connect GitHub to upload projects'}
                        onClick={() => openGithubUploadDialog(project)}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                          <path
                            fill="currentColor"
                            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.1 0 0 .67-.21 2.2.82a7.56 7.56 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.09.16 1.9.08 2.1.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                          />
                        </svg>
                      </button>
                    )}
                    {project.canEdit && (
                      <button
                        type="button"
                        className="project-download-btn"
                        title={`Download ${project.name} as ZIP`}
                        aria-label={`Download ${project.name} as ZIP`}
                        onClick={() => downloadProjectZip(project)}
                        disabled={downloadingProjectId === project.id}
                      >
                        {downloadingProjectId === project.id ? '...' : '⬇'}
                      </button>
                    )}
                    {project.role === 'owner' && (
                      <button
                        type="button"
                        className="project-delete-btn"
                        title={`Delete ${project.name}`}
                        onClick={() => setProjectToDelete(project)}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}
        {githubMessage && <p className="profile-success">{githubMessage}</p>}

        {projectToDelete && (
          <div className="tree-confirm-backdrop" onClick={() => (isDeleting ? null : setProjectToDelete(null))}>
            <div className="tree-confirm-dialog" onClick={(event) => event.stopPropagation()}>
              <p>Are you sure you want to permanently delete "{projectToDelete.name}"?</p>
              <div className="tree-confirm-actions">
                <button type="button" className="confirm-yes" onClick={deleteProject} disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Yes'}
                </button>
                <button
                  type="button"
                  className="confirm-cancel"
                  onClick={() => setProjectToDelete(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {githubDialogProject && (
          <div className="tree-confirm-backdrop" onClick={() => (isUploadingGithub ? null : setGithubDialogProject(null))}>
            <div className="tree-confirm-dialog github-upload-dialog" onClick={(event) => event.stopPropagation()}>
              <p>
                Upload "{githubDialogProject.name}" to GitHub
              </p>

              <label>
                Upload Mode
                <select
                  value={githubUploadForm.mode}
                  onChange={(event) =>
                    setGithubUploadForm((prev) => ({
                      ...prev,
                      mode: event.target.value,
                    }))
                  }
                >
                  <option value="existing">Use Existing Repository</option>
                  <option value="new">Create New Repository</option>
                </select>
              </label>

              {githubUploadForm.mode === 'existing' ? (
                <label>
                  Repository
                  <select
                    value={githubUploadForm.repositoryFullName}
                    onChange={(event) =>
                      setGithubUploadForm((prev) => ({
                        ...prev,
                        repositoryFullName: event.target.value,
                      }))
                    }
                    disabled={isLoadingGithubRepos || githubRepos.length === 0}
                  >
                    {githubRepos.map((repo) => (
                      <option key={repo.fullName} value={repo.fullName}>
                        {repo.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    New Repository Name
                    <input
                      value={githubUploadForm.repositoryName}
                      onChange={(event) =>
                        setGithubUploadForm((prev) => ({
                          ...prev,
                          repositoryName: event.target.value,
                        }))
                      }
                      placeholder="my-project"
                    />
                  </label>
                  <label className="shared-terminal-toggle">
                    <input
                      type="checkbox"
                      checked={githubUploadForm.isPrivate}
                      onChange={(event) =>
                        setGithubUploadForm((prev) => ({
                          ...prev,
                          isPrivate: event.target.checked,
                        }))
                      }
                    />
                    <span>Create as private repository</span>
                  </label>
                </>
              )}

              {isLoadingGithubRepos && githubUploadForm.mode === 'existing' && <p>Loading repositories...</p>}
              {!isLoadingGithubRepos && githubUploadForm.mode === 'existing' && githubRepos.length === 0 && (
                <p className="role-note">No repositories found. Switch to "Create New Repository".</p>
              )}

              <div className="tree-confirm-actions">
                <button
                  type="button"
                  className="confirm-yes"
                  onClick={uploadProjectToGithub}
                  disabled={
                    isUploadingGithub ||
                    (githubUploadForm.mode === 'existing' && !githubUploadForm.repositoryFullName) ||
                    (githubUploadForm.mode === 'new' && !String(githubUploadForm.repositoryName || '').trim())
                  }
                >
                  {isUploadingGithub ? 'Uploading...' : 'Upload'}
                </button>
                <button
                  type="button"
                  className="confirm-cancel"
                  onClick={() => setGithubDialogProject(null)}
                  disabled={isUploadingGithub}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  )
}

export default DashboardPage
