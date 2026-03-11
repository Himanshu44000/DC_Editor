import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'

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
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)
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

  const processAvatarFile = async (file) => {
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
    setSuccess('Avatar selected. Save profile to apply this change.')
  }

  const onAvatarFileChange = async (event) => {
    const file = event.target.files?.[0]
    await processAvatarFile(file)
  }

  const onDragOver = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }

  const onDragLeave = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }

  const onDrop = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    const file = event.dataTransfer?.files?.[0]
    await processAvatarFile(file)
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
      <>
        <Navbar variant="app" />
        <section className="-m-4 min-h-screen overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(148,163,184,0.24),transparent_34%),linear-gradient(170deg,#f8fafc_0%,#ffffff_52%,#eef2f7_100%)] px-4 pb-16 pt-24 font-['Questrial',sans-serif] text-slate-900 antialiased dark:bg-[radial-gradient(circle_at_12%_8%,rgba(59,130,246,0.18),transparent_34%),linear-gradient(170deg,#01030a_0%,#020611_55%,#00030c_100%)] dark:text-slate-100 md:px-6">
          <div className="mx-auto max-w-2xl">
            <div className="rounded-2xl border border-slate-300/70 bg-white/75 p-8 shadow-xl shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35">
              <div className="flex items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300"></div>
                <p className="ml-3 text-sm text-slate-600 dark:text-slate-300">Loading profile...</p>
              </div>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <Navbar variant="app" />
      <section className="-m-4 min-h-screen overflow-hidden bg-[radial-gradient(circle_at_12%_8%,rgba(148,163,184,0.24),transparent_34%),linear-gradient(170deg,#f8fafc_0%,#ffffff_52%,#eef2f7_100%)] px-4 pb-16 pt-24 font-['Questrial',sans-serif] text-slate-900 antialiased dark:bg-[radial-gradient(circle_at_12%_8%,rgba(59,130,246,0.18),transparent_34%),linear-gradient(170deg,#01030a_0%,#020611_55%,#00030c_100%)] dark:text-slate-100 md:px-6">
        <div className="mx-auto max-w-2xl">
          {/* Header Card */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-300/60 bg-[radial-gradient(circle_at_8%_12%,rgba(148,163,184,0.2),transparent_35%),radial-gradient(circle_at_90%_0%,rgba(148,163,184,0.2),transparent_40%),linear-gradient(165deg,#f8fafc_0%,#ffffff_53%,#f1f5f9_100%)] p-6 shadow-xl shadow-slate-300/35 dark:border-slate-700/70 dark:bg-[radial-gradient(circle_at_8%_12%,rgba(148,163,184,0.12),transparent_35%),radial-gradient(circle_at_90%_0%,rgba(71,85,105,0.16),transparent_40%),linear-gradient(165deg,#03060d_0%,#06080e_58%,#020308_100%)] dark:shadow-black/45 md:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-['Manrope',sans-serif] text-xs font-extrabold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300">
                  Account Settings
                </p>
                <h1 className="mt-2 text-2xl font-medium uppercase tracking-[0.03em] text-slate-900 dark:text-slate-100 sm:text-3xl">
                  Edit Profile
                </h1>
              </div>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300/70 bg-white/80 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:bg-white dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Dashboard
              </button>
            </div>
          </div>

          {/* Profile Form Card */}
          <div className="mt-6 rounded-2xl border border-slate-300/70 bg-white/75 p-6 shadow-xl shadow-slate-200/60 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/70 dark:shadow-black/35 md:p-8">
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Avatar Section */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-5 dark:border-slate-700/60 dark:bg-slate-800/30">
                <p className="font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Profile Picture
                </p>
                <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row">
                  {/* Avatar Preview */}
                  <div className="relative">
                    <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-white shadow-lg dark:border-slate-700">
                      <img
                        src={previewAvatarUrl}
                        alt="User avatar"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    {hasCustomAvatar && (
                      <div className="absolute -bottom-1 -right-1 rounded-full bg-emerald-500 p-1">
                        <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Upload Zone */}
                  <div className="flex-1">
                    <div
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all ${
                        isDragging
                          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                          : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-slate-500 dark:hover:bg-slate-800'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={onAvatarFileChange}
                        className="hidden"
                      />
                      <div className="flex flex-col items-center gap-2">
                        <div className={`rounded-full p-2 ${isDragging ? 'bg-blue-100 dark:bg-blue-900/50' : 'bg-slate-100 dark:bg-slate-700'}`}>
                          <svg className={`h-5 w-5 ${isDragging ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {isDragging ? 'Drop image here' : 'Click to upload or drag & drop'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            PNG, JPG, GIF up to 5MB
                          </p>
                        </div>
                      </div>
                    </div>

                    {hasCustomAvatar && (
                      <button
                        type="button"
                        onClick={onRemoveAvatar}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Remove Avatar
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-5">
                {/* Name Field */}
                <div>
                  <label className="mb-2 block font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                    placeholder="Your display name"
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-600/80 dark:bg-slate-800/50 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                  />
                </div>

                {/* Bio Field */}
                <div>
                  <label className="mb-2 block font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    Bio
                  </label>
                  <textarea
                    value={form.bio}
                    onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
                    placeholder="Tell teammates about yourself..."
                    maxLength={300}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-slate-300/80 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-600/80 dark:bg-slate-800/50 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                  />
                  <p className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">
                    {form.bio.length}/300
                  </p>
                </div>

                {/* Two Column Grid */}
                <div className="grid gap-5 sm:grid-cols-2">
                  {/* Pronouns Field */}
                  <div>
                    <label className="mb-2 block font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Pronouns
                    </label>
                    <input
                      type="text"
                      value={form.pronouns}
                      onChange={(event) => setForm((prev) => ({ ...prev, pronouns: event.target.value }))}
                      placeholder="e.g., he/him, she/her"
                      maxLength={60}
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-600/80 dark:bg-slate-800/50 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                    />
                  </div>

                  {/* Location Field */}
                  <div>
                    <label className="mb-2 block font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Location
                    </label>
                    <input
                      type="text"
                      value={form.location}
                      onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                      placeholder="City, Country"
                      maxLength={120}
                      className="w-full rounded-xl border border-slate-300/80 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-600/80 dark:bg-slate-800/50 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                    />
                  </div>
                </div>

                {/* Company Field */}
                <div>
                  <label className="mb-2 block font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    Company / Organization
                  </label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))}
                    placeholder="Where you work or study"
                    maxLength={100}
                    className="w-full rounded-xl border border-slate-300/80 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-600/80 dark:bg-slate-800/50 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                  />
                </div>
              </div>

              {/* Messages */}
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/60 dark:bg-red-950/30">
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
                  </div>
                </div>
              )}

              {success && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/60 dark:bg-emerald-950/30">
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{success}</p>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-3 text-sm font-bold uppercase tracking-[0.11em] text-white transition hover:-translate-y-0.5 hover:bg-black disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-900 dark:bg-zinc-900 dark:text-white dark:hover:bg-black"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Saving...
                  </span>
                ) : (
                  'Update Profile'
                )}
              </button>
            </form>
          </div>

          {/* Tips Card */}
          <div className="mt-6 rounded-xl border border-slate-300/70 bg-slate-50/80 p-5 dark:border-slate-700 dark:bg-slate-950/45">
            <p className="font-['Manrope',sans-serif] text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Profile Tips
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
              <li>Your name and avatar appear in shared workspaces.</li>
              <li>Bio helps teammates know you better during collaborations.</li>
              <li>Keep your profile updated for a better experience.</li>
            </ul>
          </div>
        </div>

        {/* Confirmation Modal */}
        {showConfirm && (
          <div
            className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 px-4 backdrop-blur-sm"
            onClick={() => setShowConfirm(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-300/70 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-300/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/50"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/50">
                  <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold">Confirm Changes</h3>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Are you sure you want to save these profile changes?
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.08em] text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmSave}
                  className="rounded-lg border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.08em] text-white transition hover:bg-black dark:border-zinc-900 dark:bg-zinc-900 dark:text-white dark:hover:bg-black"
                >
                  Yes, Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  )
}

export default ProfilePage