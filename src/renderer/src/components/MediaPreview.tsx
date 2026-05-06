import React, { useEffect, useState, useRef, useCallback } from 'react'

// Format seconds to HH:MM:SS.ms
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s
    .toString()
    .padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

function parseTime(str: string): number {
  if (!str) return 0
  const parts = str.split(':')
  if (parts.length !== 3) return 0
  const h = parseInt(parts[0]) || 0
  const m = parseInt(parts[1]) || 0
  const s = parseFloat(parts[2]) || 0
  return h * 3600 + m * 60 + s
}

export function MediaPreview({
  file,
  showTrim = false,
  startTime,
  endTime,
  onSetStart,
  onSetEnd
}: {
  file: File | null
  showTrim?: boolean
  startTime?: string
  endTime?: string
  onSetStart?: (time: string) => void
  onSetEnd?: (time: string) => void
}): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [loopTrim, setLoopTrim] = useState(false)
  const [dragging, setDragging] = useState<'start' | 'end' | 'seek' | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [saveFrameModal, setSaveFrameModal] = useState<{ time: number } | null>(null)
  const [saveFrameToast, setSaveFrameToast] = useState<string | null>(null)
  const [proxyState, setProxyState] = useState<{
    codec: string
    progress: number
  } | null>(null)

  const startSec = parseTime(startTime || '00:00:00')
  const endSec = parseTime(endTime || '00:00:00')

  const playTrim = useCallback((): void => {
    if (!mediaRef.current) return
    mediaRef.current.currentTime = startSec
    mediaRef.current.play()
  }, [startSec])

  function syncTime(): void {
    if (mediaRef.current) setCurrentTime(mediaRef.current.currentTime)
  }

  function handleLoadedMetadata(): void {
    if (mediaRef.current) {
      const d = mediaRef.current.duration
      setDuration(d)
      // Default trim range to the full clip whenever a new file loads
      onSetStart?.(formatTime(0))
      onSetEnd?.(formatTime(d))
    }
  }

  // Loop / pause-at-end behavior
  function handleTimeUpdate(): void {
    syncTime()
    if (!mediaRef.current || !showTrim || endSec <= 0) return
    if (mediaRef.current.currentTime >= endSec) {
      if (loopTrim && !mediaRef.current.paused) {
        mediaRef.current.currentTime = startSec
      } else if (!mediaRef.current.paused) {
        mediaRef.current.pause()
        mediaRef.current.currentTime = endSec
      }
    }
  }

  useEffect(() => {
    if (!file) {
      Promise.resolve().then(() => {
        setPreviewUrl(null)
        setIsLoading(false)
        setProxyState(null)
      })
      return
    }

    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) {
        setIsLoading(true)
        setProxyState(null)
      }
    })
    const objectUrl = URL.createObjectURL(file)

    // Listen for proxy generation progress (only relevant when a proxy is being made)
    window.api.onProxyProgress(({ percent }) => {
      if (!cancelled) {
        setProxyState((prev) => ({
          codec: prev?.codec ?? 'unsupported',
          progress: percent
        }))
      }
    })
    ;(async () => {
      try {
        const result = await window.api.ensurePlayable(file)
        if (cancelled) return

        if (result.needsProxy) {
          // Use the media:// custom protocol to load the proxy from disk
          const normalized = result.proxyPath.replace(/\\/g, '/')
          setPreviewUrl(`media:///${normalized}`)
        } else {
          setPreviewUrl(objectUrl)
        }
      } catch (err) {
        console.error('ensurePlayable failed, falling back to direct preview:', err)
        if (!cancelled) setPreviewUrl(objectUrl)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setProxyState(null)
        }
      }
    })()

    return () => {
      cancelled = true
      window.api.removeProxyListeners()
      if (file) window.api.cancelProxy(file)
      URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  // Keyboard navigation: arrows for seek, I/O for in/out points, L for loop, Space-like via P for Play Trim
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!mediaRef.current || !file) return
      // Don't interfere with text inputs
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const frameTime = 1 / 30
      const step = e.shiftKey ? 1 : frameTime

      if (e.key === 'ArrowRight') {
        e.preventDefault()
        mediaRef.current.currentTime += step
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        mediaRef.current.currentTime -= step
      } else if (showTrim && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault()
        onSetStart?.(formatTime(mediaRef.current.currentTime))
      } else if (showTrim && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        onSetEnd?.(formatTime(mediaRef.current.currentTime))
      } else if (showTrim && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        setLoopTrim((v) => !v)
      } else if (showTrim && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        playTrim()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, showTrim, startSec, endSec, playTrim])

  // Timeline drag handling
  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: MouseEvent): void => {
      if (!timelineRef.current || !duration) return
      const rect = timelineRef.current.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const t = ratio * duration

      if (dragging === 'start') {
        const clamped = Math.min(t, endSec - 0.05)
        onSetStart?.(formatTime(Math.max(0, clamped)))
        if (mediaRef.current) mediaRef.current.currentTime = Math.max(0, clamped)
      } else if (dragging === 'end') {
        const clamped = Math.max(t, startSec + 0.05)
        onSetEnd?.(formatTime(Math.min(duration, clamped)))
        if (mediaRef.current) mediaRef.current.currentTime = Math.min(duration, clamped)
      } else if (dragging === 'seek') {
        if (mediaRef.current) mediaRef.current.currentTime = t
      }
    }

    const handleUp = (): void => setDragging(null)

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, duration, startSec, endSec, onSetStart, onSetEnd])

  const handleSaveFrame = (): void => {
    if (!file || !mediaRef.current) return
    setSaveFrameModal({ time: mediaRef.current.currentTime })
  }

  const showFrameToast = (msg: string): void => {
    setSaveFrameToast(msg)
    setTimeout(() => setSaveFrameToast(null), 3500)
  }

  const saveFrameAt = async (time: number, customPath?: string): Promise<void> => {
    if (!file) return
    setSaveFrameModal(null)
    setIsSaving(true)
    try {
      const savedPath = await window.api.saveFrame(file, time, customPath)
      showFrameToast(`Frame saved · ${savedPath.split(/[\\/]/).pop()}`)
    } catch (err) {
      console.error('Failed to save frame:', err)
      showFrameToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsSaving(false)
    }
  }

  const saveFrameNextToFile = (): void => {
    if (!saveFrameModal) return
    saveFrameAt(saveFrameModal.time)
  }

  const saveFrameToCustomPath = async (): Promise<void> => {
    if (!file || !saveFrameModal) return
    const t = saveFrameModal.time
    const baseName = file.name.replace(/\.[^.]+$/, '')
    const suggested = `${baseName}_frame_${Math.floor(t)}s.png`
    const chosen = await window.api.selectSavePath(suggested)
    if (chosen) {
      saveFrameAt(t, chosen)
    } else {
      // user cancelled — keep modal open
    }
  }

  if (isLoading) {
    const generating = proxyState !== null
    return (
      <div style={{ ...styles.placeholder, gap: '12px' }}>
        <div style={styles.spinner} />
        {generating ? (
          <>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', color: '#ccc' }}>
              Generating preview…
            </p>
            <p
              style={{
                margin: 0,
                fontSize: '0.78rem',
                color: '#555',
                maxWidth: '380px',
                textAlign: 'center',
                lineHeight: 1.6
              }}
            >
              Building H.264 proxy for{' '}
              <code
                style={{
                  color: '#999',
                  background: '#1a1a1a',
                  padding: '0 4px',
                  borderRadius: '3px'
                }}
              >
                {proxyState!.codec}
              </code>{' '}
              — export uses the original.
            </p>
            <div
              style={{
                width: '220px',
                height: '3px',
                marginTop: '4px',
                backgroundColor: '#1e1e1e',
                borderRadius: '4px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${proxyState!.progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
                  transition: 'width 0.25s ease-out',
                  borderRadius: '4px'
                }}
              />
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '0.72rem',
                color: '#555',
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {proxyState!.progress}%
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#555' }}>Analyzing media…</p>
        )}
      </div>
    )
  }

  if (!file || !previewUrl) {
    return <div style={styles.placeholder}>No media selected</div>
  }

  const startPct = duration > 0 ? (startSec / duration) * 100 : 0
  const endPct = duration > 0 ? (Math.min(endSec, duration) / duration) * 100 : 0
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const trimDuration = Math.max(0, endSec - startSec)

  const trimPanel = showTrim ? (
    <div style={styles.trimPanel}>
      <div
        ref={timelineRef}
        style={styles.timeline}
        onMouseDown={(e) => {
          if (!timelineRef.current || !duration) return
          const rect = timelineRef.current.getBoundingClientRect()
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
          if (mediaRef.current) mediaRef.current.currentTime = ratio * duration
          setDragging('seek')
        }}
      >
        <div
          style={{
            ...styles.trimRegion,
            left: `${startPct}%`,
            width: `${Math.max(0, endPct - startPct)}%`
          }}
        />
        <div style={{ ...styles.playhead, left: `${playheadPct}%` }} />
        <div
          style={{ ...styles.handle, left: `${startPct}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            setDragging('start')
          }}
          title="Drag to set start (or press I)"
        >
          <div style={styles.handleBar} />
          <div style={styles.handleLabel}>{formatTime(startSec)}</div>
        </div>
        <div
          style={{ ...styles.handle, left: `${endPct}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            setDragging('end')
          }}
          title="Drag to set end (or press O)"
        >
          <div style={{ ...styles.handleBar, backgroundColor: '#ef4444' }} />
          <div style={{ ...styles.handleLabel, right: 0, left: 'auto' }}>{formatTime(endSec)}</div>
        </div>
      </div>

      {/* Trim toolbar */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
        {/* Mark In */}
        <button
          className="trim-btn"
          onClick={() => onSetStart?.(formatTime(currentTime))}
          title="Set in-point at playhead (I)"
          style={{
            ...styles.trimButton,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '3px',
            padding: '7px 10px',
            flex: 1
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="4" y1="4" x2="4" y2="20" />
              <polyline points="4 12 14 6 14 18 4 12" />
            </svg>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const
              }}
            >
              Mark In
            </span>
            <span style={{ fontSize: '0.65rem', opacity: 0.5, marginLeft: 'auto' }}>I</span>
          </div>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              color: '#60a5fa',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {formatTime(startSec)}
          </span>
        </button>

        {/* Mark Out */}
        <button
          className="trim-btn"
          onClick={() => onSetEnd?.(formatTime(currentTime))}
          title="Set out-point at playhead (O)"
          style={{
            ...styles.trimButton,
            backgroundColor: '#1a1a1a',
            borderColor: '#2a2a2a',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '3px',
            padding: '7px 10px',
            flex: 1
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', width: '100%' }}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f87171"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="20" y1="4" x2="20" y2="20" />
              <polyline points="20 12 10 6 10 18 20 12" />
            </svg>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
                color: '#f87171'
              }}
            >
              Mark Out
            </span>
            <span style={{ fontSize: '0.65rem', opacity: 0.5, marginLeft: 'auto', color: '#888' }}>
              O
            </span>
          </div>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              color: '#f87171',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {formatTime(endSec)}
          </span>
        </button>

        {/* Divider */}
        <div style={{ width: '1px', backgroundColor: '#222', flexShrink: 0, margin: '2px 0' }} />

        {/* Play Trim */}
        <button
          className="trim-btn"
          onClick={playTrim}
          title="Play trim region (P)"
          style={{
            ...styles.trimButton,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '7px 12px',
            backgroundColor: '#1a1a1a',
            borderColor: '#2a2a2a',
            color: '#ccc'
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const
            }}
          >
            Play
          </span>
        </button>

        {/* Loop */}
        <button
          className="trim-btn"
          onClick={() => setLoopTrim((v) => !v)}
          title="Loop the trim region (L)"
          style={{
            ...styles.trimButton,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '7px 12px',
            backgroundColor: loopTrim ? 'rgba(16,185,129,0.1)' : '#1a1a1a',
            borderColor: loopTrim ? 'rgba(16,185,129,0.35)' : '#2a2a2a',
            color: loopTrim ? '#10b981' : '#555'
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const
            }}
          >
            Loop
          </span>
        </button>
      </div>

      {/* Timecode + duration row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 2px'
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '0.72rem',
            color: '#555',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span
            style={{
              fontSize: '0.65rem',
              color: '#444',
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}
          >
            Clip
          </span>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '0.72rem',
              color: '#10b981',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {formatTime(trimDuration)}
          </span>
        </div>
      </div>

      <p
        style={{ fontSize: '0.65rem', color: '#333', margin: '2px 0 0 0', letterSpacing: '0.01em' }}
      >
        <b style={{ color: '#4a4a4a' }}>I/O</b> mark in/out · <b style={{ color: '#4a4a4a' }}>P</b>{' '}
        play · <b style={{ color: '#4a4a4a' }}>L</b> loop · <b style={{ color: '#4a4a4a' }}>← →</b>{' '}
        seek · <b style={{ color: '#4a4a4a' }}>Shift</b> +1s
      </p>
    </div>
  ) : null

  if (file.type.startsWith('video/')) {
    const videoProgress = duration > 0 ? (currentTime / duration) * 100 : 0

    const toggleVideoPlay = (): void => {
      if (!mediaRef.current) return
      if (mediaRef.current.paused) {
        mediaRef.current.play()
        setIsPlaying(true)
      } else {
        mediaRef.current.pause()
        setIsPlaying(false)
      }
    }

    const handleVideoSeek = (e: React.MouseEvent<HTMLDivElement>): void => {
      if (!mediaRef.current || !duration) return
      const rect = e.currentTarget.getBoundingClientRect()
      mediaRef.current.currentTime =
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration
    }

    const handleVideoVolume = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const v = parseFloat(e.target.value)
      setVolume(v)
      setIsMuted(v === 0)
      if (mediaRef.current) mediaRef.current.volume = v
    }

    const toggleVideoMute = (): void => {
      if (!mediaRef.current) return
      const next = !isMuted
      setIsMuted(next)
      mediaRef.current.muted = next
    }

    return (
      <>
        {saveFrameModal && (
          <SaveFrameModal
            time={saveFrameModal.time}
            formattedTime={formatTime(saveFrameModal.time)}
            fileName={file.name}
            onClose={() => setSaveFrameModal(null)}
            onSaveDefault={saveFrameNextToFile}
            onSaveCustom={saveFrameToCustomPath}
          />
        )}
        {saveFrameToast && (
          <div
            className="toast-animated"
            style={{
              position: 'fixed',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(20,20,20,0.95)',
              color: '#e8e8e8',
              padding: '11px 18px',
              borderRadius: '10px',
              border: '1px solid rgba(59,130,246,0.35)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              zIndex: 1001,
              maxWidth: '70%',
              fontSize: '0.85rem',
              backdropFilter: 'blur(12px)'
            }}
          >
            {saveFrameToast}
          </div>
        )}
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0'
          }}
        >
          {/* Video element — no native controls */}
          <video
            ref={(el) => {
              mediaRef.current = el
            }}
            src={previewUrl}
            style={styles.media}
            onTimeUpdate={() => {
              handleTimeUpdate()
              if (mediaRef.current) setIsPlaying(!mediaRef.current.paused)
            }}
            onSeeked={syncTime}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onClick={toggleVideoPlay}
          />

          {/* Custom controls bar */}
          <div
            style={{
              width: '100%',
              maxWidth: styles.media.maxWidth,
              marginTop: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            {/* Seek bar */}
            <div
              onClick={handleVideoSeek}
              style={{
                width: '100%',
                height: '3px',
                backgroundColor: '#1e1e1e',
                borderRadius: '4px',
                cursor: 'pointer',
                position: 'relative'
              }}
            >
              <div
                style={{
                  width: `${videoProgress}%`,
                  height: '100%',
                  backgroundColor: '#3b82f6',
                  borderRadius: '4px',
                  transition: 'width 0.1s linear',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    right: '-5px',
                    top: '-3px',
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    backgroundColor: '#fff'
                  }}
                />
              </div>
            </div>

            {/* Controls row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Play/Pause */}
              <button
                onClick={toggleVideoPlay}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  color: '#ccc',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  transition: 'color 0.15s ease'
                }}
              >
                {isPlaying ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    style={{ marginLeft: '1px' }}
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )}
              </button>

              {/* Time */}
              <span
                style={{
                  fontSize: '0.72rem',
                  color: '#666',
                  fontFamily: 'monospace',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0
                }}
              >
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <div style={{ flex: 1 }} />

              {/* Volume */}
              <button
                onClick={toggleVideoMute}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  color: isMuted ? '#444' : '#666',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0
                }}
              >
                {isMuted || volume === 0 ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={isMuted ? 0 : volume}
                onChange={handleVideoVolume}
                style={{ width: '72px', accentColor: '#3b82f6', cursor: 'pointer' }}
              />

              {/* Save Frame */}
              <button
                className="floating-btn"
                onClick={handleSaveFrame}
                disabled={isSaving}
                style={{
                  ...styles.floatingButton,
                  position: 'static',
                  fontSize: '0.72rem',
                  padding: '5px 10px'
                }}
              >
                {isSaving ? 'Saving…' : 'Save Frame'}
              </button>
            </div>
          </div>

          {trimPanel ?? (
            <p style={{ fontSize: '0.68rem', color: '#3a3a3a', marginTop: '8px' }}>
              <b style={{ color: '#555' }}>← →</b> seek · <b style={{ color: '#555' }}>Shift</b> +1s
              · click video to play/pause
            </p>
          )}
        </div>
      </>
    )
  }

  if (file.type.startsWith('image/')) {
    return <img src={previewUrl} alt={file.name} style={styles.media} />
  }

  if (file.type.startsWith('audio/')) {
    const audioDuration = duration > 0 ? duration : 0
    const audioProgress = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0

    const togglePlay = (): void => {
      if (!mediaRef.current) return
      if (mediaRef.current.paused) {
        mediaRef.current.play()
        setIsPlaying(true)
      } else {
        mediaRef.current.pause()
        setIsPlaying(false)
      }
    }

    const handleAudioSeek = (e: React.MouseEvent<HTMLDivElement>): void => {
      if (!mediaRef.current || !audioDuration) return
      const rect = e.currentTarget.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      mediaRef.current.currentTime = ratio * audioDuration
    }

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const v = parseFloat(e.target.value)
      setVolume(v)
      if (mediaRef.current) mediaRef.current.volume = v
      setIsMuted(v === 0)
    }

    const toggleMute = (): void => {
      if (!mediaRef.current) return
      const next = !isMuted
      setIsMuted(next)
      mediaRef.current.muted = next
    }

    return (
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '14px'
        }}
      >
        {/* Hidden native audio element */}
        <audio
          ref={(el) => {
            mediaRef.current = el
          }}
          src={previewUrl}
          onTimeUpdate={() => {
            handleTimeUpdate()
            if (mediaRef.current) setIsPlaying(!mediaRef.current.paused)
          }}
          onSeeked={syncTime}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          style={{ display: 'none' }}
        />

        {/* Custom player card */}
        <div style={{ ...styles.audioContainer, width: '100%', maxWidth: '820px' }}>
          {/* File icon + name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <div style={{ overflow: 'hidden' }}>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#e0e0e0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {file.name}
              </p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#555', marginTop: '2px' }}>
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>

          {/* Seek bar */}
          <div
            onClick={handleAudioSeek}
            style={{
              width: '100%',
              height: '4px',
              backgroundColor: '#1e1e1e',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '14px',
              position: 'relative'
            }}
          >
            <div
              style={{
                width: `${audioProgress}%`,
                height: '100%',
                backgroundColor: '#3b82f6',
                borderRadius: '4px',
                transition: 'width 0.1s linear',
                position: 'relative'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  right: '-5px',
                  top: '-4px',
                  width: '9px',
                  height: '9px',
                  borderRadius: '50%',
                  backgroundColor: '#fff'
                }}
              />
            </div>
          </div>

          {/* Time display */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.72rem',
              color: '#555',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'monospace',
              marginBottom: '16px'
            }}
          >
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(audioDuration)}</span>
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                backgroundColor: '#3b82f6',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.15s ease'
              }}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="#fff"
                  style={{ marginLeft: '2px' }}
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>

            {/* Volume icon toggle */}
            <button
              onClick={toggleMute}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: isMuted ? '#444' : '#666',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {isMuted || volume === 0 ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : volume < 0.5 ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>

            {/* Volume slider */}
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              style={{ flex: 1, accentColor: '#6366f1', cursor: 'pointer', maxWidth: '100px' }}
            />
          </div>
        </div>

        {trimPanel}
      </div>
    )
  }

  return <div style={styles.placeholder}>Cannot preview this format</div>
}

const styles = {
  media: {
    maxWidth: '100%',
    maxHeight: '60vh',
    objectFit: 'contain' as const,
    borderRadius: '10px',
    backgroundColor: '#000',
    cursor: 'pointer'
  },
  placeholder: {
    width: '100%',
    height: '300px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    border: '1.5px dashed #252525',
    borderRadius: '12px',
    color: '#555',
    gap: '10px'
  },
  audioContainer: {
    padding: '22px 20px',
    background: 'linear-gradient(145deg, #181818, #1c1c1c)',
    borderRadius: '14px',
    border: '1px solid #252525',
    boxSizing: 'border-box' as const
  },
  floatingButton: {
    padding: '7px 12px',
    backgroundColor: 'rgba(0,0,0,0.72)',
    color: '#e0e0e0',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: 500,
    zIndex: 10,
    letterSpacing: '0.01em'
  },
  trimPanel: {
    width: '100%',
    maxWidth: '900px',
    marginTop: '14px',
    padding: '14px 16px',
    background: 'linear-gradient(145deg, #151515, #181818)',
    border: '1px solid #222',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px'
  },
  timeline: {
    position: 'relative' as const,
    width: '100%',
    height: '34px',
    backgroundColor: '#0d0d0d',
    border: '1px solid #222',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  trimRegion: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderTop: '1px solid rgba(59,130,246,0.6)',
    borderBottom: '1px solid rgba(59,130,246,0.6)',
    pointerEvents: 'none' as const
  },
  playhead: {
    position: 'absolute' as const,
    top: '-4px',
    bottom: '-4px',
    width: '2px',
    backgroundColor: 'rgba(255,255,255,0.7)',
    pointerEvents: 'none' as const,
    transform: 'translateX(-1px)'
  },
  handle: {
    position: 'absolute' as const,
    top: '-6px',
    bottom: '-6px',
    width: '14px',
    transform: 'translateX(-7px)',
    cursor: 'ew-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  handleBar: {
    width: '3px',
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: '2px'
  },
  handleLabel: {
    position: 'absolute' as const,
    top: '-22px',
    left: 0,
    fontSize: '0.68rem',
    fontFamily: 'monospace',
    color: '#ccc',
    backgroundColor: '#1e1e1e',
    border: '1px solid #2a2a2a',
    padding: '1px 5px',
    borderRadius: '4px',
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'none' as const
  },
  trimToolbar: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap' as const
  },
  trimButton: {
    backgroundColor: '#1c1c1c',
    color: '#ccc',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: 600 as const,
    transition: 'all 0.15s ease'
  },
  trimReadout: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.8rem',
    color: '#666',
    fontVariantNumeric: 'tabular-nums' as const
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '2px solid rgba(255,255,255,0.07)',
    borderTop: '2px solid #3b82f6',
    borderRadius: '50%',
    flexShrink: 0,
    animation: 'spin 0.8s linear infinite'
  }
}

function SaveFrameModal({
  formattedTime,
  fileName,
  onClose,
  onSaveDefault,
  onSaveCustom
}: {
  time: number
  formattedTime: string
  fileName: string
  onClose: () => void
  onSaveDefault: () => void
  onSaveCustom: () => void
}): React.JSX.Element {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.18s ease'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="done-card"
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'linear-gradient(145deg, #181818, #1c1c1c)',
          border: '1px solid #2a2a2a',
          borderRadius: '14px',
          padding: '22px 22px 18px',
          color: '#e0e0e0'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#60a5fa"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          <div style={{ overflow: 'hidden' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#e8e8e8' }}>
              Save Frame
            </h3>
            <p
              style={{
                margin: '2px 0 0 0',
                fontSize: '0.72rem',
                color: '#666',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              <span style={{ fontFamily: 'monospace', color: '#888' }}>{formattedTime}</span> ·{' '}
              {fileName}
            </p>
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          <button
            onClick={onSaveDefault}
            className="action-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #2a2a2a',
              backgroundColor: '#1a1a1a',
              cursor: 'pointer',
              textAlign: 'left' as const,
              color: '#e0e0e0',
              fontFamily: 'inherit'
            }}
          >
            <span
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: '#202020',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#888"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500 }}>
                Save next to file
              </span>
              <span
                style={{ display: 'block', fontSize: '0.72rem', color: '#666', marginTop: '2px' }}
              >
                Auto-named in the source folder
              </span>
            </span>
          </button>

          <button
            onClick={onSaveCustom}
            className="action-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #2a2a2a',
              backgroundColor: '#1a1a1a',
              cursor: 'pointer',
              textAlign: 'left' as const,
              color: '#e0e0e0',
              fontFamily: 'inherit'
            }}
          >
            <span
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: '#202020',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#60a5fa"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500 }}>
                Choose location…
              </span>
              <span
                style={{ display: 'block', fontSize: '0.72rem', color: '#666', marginTop: '2px' }}
              >
                Pick a folder and name
              </span>
            </span>
          </button>
        </div>

        {/* Cancel */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 14px',
              borderRadius: '7px',
              backgroundColor: 'transparent',
              border: '1px solid #2a2a2a',
              color: '#888',
              fontSize: '0.8rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3a3a3a'
              e.currentTarget.style.color = '#bbb'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#2a2a2a'
              e.currentTarget.style.color = '#888'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `
  document.head.appendChild(style)
}
