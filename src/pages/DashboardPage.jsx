import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import { useAuth } from '../context/AuthContext'

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

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

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

  return (
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
            ))}
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

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
    </section>
  )
}

export default DashboardPage
