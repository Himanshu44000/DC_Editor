import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Room, RoomEvent } from 'livekit-client'
import { apiRequest } from '../lib/api'

const MAX_VISIBLE_AVATARS = 5
const DEFAULT_AVATAR_PATH = '/branding/defaultAvatar.png'
const PARTICIPANTS_POLL_MS = 5000

const parseParticipantMeta = (participant, avatarOverrides = new Map()) => {
  let parsed = {}
  try {
    parsed = participant?.metadata ? JSON.parse(participant.metadata) : {}
  } catch {
    parsed = {}
  }

  const identity = String(participant?.identity || '').trim()
  const name = String(participant?.name || parsed?.name || 'User').trim() || 'User'
  const avatarUrl = String(avatarOverrides.get(identity) || parsed?.avatarUrl || '').trim()

  return {
    id: identity || `participant-${Math.random().toString(36).slice(2, 10)}`,
    name,
    avatarUrl,
    isLocal: Boolean(participant?.isLocal),
  }
}

const VoiceChannelPanel = ({ projectId, getAuthToken }) => {
  const roomRef = useRef(null)
  const avatarOverridesRef = useRef(new Map())
  const [participants, setParticipants] = useState([])
  const [isJoined, setIsJoined] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [error, setError] = useState('')

  const syncParticipants = useCallback((room, avatarOverrides = avatarOverridesRef.current) => {
    if (!room) {
      setParticipants([])
      return
    }

    const nextParticipants = [
      parseParticipantMeta(room.localParticipant, avatarOverrides),
      ...Array.from(room.remoteParticipants.values()).map((participant) => parseParticipantMeta(participant, avatarOverrides)),
    ]

    nextParticipants.sort((a, b) => {
      if (a.isLocal && !b.isLocal) return -1
      if (!a.isLocal && b.isLocal) return 1
      return a.name.localeCompare(b.name)
    })

    setParticipants(nextParticipants)
  }, [])

  const fetchLiveParticipants = useCallback(async () => {
    if (!projectId) return
    try {
      const data = await apiRequest(`/projects/${projectId}/voice/participants`, {}, getAuthToken)
      const overrides = new Map()
      const nextParticipants = Array.isArray(data?.participants)
        ? data.participants.map((participant) => ({
            id: String(participant?.id || '').trim() || `participant-${Math.random().toString(36).slice(2, 10)}`,
            name: String(participant?.name || 'User').trim() || 'User',
            avatarUrl: String(participant?.avatarUrl || '').trim(),
            isLocal: String(participant?.id || '').trim() === String(roomRef.current?.localParticipant?.identity || '').trim(),
          }))
        : []

      for (const participant of nextParticipants) {
        if (!participant.id) continue
        overrides.set(participant.id, participant.avatarUrl)
      }

      avatarOverridesRef.current = overrides

      if (roomRef.current) {
        syncParticipants(roomRef.current, overrides)
        return
      }

      setParticipants(nextParticipants)
    } catch {
      if (!roomRef.current) {
        setParticipants([])
      }
    }
  }, [getAuthToken, projectId, syncParticipants])

  const leaveVoiceChannel = useCallback(async () => {
    const room = roomRef.current
    if (!room) {
      setIsJoined(false)
      setIsMuted(true)
      setParticipants([])
      return
    }

    setIsLeaving(true)
    try {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => false)
      room.disconnect(true)
    } finally {
      roomRef.current = null
      setIsJoined(false)
      setIsMuted(true)
      setParticipants([])
      setIsLeaving(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      const room = roomRef.current
      if (room) {
        room.disconnect(true)
        roomRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    setError('')
    avatarOverridesRef.current = new Map()
    void leaveVoiceChannel()
  }, [projectId, leaveVoiceChannel])

  useEffect(() => {
    if (!projectId) return undefined

    void fetchLiveParticipants()
    const intervalId = window.setInterval(() => {
      void fetchLiveParticipants()
    }, PARTICIPANTS_POLL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fetchLiveParticipants, isJoined, projectId])

  const joinVoiceChannel = async () => {
    if (!projectId || isJoining || isJoined) return

    setError('')
    setIsJoining(true)

    let room = null
    try {
      const data = await apiRequest(`/projects/${projectId}/voice/token`, {}, getAuthToken)
      const token = String(data?.token || '').trim()
      const serverUrl = String(data?.url || '').trim()

      if (!token || !serverUrl) {
        throw new Error('Voice service is not configured yet.')
      }

      room = new Room({
        adaptiveStream: true,
        dynacast: true,
      })

      const onParticipantsChanged = () => syncParticipants(room)
      const onDisconnected = () => {
        setIsJoined(false)
        setIsMuted(true)
        void fetchLiveParticipants()
      }

      room.on(RoomEvent.ParticipantConnected, onParticipantsChanged)
      room.on(RoomEvent.ParticipantDisconnected, onParticipantsChanged)
      room.on(RoomEvent.ParticipantMetadataChanged, onParticipantsChanged)
      room.on(RoomEvent.ConnectionStateChanged, () => {
        if (room.state === 'disconnected') {
          onDisconnected()
        }
      })

      await room.connect(serverUrl, token)
      await room.localParticipant.setMicrophoneEnabled(true)

      roomRef.current = room
      setIsJoined(true)
      setIsMuted(false)
      await fetchLiveParticipants()
      syncParticipants(room)
    } catch (joinError) {
      if (room) {
        room.disconnect(true)
      }
      setIsJoined(false)
      setIsMuted(true)
      setParticipants([])
      setError(joinError?.message || 'Failed to join voice channel')
    } finally {
      setIsJoining(false)
    }
  }

  const toggleMute = async () => {
    const room = roomRef.current
    if (!room || !isJoined) return

    setError('')
    try {
      const nextMicEnabled = isMuted
      await room.localParticipant.setMicrophoneEnabled(nextMicEnabled)
      setIsMuted(!nextMicEnabled)
    } catch (muteError) {
      setError(muteError?.message || 'Failed to toggle microphone')
    }
  }

  const visibleParticipants = useMemo(() => participants.slice(0, MAX_VISIBLE_AVATARS), [participants])
  const extraParticipantsCount = Math.max(0, participants.length - MAX_VISIBLE_AVATARS)

  return (
    <div className="voice-channel-box stack-sm">
      <div className="voice-channel-head">
        <h4>Voice Channel</h4>
        <span className={`voice-channel-state ${isJoined ? 'on' : 'off'}`}>{isJoined ? 'Connected' : 'Idle'}</span>
      </div>

      <div className="voice-channel-presence">
        <span className="voice-channel-icon" aria-hidden="true">
          🔊
        </span>
        {visibleParticipants.length > 0 ? (
          <>
            {visibleParticipants.map((participant) => (
              <div key={participant.id} className="voice-participant-avatar" title={participant.name}>
                <img
                  src={participant.avatarUrl || DEFAULT_AVATAR_PATH}
                  alt={participant.name}
                  onError={(event) => {
                    event.currentTarget.src = DEFAULT_AVATAR_PATH
                  }}
                />
              </div>
            ))}
            {extraParticipantsCount > 0 && <span className="voice-participant-more">+{extraParticipantsCount}</span>}
          </>
        ) : (
          <span className="voice-participant-empty">No one is in VC yet</span>
        )}
      </div>

      <div className="voice-channel-actions">
        {!isJoined && (
          <button type="button" onClick={joinVoiceChannel} disabled={isJoining || isLeaving}>
            {isJoining ? 'Joining...' : 'Join VC'}
          </button>
        )}
        {isJoined && (
          <>
            <button type="button" onClick={leaveVoiceChannel} disabled={isJoining || isLeaving}>
              {isLeaving ? 'Leaving...' : 'Leave VC'}
            </button>
            <button type="button" onClick={toggleMute} disabled={isJoining || isLeaving}>
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
          </>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

export default VoiceChannelPanel
