import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import { useAuth } from '../context/AuthContext'

const emptyProfile = {
  name: '',
  bio: '',
  pronouns: '',
  company: '',
  location: '',
  avatarUrl: '',
}

const DEFAULT_AVATAR_PATH = '/branding/defaultAvatar.png'

const isDefaultAvatarValue = (value = '') => {
  const normalized = String(value || '').trim()
  if (!normalized) return true
  return normalized === DEFAULT_AVATAR_PATH
}

const ProfilePage = () => {
  const navigate = useNavigate()
  const { getAuthToken } = useAuth()
  const [form, setForm] = useState(emptyProfile)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const hasCustomAvatar = !isDefaultAvatarValue(form.avatarUrl)
  const previewAvatarUrl = hasCustomAvatar ? form.avatarUrl : DEFAULT_AVATAR_PATH

  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      try {
        const data = await apiRequest('/me', {}, getAuthToken)
        if (cancelled) return
        setForm({
          name: data?.user?.name || '',
          bio: data?.user?.bio || '',
          pronouns: data?.user?.pronouns || '',
          company: data?.user?.company || '',
          location: data?.user?.location || '',
          avatarUrl: data?.user?.avatarUrl || '',
        })
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load profile')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadProfile()

    return () => {
      cancelled = true
    }
  }, [getAuthToken])

  const onAvatarFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file for avatar.')
      return
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Failed to read avatar image'))
      reader.readAsDataURL(file)
    }).catch((fileError) => {
      setError(fileError.message || 'Failed to read avatar image')
      return ''
    })

    if (!dataUrl) return

    setForm((prev) => ({ ...prev, avatarUrl: dataUrl }))
    setError('')
  }

  const onSubmit = (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setShowConfirm(true)
  }

  const onRemoveAvatar = () => {
    setForm((prev) => ({ ...prev, avatarUrl: '' }))
    setError('')
    setSuccess('Avatar reset to default. Save profile to apply this change.')
  }

  const confirmSave = async () => {
    setShowConfirm(false)
    setSaving(true)
    setError('')

    try {
      const payload = {
        name: form.name,
        bio: form.bio,
        pronouns: form.pronouns,
        company: form.company,
        location: form.location,
        avatarUrl: form.avatarUrl,
      }
      const data = await apiRequest(
        '/me',
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        getAuthToken,
      )

      setForm((prev) => ({
        ...prev,
        name: data?.user?.name || prev.name,
        bio: data?.user?.bio || '',
        pronouns: data?.user?.pronouns || '',
        company: data?.user?.company || '',
        location: data?.user?.location || '',
        avatarUrl: data?.user?.avatarUrl || '',
      }))
      setSuccess('Profile updated successfully.')
    } catch (saveError) {
      setError(saveError.message || 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className="profile-page-wrap">
        <div className="card profile-card">
          <p>Loading profile...</p>
        </div>
      </section>
    )
  }

  return (
    <section className="profile-page-wrap">
      <div className="card profile-card">
        <div className="profile-head">
          <h2>Edit Profile</h2>
          <button type="button" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        </div>

        <form className="stack-sm" onSubmit={onSubmit}>
          <div className="profile-avatar-row">
            <div className="profile-avatar-preview">
              <img src={previewAvatarUrl} alt="User avatar" />
            </div>
            <div className="profile-avatar-actions">
              <label>
                Change Avatar
                <input type="file" accept="image/*" onChange={onAvatarFileChange} />
              </label>
              <button type="button" onClick={onRemoveAvatar} disabled={!hasCustomAvatar}>
                Remove Avatar
              </button>
            </div>
          </div>

          <label>
            Name
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>

          <label>
            Bio
            <textarea
              className="profile-textarea"
              value={form.bio}
              onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
              placeholder="Tell teammates about you"
              maxLength={300}
            />
          </label>

          <label>
            Pronouns
            <input
              value={form.pronouns}
              onChange={(event) => setForm((prev) => ({ ...prev, pronouns: event.target.value }))}
              placeholder="e.g., he/him, she/her, they/them"
              maxLength={60}
            />
          </label>

          <label>
            Company
            <input
              value={form.company}
              onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))}
              placeholder="Company or organization"
              maxLength={100}
            />
          </label>

          <label>
            Location
            <input
              value={form.location}
              onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
              placeholder="City, country"
              maxLength={120}
            />
          </label>

          {error && <p className="error-text">{error}</p>}
          {success && <p className="profile-success">{success}</p>}

          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Update Profile'}
          </button>
        </form>
      </div>

      {showConfirm && (
        <div className="tree-confirm-backdrop" onClick={() => setShowConfirm(false)}>
          <div className="tree-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>Are you sure you want to update these changes?</p>
            <div className="tree-confirm-actions">
              <button type="button" className="confirm-yes" onClick={confirmSave}>
                Yes
              </button>
              <button type="button" className="confirm-cancel" onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ProfilePage