import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Github, Handshake, Link2, Package, Rocket, Trash2 } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'

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
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [createProgressStep, setCreateProgressStep] = useState(0)
  const createProgressTimersRef = useRef([])

  const clearCreateProgressTimers = useCallback(() => {
    for (const timerId of createProgressTimersRef.current) {
      window.clearTimeout(timerId)
    }
    createProgressTimersRef.current = []
  }, [])

  const startCreateProgressDialog = useCallback(() => {
    clearCreateProgressTimers()
    setCreateProgressStep(0)
    setIsCreatingProject(true)

    const stepTwoTimer = window.setTimeout(() => {
      setCreateProgressStep(1)
    }, 900)

    const stepThreeTimer = window.setTimeout(() => {
      setCreateProgressStep(2)
    }, 1800)

    createProgressTimersRef.current = [stepTwoTimer, stepThreeTimer]
  }, [clearCreateProgressTimers])

  const stopCreateProgressDialog = useCallback(() => {
    clearCreateProgressTimers()
    setIsCreatingProject(false)
    setCreateProgressStep(0)
  }, [clearCreateProgressTimers])

  useEffect(() => () => {
    clearCreateProgressTimers()
  }, [clearCreateProgressTimers])

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const category = createForm.projectType === 'practice' ? 'practice' : 'project'
        const data = await apiRequest(`/templates?category=${category}`)
        setTemplates(data.templates || [])

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
    if (!token || isCreatingProject) return
    setCreateError('')
    setError('')
    startCreateProgressDialog()
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
      stopCreateProgressDialog()
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
  const builtProjects = useMemo(() => projects.filter((project) => project.role === 'owner'), [projects])
  const sharedProjects = useMemo(() => projects.filter((project) => project.role !== 'owner'), [projects])
  const editableProjectsCount = useMemo(() => projects.filter((project) => project.canEdit).length, [projects])
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
      const resolvedVariant = byId || byLanguage || fallback

      return resolvedVariant ? `${base} (${resolvedVariant.label})` : base
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

  const renderProjectActions = (project) => (
    <div className="flex items-center gap-2">
      {project.role === 'owner' && (
        <button
          type="button"
          className="project-action-btn inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-100 transition hover:-translate-y-0.5 hover:bg-black"
          title={githubStatus.connected ? `Upload ${project.name} to GitHub` : 'Connect GitHub to upload projects'}
          aria-label={githubStatus.connected ? `Upload ${project.name} to GitHub` : 'Connect GitHub to upload projects'}
          onClick={() => openGithubUploadDialog(project)}
        >
          <Github aria-hidden="true" focusable="false" className="h-5 w-5" />
        </button>
      )}
      {project.canEdit && (
        <button
          type="button"
          className="project-action-btn inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-100 transition hover:-translate-y-0.5 hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          title={`Download ${project.name} as ZIP`}
          aria-label={`Download ${project.name} as ZIP`}
          onClick={() => downloadProjectZip(project)}
          disabled={downloadingProjectId === project.id}
        >
          {downloadingProjectId === project.id ? (
            <span className="text-xs">...</span>
          ) : (
            <Download aria-hidden="true" focusable="false" className="h-5 w-5" />
          )}
        </button>
      )}
      {project.role === 'owner' && (
        <button
          type="button"
          className="project-action-btn inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-100 transition hover:-translate-y-0.5 hover:bg-black"
          title={`Delete ${project.name}`}
          aria-label={`Delete ${project.name}`}
          onClick={() => setProjectToDelete(project)}
        >
          <Trash2 aria-hidden="true" focusable="false" className="h-5 w-5" />
        </button>
      )}
    </div>
  )

  const renderProjectCard = (project) => (
    <article
      key={project.id}
      className="dash-project-card dashboard-reveal group flex flex-col gap-4 rounded-2xl border border-slate-300/60 bg-white/70 p-4 shadow-lg shadow-slate-200/60 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-slate-400/70 hover:shadow-xl dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35 dark:hover:border-slate-500/70"
    >
      <button
        className="w-full rounded-2xl bg-slate-900 p-4 text-left shadow-inner shadow-black/25 transition hover:bg-slate-950 dark:bg-slate-800/70 dark:shadow-black/20"
        type="button"
        onClick={() => navigate(`/project/${project.id}`)}
      >
        <p className="font-['Manrope',sans-serif] text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {project.projectType === 'practice' ? 'Practice Workspace' : 'Full Project Workspace'}
        </p>
        <h3 className="mt-1 text-lg font-semibold text-white">{project.name}</h3>
        <p className="mt-2 text-sm text-slate-300">Template: {getProjectTemplateDisplay(project)}</p>
        <p className="mt-1 text-sm text-slate-300">Updated: {new Date(project.updatedAt).toLocaleString()}</p>
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border border-slate-300/80 bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.11em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {project.role}
        </span>
        {renderProjectActions(project)}
      </div>
    </article>
  )

  return (
    <>
      <Navbar variant="app" />
      <section className="dashboard-modern dashboard-surface -m-4 min-h-screen overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(148,163,184,0.24),transparent_34%),linear-gradient(170deg,#f8fafc_0%,#ffffff_52%,#eef2f7_100%)] px-4 pb-16 pt-24 font-['Questrial',sans-serif] text-slate-900 antialiased dark:bg-[radial-gradient(circle_at_12%_8%,rgba(59,130,246,0.18),transparent_34%),linear-gradient(170deg,#01030a_0%,#020611_55%,#00030c_100%)] dark:text-slate-100 md:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="dash-hero dashboard-reveal relative overflow-hidden rounded-3xl border border-slate-300/60 bg-[radial-gradient(circle_at_8%_12%,rgba(148,163,184,0.2),transparent_35%),radial-gradient(circle_at_90%_0%,rgba(148,163,184,0.2),transparent_40%),linear-gradient(165deg,#f8fafc_0%,#ffffff_53%,#f1f5f9_100%)] p-6 shadow-xl shadow-slate-300/35 dark:border-slate-700/70 dark:bg-[radial-gradient(circle_at_8%_12%,rgba(148,163,184,0.12),transparent_35%),radial-gradient(circle_at_90%_0%,rgba(71,85,105,0.16),transparent_40%),linear-gradient(165deg,#03060d_0%,#06080e_58%,#020308_100%)] dark:shadow-black/45 md:p-8">
            <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300">
              Workspace Dashboard
            </p>
            <h1 className="mt-3 text-3xl font-medium uppercase tracking-[0.03em] text-slate-900 dark:text-slate-100 sm:text-4xl">
              Build fast, practice hard, collaborate clearly.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              Launch new projects, join shared rooms, and manage all your workspaces from one control center.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <article className="dash-stat dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-4 shadow-lg shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400">Total Workspaces</p>
                <p className="mt-1 text-2xl font-semibold">{projects.length}</p>
              </article>
              <article className="dash-stat dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-4 shadow-lg shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400">Built By You</p>
                <p className="mt-1 text-2xl font-semibold">{builtProjects.length}</p>
              </article>
              <article className="dash-stat dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-4 shadow-lg shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400">Editable Rooms</p>
                <p className="mt-1 text-2xl font-semibold">{editableProjectsCount}</p>
              </article>
              <article className="dash-stat dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-4 shadow-lg shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400">GitHub</p>
                <p className="mt-1 text-sm font-semibold">
                  {githubStatus.connected ? `Connected as ${githubStatus.username || 'account'}` : 'Not connected'}
                </p>
                {!githubStatus.connected && (
                  <button
                    type="button"
                    onClick={connectGithub}
                    className="dash-secondary-btn mt-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:bg-slate-100 dark:border-slate-900 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-black"
                  >
                    Connect
                  </button>
                )}
              </article>
            </div>
          </div>

          <div className="mt-12 grid gap-8 xl:grid-cols-2">
            <div className="dash-panel dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-6 shadow-xl shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
              <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                <Rocket aria-hidden="true" className="mr-2 inline-block h-4 w-4 align-[-2px]" />
                Create Project
              </p>
              <form onSubmit={createProject} className="mt-4 grid gap-3">
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
                {createError && <p className="m-0 text-sm text-red-500">{createError}</p>}

                <label>
                  Project Type
                  <select
                    value={createForm.projectType}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, projectType: event.target.value }))}
                  >
                    <option value="practice">Question Solver - Compiler-Style Practice</option>
                    <option value="project">Full Project Build - End-to-End Workspace</option>
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

                    {selectedTemplate?.description && <p className="m-0 text-sm text-slate-600 dark:text-slate-300">{selectedTemplate.description}</p>}

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

                    {selectedVariant?.description && <p className="m-0 text-sm text-slate-600 dark:text-slate-300">{selectedVariant.description}</p>}
                  </>
                )}

                <button
                  type="submit"
                  disabled={isCreatingProject}
                  className="dash-primary-btn mt-2 rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.11em] text-white transition hover:-translate-y-0.5 hover:bg-black dark:border-zinc-900 dark:bg-zinc-900 dark:text-white dark:hover:bg-black"
                >
                  {isCreatingProject ? 'Creating...' : 'Create Project'}
                </button>
              </form>
            </div>

            <div className="dash-panel dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-6 shadow-xl shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
              <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                <Link2 aria-hidden="true" className="mr-2 inline-block h-4 w-4 align-[-2px]" />
                Join by Invite Code
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Enter a workspace code from your teammate to join instantly.
              </p>
              <form onSubmit={joinProject} className="mt-4 grid gap-3">
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                  required
                  placeholder="Enter invite code"
                />
                <button
                  type="submit"
                  className="dash-primary-btn rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.11em] text-white transition hover:-translate-y-0.5 hover:bg-black dark:border-zinc-900 dark:bg-zinc-900 dark:text-white dark:hover:bg-black"
                >
                  Join Project
                </button>
              </form>

              <div className="mt-8 rounded-xl border border-slate-300/70 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-950/45">
                <p className="font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Quick Notes
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  <li>Practice mode opens lightweight coding workspace.</li>
                  <li>Full project mode includes file tree and terminal support.</li>
                  <li>Owner projects can be uploaded to GitHub directly.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-8 xl:grid-cols-2">
            <section className="dash-panel dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-6 shadow-xl shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                  <Package aria-hidden="true" className="mr-2 inline-block h-4 w-4 align-[-2px]" />
                  Projects Built by You
                </p>
                <span className="rounded-full border border-slate-300/80 bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.11em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {builtProjects.length}
                </span>
              </div>
              {loading ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">Loading projects...</p>
              ) : builtProjects.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">No owned projects yet. Create one to get started.</p>
              ) : (
                <div className="grid gap-3">{builtProjects.map((project) => renderProjectCard(project))}</div>
              )}
            </section>

            <section className="dash-panel dashboard-reveal rounded-2xl border border-slate-300/70 bg-white/75 p-6 shadow-xl shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                  <Handshake aria-hidden="true" className="mr-2 inline-block h-4 w-4 align-[-2px]" />
                  Shared With You
                </p>
                <span className="rounded-full border border-slate-300/80 bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.11em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {sharedProjects.length}
                </span>
              </div>
              {loading ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">Loading shared projects...</p>
              ) : sharedProjects.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">No shared projects yet. Join with an invite code.</p>
              ) : (
                <div className="grid gap-3">{sharedProjects.map((project) => renderProjectCard(project))}</div>
              )}
            </section>
          </div>

          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
          {githubMessage && <p className="mt-4 text-sm text-emerald-500">{githubMessage}</p>}
        </div>

        {projectToDelete && (
          <div
            className="fixed inset-0 z-80 grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm"
            onClick={() => (isDeleting ? null : setProjectToDelete(null))}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-300/70 bg-white p-5 text-slate-900 shadow-2xl shadow-slate-300/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/50"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="text-sm">Are you sure you want to permanently delete "{projectToDelete.name}"?</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-red-600 bg-red-600 px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-white transition hover:bg-red-700 disabled:opacity-60"
                  onClick={deleteProject}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Yes, delete'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
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
          <div
            className="fixed inset-0 z-80 grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm"
            onClick={() => (isUploadingGithub ? null : setGithubDialogProject(null))}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-slate-300/70 bg-white p-5 text-slate-900 shadow-2xl shadow-slate-300/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/50"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="font-semibold">Upload "{githubDialogProject.name}" to GitHub</p>

              <div className="mt-4 grid gap-3">
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
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
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

                {isLoadingGithubRepos && githubUploadForm.mode === 'existing' && <p className="text-sm">Loading repositories...</p>}
                {!isLoadingGithubRepos && githubUploadForm.mode === 'existing' && githubRepos.length === 0 && (
                  <p className="text-sm text-slate-600 dark:text-slate-300">No repositories found. Switch to "Create New Repository".</p>
                )}
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-white transition hover:bg-black disabled:opacity-60 dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
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
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setGithubDialogProject(null)}
                  disabled={isUploadingGithub}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {isCreatingProject && (
          <div className="fixed inset-0 grid place-items-center px-4" style={{ zIndex: 90 }} aria-live="polite" role="status">
            <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-md" />
            <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-300/60 bg-white/85 p-6 text-slate-900 shadow-2xl shadow-slate-400/25 dark:border-slate-700/80 dark:bg-slate-900/88 dark:text-slate-100 dark:shadow-black/50">
              <div
                className="mx-auto h-9 w-full max-w-[270px] overflow-hidden"
                style={{
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)',
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)',
                }}
              >
                <div
                  className="transition-transform duration-500 ease-out"
                  style={{ transform: `translateY(-${createProgressStep * 36}px)` }}
                >
                  <p className="m-0 flex h-9 items-center justify-center text-center text-lg font-semibold text-slate-800 dark:text-slate-100">Creating your project...</p>
                  <p className="m-0 flex h-9 items-center justify-center text-center text-lg font-semibold text-slate-800 dark:text-slate-100">Setting up workspace...</p>
                  <p className="m-0 flex h-9 items-center justify-center text-center text-lg font-semibold text-slate-800 dark:text-slate-100">Almost done...</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${createProgressStep >= 0 ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${createProgressStep >= 1 ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${createProgressStep >= 2 ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  )
}

export default DashboardPage
