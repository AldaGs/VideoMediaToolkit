import React, { useState, useRef, useEffect } from 'react'
import { MediaPreview } from './components/MediaPreview'
import { AdvancedPanel } from './components/AdvancedPanel'
import {
  type AdvancedSettings,
  defaultAdvancedSettings,
  simpleToAdvanced
} from './utils/advancedUtils'
import type { FFmpegCaps, Preset } from './env'

// NEW: The Pro Data Structure
interface QueueItem {
  id: string
  file: File
  status: 'idle' | 'processing' | 'done' | 'error'
  outputPath?: string
  errorMessage?: string
  customOutputPath?: string
}

const timeStringToSeconds = (timeString: string): number => {
  const [hours, minutes, seconds] = timeString.split(':')
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds)
}

function App(): React.JSX.Element {
  // State upgraded to handle intelligent items, not just files
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [batchSelection, setBatchSelection] = useState<Set<number>>(new Set())

  const [selectedTool, setSelectedTool] = useState<string>('compress')
  const [replaceOriginal, setReplaceOriginal] = useState<boolean>(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)

  // Tool-specific settings
  const [startTime, setStartTime] = useState('00:00:00')
  const [endTime, setEndTime] = useState('00:00:10')

  // Advanced Video Settings
  const [codec, setCodec] = useState('libx264')
  const [compressionMethod, setCompressionMethod] = useState<'crf' | 'bitrate'>('crf')
  const [crf, setCrf] = useState(28)
  const [bitrate, setBitrate] = useState('2M')
  const [resizeWidth, setResizeWidth] = useState('')
  const [resizeHeight, setResizeHeight] = useState('')
  const [outputFormat, setOutputFormat] = useState('mp4')
  const [originalWidth, setOriginalWidth] = useState<number | null>(null)
  const [originalHeight, setOriginalHeight] = useState<number | null>(null)
  const [keepAspectRatio, setKeepAspectRatio] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const [exportToast, setExportToast] = useState<string | null>(null)

  // Audio extract / convert settings
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'wav' | 'aac' | 'm4a'>('mp3')
  const [audioMode, setAudioMode] = useState<'vbr' | 'cbr'>('vbr')
  const [audioQuality, setAudioQuality] = useState<number>(2) // mp3 VBR 0-9
  const [audioBitrate, setAudioBitrate] = useState<string>('192k')
  const [wavBitDepth, setWavBitDepth] = useState<'16' | '24'>('16')
  const [leftWidth, setLeftWidth] = useState(280) // Default Queue width
  const [rightWidth, setRightWidth] = useState(320) // Default Settings width
  const [isDragging, setIsDragging] = useState<'left' | 'right' | null>(null)

  // Advanced mode
  const [advancedMode, setAdvancedMode] = useState(false)
  const [advancedSettings, setAdvancedSettings] =
    useState<AdvancedSettings>(defaultAdvancedSettings)
  const [advancedDirty, setAdvancedDirty] = useState(false)
  const [ffmpegCaps, setFfmpegCaps] = useState<FFmpegCaps | null>(null)
  const [capsLoading, setCapsLoading] = useState(false)
  const [capsError, setCapsError] = useState<string | null>(null)

  // Presets
  const [presets, setPresets] = useState<Preset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)

  const loadCaps = async (): Promise<void> => {
    setCapsLoading(true)
    setCapsError(null)
    try {
      const caps = await window.api.getFfmpegCaps()
      setFfmpegCaps(caps)
    } catch (err) {
      setCapsError(err instanceof Error ? err.message : String(err))
    } finally {
      setCapsLoading(false)
    }
  }

  // Lazy-load caps the first time advanced mode is enabled
  useEffect(() => {
    if (advancedMode && !ffmpegCaps && !capsLoading) {
      void loadCaps()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedMode])

  // Load presets at app start (cheap; reads one JSON file)
  useEffect(() => {
    void window.api
      .listPresets()
      .then(setPresets)
      .catch(() => setPresets([]))
  }, [])

  const handleApplyPreset = (preset: Preset): void => {
    setAdvancedSettings(preset.settings)
    setAdvancedDirty(true)
    setActivePresetId(preset.id)
  }

  const handleSavePreset = async (name: string, overwriteId?: string): Promise<void> => {
    // Save the *currently effective* settings (mirrored or custom)
    const mirrored = simpleToAdvanced({
      selectedTool,
      codec,
      compressionMethod,
      crf,
      bitrate,
      resizeWidth,
      resizeHeight,
      outputFormat,
      audioFormat,
      audioMode,
      audioQuality,
      audioBitrate,
      wavBitDepth,
      startTime,
      endTime
    })
    const settingsToSave = advancedDirty ? advancedSettings : mirrored
    const updated = await window.api.savePreset({
      id: overwriteId,
      name,
      settings: settingsToSave
    })
    setPresets(updated)
    // Mark the saved preset as active
    const saved = updated.find((p) => p.name === name.trim())
    if (saved) setActivePresetId(saved.id)
  }

  const handleDeletePreset = async (id: string): Promise<void> => {
    const updated = await window.api.deletePreset(id)
    setPresets(updated)
    if (activePresetId === id) setActivePresetId(null)
  }

  const handleRenamePreset = async (id: string, name: string): Promise<void> => {
    const updated = await window.api.renamePreset(id, name)
    setPresets(updated)
  }

  // Editing the advanced settings invalidates the active preset link
  const handleAdvancedChange = (s: AdvancedSettings): void => {
    setAdvancedSettings(s)
    setAdvancedDirty(true)
    setActivePresetId(null)
  }

  const durationRef = useRef<number>(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const forcesExtensionChange = ['extract_audio', 'gif', 'save_frame'].includes(selectedTool)

  useEffect(() => {
    window.api.onProgress((log: string) => {
      const durationMatch = log.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
      if (durationMatch) durationRef.current = timeStringToSeconds(durationMatch[1])

      const timeMatch = log.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/)
      if (timeMatch && durationRef.current > 0) {
        const currentTime = timeStringToSeconds(timeMatch[1])
        let percentage = Math.round((currentTime / durationRef.current) * 100)
        if (percentage > 100) percentage = 100
        setProgress(percentage)
      }
    })
    return () => window.api.removeListeners()
  }, [])

  // ADD FILES (Upgraded to wrap files in QueueItems)
  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    addFilesToQueue(Array.from(e.dataTransfer.files))
  }

  // Smart Auto-Select Tool based on file type
  useEffect(() => {
    if (activeIndex !== null && queue[activeIndex]) {
      const file = queue[activeIndex].file
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')
      const isAudio = file.type.startsWith('audio/')

      if (isImage && selectedTool !== 'image_convert') {
        setSelectedTool('image_convert')
      } else if (isVideo && selectedTool === 'image_convert') {
        setSelectedTool('compress')
      } else if (isAudio && selectedTool !== 'extract_audio' && selectedTool !== 'trim_audio') {
        setSelectedTool('extract_audio')
      }
    }
  }, [activeIndex, queue, selectedTool])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) addFilesToQueue(Array.from(e.target.files))
    e.target.value = ''
  }

  const addFilesToQueue = (newFiles: File[]): void => {
    const newItems: QueueItem[] = newFiles.map((file) => ({
      id: Math.random().toString(36).substring(7), // Unique ID
      file,
      status: 'idle'
    }))

    setQueue((prev) => {
      const updatedQueue = [...prev, ...newItems]
      if (activeIndex === null) setActiveIndex(prev.length)
      return updatedQueue
    })
  }

  const removeFromQueue = (indexToRemove: number): void => {
    setQueue((prev) => prev.filter((_, i) => i !== indexToRemove))
    setBatchSelection((prev) => {
      const newSet = new Set(prev)
      newSet.delete(indexToRemove)
      return newSet
    })
    if (activeIndex === indexToRemove) setActiveIndex(null)
  }

  // Fetch Metadata when active index changes
  useEffect(() => {
    if (activeIndex !== null && queue[activeIndex]) {
      const file = queue[activeIndex].file
      // Trigger for both video and image files
      if (file.type.startsWith('video/') || file.type.startsWith('image/')) {
        setIsAnalyzing(true)
        window.api
          .getMetadata(file)
          .then((meta) => {
            setOriginalWidth(meta.width)
            setOriginalHeight(meta.height)
            setResizeWidth(meta.width.toString())
            setResizeHeight(meta.height.toString())
          })
          .catch((err) => console.error('Metadata error:', err))
          .finally(() => setIsAnalyzing(false))
      }
    } else {
      setOriginalWidth(null)
      setOriginalHeight(null)
      setIsAnalyzing(false)
    }
  }, [activeIndex, queue])

  const toggleBatchSelection = (index: number): void => {
    // Prevent selecting items that are already done or processing
    if (queue[index].status === 'done' || queue[index].status === 'processing') return

    setBatchSelection((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(index)) newSet.delete(index)
      else newSet.add(index)
      return newSet
    })
  }

  const handleWidthChange = (val: string): void => {
    setResizeWidth(val)
    if (keepAspectRatio && originalWidth && originalHeight) {
      const w = parseInt(val)
      if (!isNaN(w)) {
        setResizeHeight(Math.round((w * originalHeight) / originalWidth).toString())
      }
    }
  }

  const handleHeightChange = (val: string): void => {
    setResizeHeight(val)
    if (keepAspectRatio && originalWidth && originalHeight) {
      const h = parseInt(val)
      if (!isNaN(h)) {
        setResizeWidth(Math.round((h * originalWidth) / originalHeight).toString())
      }
    }
  }

  const handleScale = (factor: number): void => {
    if (originalWidth && originalHeight) {
      setResizeWidth(Math.round(originalWidth * factor).toString())
      setResizeHeight(Math.round(originalHeight * factor).toString())
    }
  }

  const selectAllIdle = (): void => {
    const idleIndexes = queue
      .map((item, i) => (item.status === 'idle' ? i : -1))
      .filter((i) => i !== -1)

    if (batchSelection.size === idleIndexes.length) {
      setBatchSelection(new Set())
    } else {
      setBatchSelection(new Set(idleIndexes))
    }
  }

  const handleSelectSavePath = async (): Promise<void> => {
    if (activeIndex === null || !queue[activeIndex]) return
    const item = queue[activeIndex]
    const path = await window.api.selectSavePath(item.file.name)
    if (path) {
      setQueue((prev) => {
        const next = [...prev]
        next[activeIndex] = { ...next[activeIndex], customOutputPath: path }
        return next
      })
    }
  }

  const clearActiveCustomPath = (): void => {
    if (activeIndex === null) return
    setQueue((prev) => {
      const next = [...prev]
      next[activeIndex] = { ...next[activeIndex], customOutputPath: undefined }
      return next
    })
  }

  // THE NEW PROCESSING LOOP
  const handleProcessBatch = async (): Promise<void> => {
    setIsProcessing(true)

    // We only process items that are currently checked
    const itemsToProcess = Array.from(batchSelection).map((index) => ({
      index,
      item: queue[index]
    }))

    for (const { index, item } of itemsToProcess) {
      try {
        setProgress(0)
        durationRef.current = 0

        // 1. Mark as processing in the UI
        setQueue((prev) => {
          const newQueue = [...prev]
          newQueue[index] = { ...newQueue[index], status: 'processing' }
          return newQueue
        })

        const safeToReplace = replaceOriginal && !forcesExtensionChange

        // 2. Execute (each item uses its own customOutputPath)
        const itemCustomPath = item.customOutputPath
        let resultPath: string

        if (advancedMode) {
          // Compute the same effective settings the panel shows for this item
          const mirrored = simpleToAdvanced({
            selectedTool,
            codec,
            compressionMethod,
            crf,
            bitrate,
            resizeWidth,
            resizeHeight,
            outputFormat,
            audioFormat,
            audioMode,
            audioQuality,
            audioBitrate,
            wavBitDepth,
            startTime,
            endTime
          })
          const effective = advancedDirty ? advancedSettings : mirrored
          resultPath = await window.api.processAdvanced(
            item.file,
            effective,
            safeToReplace,
            itemCustomPath
          )
        } else if (selectedTool === 'image_convert') {
          resultPath = await window.api.convertImage(item.file, {
            format: outputFormat,
            width: resizeWidth ? parseInt(resizeWidth) : undefined,
            height: resizeHeight ? parseInt(resizeHeight) : undefined,
            crf, // Reusing CRF state as general Quality (0-100)
            customOutputPath: itemCustomPath,
            outputFolder: undefined
          })
        } else {
          resultPath = await window.api.processMedia(item.file, selectedTool, safeToReplace, {
            startTime,
            endTime,
            codec,
            compressionMethod,
            crf,
            bitrate,
            width: resizeWidth ? parseInt(resizeWidth) : undefined,
            height: resizeHeight ? parseInt(resizeHeight) : undefined,
            format: outputFormat,
            audioFormat,
            audioMode,
            audioQuality,
            audioBitrate,
            wavBitDepth,
            customOutputPath: itemCustomPath,
            outputFolder: undefined
          })
        }

        // 3. Mark as DONE and save the path!
        setQueue((prev) => {
          const newQueue = [...prev]
          newQueue[index] = { ...newQueue[index], status: 'done', outputPath: resultPath }
          return newQueue
        })

        // 4. Remove from batch selection so it can't be processed again
        setBatchSelection((prev) => {
          const newSet = new Set(prev)
          newSet.delete(index)
          return newSet
        })
      } catch (err: unknown) {
        // Mark as error
        setQueue((prev) => {
          const newQueue = [...prev]
          newQueue[index] = {
            ...newQueue[index],
            status: 'error',
            errorMessage: err instanceof Error ? err.message : String(err)
          }
          return newQueue
        })
      }
    }

    setIsProcessing(false)
    setProgress(0)
  }

  // NEW: Mouse drag listener for resizing panels
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent): void => {
      if (isDragging === 'left') {
        // Calculate new width based on mouse X position. Min 200px, Max 600px.
        const newWidth = Math.max(200, Math.min(e.clientX, 600))
        setLeftWidth(newWidth)
      } else if (isDragging === 'right') {
        // Calculate from the right edge of the window. Min 250px, Max 600px.
        const newWidth = Math.max(250, Math.min(window.innerWidth - e.clientX, 600))
        setRightWidth(newWidth)
      }
    }

    const handleMouseUp = (): void => setIsDragging(null)

    // Attach to document so dragging works even if the mouse leaves the tiny separator line
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  const activeItem = activeIndex !== null && queue[activeIndex] ? queue[activeIndex] : null

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#111111',
        color: '#e8e8e8',
        userSelect: isDragging ? 'none' : 'auto',
        cursor: isDragging ? 'col-resize' : 'default'
      }}
    >
      <input type="file" multiple hidden ref={fileInputRef} onChange={handleFileSelect} />

      {exportToast && (
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
            border: '1px solid rgba(16,185,129,0.35)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 1000,
            maxWidth: '70%',
            fontSize: '0.875rem',
            wordBreak: 'break-all',
            backdropFilter: 'blur(12px)'
          }}
        >
          {exportToast}
        </div>
      )}

      {/* COLUMN 1: THE QUEUE */}
      <div
        style={{
          width: `${leftWidth}px`,
          backgroundColor: '#171717',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #222'
        }}
      >
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid #222' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <h2
              style={{
                margin: 0,
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#999',
                letterSpacing: '0.07em',
                textTransform: 'uppercase'
              }}
            >
              Queue
            </h2>
            {queue.length > 0 && (
              <span
                style={{
                  fontSize: '0.72rem',
                  backgroundColor: '#2a2a2a',
                  color: '#777',
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontWeight: 500
                }}
              >
                {queue.length}
              </span>
            )}
          </div>
          <button
            className="btn-import"
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%',
              padding: '9px 12px',
              cursor: 'pointer',
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: 'white',
              border: 'none',
              borderRadius: '7px',
              fontWeight: 600,
              fontSize: '0.85rem',
              letterSpacing: '0.01em',
              boxShadow: 'none'
            }}
          >
            + Import Files
          </button>
        </div>

        {queue.length > 0 && (
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid #1e1e1e',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.78rem',
              color: '#555'
            }}
          >
            <span>
              {queue.filter((i) => i.status === 'idle' || i.status === 'error').length} pending
            </span>
            <span
              className="toggle-all"
              style={{ cursor: 'pointer', color: '#3b82f6', fontWeight: 500 }}
              onClick={selectAllIdle}
            >
              Toggle All
            </span>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {queue.length === 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                marginTop: '40px',
                color: '#3a3a3a',
                textAlign: 'center',
                padding: '0 16px'
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: 0.5 }}
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.5 }}>
                Drop files here
                <br />
                or click Import
              </p>
            </div>
          )}

          {queue.map((item, index) => (
            <div
              key={item.id}
              className={`queue-item${activeIndex === index ? ' active' : ''}${item.status === 'done' ? ' done' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '7px 8px',
                marginBottom: '2px',
                backgroundColor: activeIndex === index ? '#222' : 'transparent',
                borderRadius: '7px',
                cursor: 'pointer',
                border: activeIndex === index ? '1px solid #303030' : '1px solid transparent',
                opacity: item.status === 'done' ? 0.55 : 1
              }}
              onClick={() => setActiveIndex(index)}
            >
              {/* Checkbox (Hidden if done/processing) */}
              {item.status === 'idle' || item.status === 'error' ? (
                <input
                  type="checkbox"
                  checked={batchSelection.has(index)}
                  onChange={() => toggleBatchSelection(index)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginRight: '9px', cursor: 'pointer', flexShrink: 0 }}
                />
              ) : (
                <span
                  style={{
                    marginRight: '9px',
                    width: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {item.status === 'done' ? (
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#10b981',
                        display: 'inline-block'
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#f59e0b',
                        display: 'inline-block',
                        animation: 'pulse 1.2s ease-in-out infinite'
                      }}
                    />
                  )}
                </span>
              )}

              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '0.82rem',
                  fontWeight: 450,
                  color: item.status === 'error' ? '#f87171' : '#ccc'
                }}
              >
                {item.file.name}
              </span>

              {item.customOutputPath && item.status !== 'done' && (
                <span
                  title={`Custom output: ${item.customOutputPath}`}
                  style={{
                    marginRight: '4px',
                    color: '#3b82f6',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0
                  }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
              )}

              <button
                className="mini-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  removeFromQueue(index)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#4a4a4a',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  fontSize: '0.75rem',
                  lineHeight: 1,
                  borderRadius: '4px',
                  flexShrink: 0
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* RESIZER 1 (Left) */}
      <div
        onMouseDown={() => setIsDragging('left')}
        style={{
          width: '3px',
          cursor: 'col-resize',
          backgroundColor: isDragging === 'left' ? '#3b82f6' : 'transparent',
          zIndex: 10,
          transition: 'background-color 0.15s ease'
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = isDragging === 'left' ? '#3b82f6' : '#2a2a2a')
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor =
            isDragging === 'left' ? '#3b82f6' : 'transparent')
        }
      />

      {/* COLUMN 2: THE PREVIEW */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '1.75rem',
          overflow: 'hidden',
          backgroundColor: '#111111'
        }}
      >
        {activeItem ? (
          <>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              {/* PRO UX: Handle the different states of the item */}
              {activeItem.status === 'done' ? (
                <div
                  className="done-card"
                  style={{
                    textAlign: 'center',
                    background: 'linear-gradient(145deg, #181818, #1c1c1c)',
                    padding: '44px 40px',
                    borderRadius: '16px',
                    border: '1px solid #272727',
                    boxShadow: 'none',
                    maxWidth: '480px'
                  }}
                >
                  {/* Check mark */}
                  <div style={{ marginBottom: '16px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: 'rgba(16,185,129,0.12)',
                        border: '1px solid rgba(16,185,129,0.3)'
                      }}
                    >
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  </div>
                  <h2
                    style={{
                      color: '#e8e8e8',
                      margin: '0 0 6px 0',
                      fontSize: '1.1rem',
                      fontWeight: 600
                    }}
                  >
                    Done
                  </h2>
                  <p
                    style={{
                      color: '#555',
                      fontSize: '0.78rem',
                      margin: '0 auto 22px auto',
                      maxWidth: '380px',
                      wordBreak: 'break-all',
                      lineHeight: 1.6
                    }}
                  >
                    {activeItem.outputPath}
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button
                      className="action-btn"
                      onClick={() => window.api.showInFolder(activeItem.outputPath!)}
                      style={{
                        padding: '9px 18px',
                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.84rem',
                        boxShadow: 'none'
                      }}
                    >
                      Show in Folder
                    </button>
                    <button
                      className="action-btn"
                      onClick={async () => {
                        try {
                          const res = await window.api.exportFile(activeItem.outputPath!)
                          if (!res.canceled) {
                            setExportToast(`Exported to ${res.filePath}`)
                            setTimeout(() => setExportToast(null), 4000)
                          }
                        } catch (err) {
                          setExportToast(
                            `Export failed: ${err instanceof Error ? err.message : String(err)}`
                          )
                          setTimeout(() => setExportToast(null), 5000)
                        }
                      }}
                      style={{
                        padding: '9px 18px',
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.84rem',
                        boxShadow: 'none'
                      }}
                      title="Save a copy to a custom location with a custom name"
                    >
                      Export As…
                    </button>
                  </div>
                </div>
              ) : activeItem.status === 'error' ? (
                <div style={{ textAlign: 'center', padding: '40px', maxWidth: '420px' }}>
                  <div style={{ marginBottom: '14px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.25)'
                      }}
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </span>
                  </div>
                  <h2
                    style={{
                      color: '#f87171',
                      margin: '0 0 8px 0',
                      fontSize: '1rem',
                      fontWeight: 600
                    }}
                  >
                    Processing Failed
                  </h2>
                  <p style={{ color: '#666', fontSize: '0.82rem', margin: 0, lineHeight: 1.6 }}>
                    {activeItem.errorMessage}
                  </p>
                </div>
              ) : (
                <MediaPreview
                  file={activeItem.file}
                  showTrim={
                    selectedTool === 'trim' ||
                    selectedTool === 'gif' ||
                    selectedTool === 'trim_audio'
                  }
                  startTime={startTime}
                  endTime={endTime}
                  onSetStart={setStartTime}
                  onSetEnd={setEndTime}
                />
              )}
            </div>

            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <h3
                style={{
                  margin: '0 0 4px 0',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#ccc',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%'
                }}
              >
                {activeItem.file.name}
              </h3>
              <p style={{ color: '#555', margin: 0, fontSize: '0.78rem' }}>
                {(activeItem.file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '12px',
              color: '#333',
              border: '1.5px dashed #222',
              borderRadius: '14px',
              margin: '4px'
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 500, color: '#404040' }}>
              Drop files here
            </p>
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#333' }}>
              or select from the queue
            </p>
          </div>
        )}
      </div>

      {/* RESIZER 2 (Right) */}
      <div
        onMouseDown={() => setIsDragging('right')}
        style={{
          width: '3px',
          cursor: 'col-resize',
          backgroundColor: isDragging === 'right' ? '#3b82f6' : 'transparent',
          zIndex: 10,
          transition: 'background-color 0.15s ease'
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = isDragging === 'right' ? '#3b82f6' : '#2a2a2a')
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor =
            isDragging === 'right' ? '#3b82f6' : 'transparent')
        }
      />

      {/* COLUMN 3: TOOL SETTINGS */}
      <div
        style={{
          width: `${rightWidth}px`,
          backgroundColor: '#171717',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid #222'
        }}
      >
        <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid #222' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px'
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#999',
                letterSpacing: '0.07em',
                textTransform: 'uppercase'
              }}
            >
              Settings
            </h2>
          </div>
          {/* Mode switcher */}
          <div
            style={{
              display: 'flex',
              backgroundColor: '#1a1a1a',
              borderRadius: '7px',
              padding: '3px',
              border: '1px solid #252525'
            }}
          >
            <button
              onClick={() => setAdvancedMode(false)}
              disabled={isProcessing}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '5px',
                border: 'none',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                backgroundColor: !advancedMode ? '#2a2a2a' : 'transparent',
                color: !advancedMode ? '#fff' : '#666',
                fontSize: '0.78rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease'
              }}
            >
              Simple
            </button>
            <button
              onClick={() => setAdvancedMode(true)}
              disabled={isProcessing}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '5px',
                border: 'none',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                backgroundColor: advancedMode ? '#2a2a2a' : 'transparent',
                color: advancedMode ? '#fff' : '#666',
                fontSize: '0.78rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}
            >
              Advanced
              {advancedMode && (
                <span
                  style={{
                    fontSize: '0.6rem',
                    backgroundColor: '#3b82f6',
                    color: '#fff',
                    padding: '1px 5px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    letterSpacing: '0.04em'
                  }}
                >
                  BETA
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Scrollable: action + tool config */}
        <div
          style={{
            padding: '16px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            overflowY: 'auto',
            minHeight: 0
          }}
        >
          {advancedMode ? (
            (() => {
              const mirrored = simpleToAdvanced({
                selectedTool,
                codec,
                compressionMethod,
                crf,
                bitrate,
                resizeWidth,
                resizeHeight,
                outputFormat,
                audioFormat,
                audioMode,
                audioQuality,
                audioBitrate,
                wavBitDepth,
                startTime,
                endTime
              })
              const effective = advancedDirty ? advancedSettings : mirrored
              return (
                <AdvancedPanel
                  caps={ffmpegCaps}
                  loading={capsLoading}
                  error={capsError}
                  fileType={
                    activeItem?.file.type.startsWith('video/')
                      ? 'video'
                      : activeItem?.file.type.startsWith('audio/')
                        ? 'audio'
                        : activeItem?.file.type.startsWith('image/')
                          ? 'image'
                          : null
                  }
                  settings={effective}
                  onChange={handleAdvancedChange}
                  onReload={loadCaps}
                  dirty={advancedDirty}
                  onSyncFromSimple={() => {
                    setAdvancedDirty(false)
                    setAdvancedSettings(mirrored)
                    setActivePresetId(null)
                  }}
                  inputFileName={activeItem?.file.name}
                  onValidate={
                    activeItem
                      ? () => window.api.validateAdvanced(activeItem.file, effective)
                      : undefined
                  }
                  presets={presets}
                  onApplyPreset={handleApplyPreset}
                  onSavePreset={handleSavePreset}
                  onDeletePreset={handleDeletePreset}
                  onRenamePreset={handleRenamePreset}
                  activePresetId={activePresetId}
                />
              )
            })()
          ) : (
            <>
              <div>
                <label style={styles.label}>Action</label>
                <select
                  className="styled-select"
                  value={selectedTool}
                  onChange={(e) => setSelectedTool(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    width: '100%',
                    padding: '9px 10px',
                    backgroundColor: '#1a1a1a',
                    color: '#e0e0e0',
                    border: '1px solid #333',
                    borderRadius: '7px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 500
                  }}
                >
                  <option
                    value="compress"
                    disabled={
                      activeItem?.file.type.startsWith('image/') ||
                      activeItem?.file.type.startsWith('audio/')
                    }
                  >
                    Compress / Convert Video
                  </option>
                  <option
                    value="extract_audio"
                    disabled={activeItem?.file.type.startsWith('image/')}
                  >
                    Extract / Convert Audio
                  </option>
                  <option
                    value="trim_audio"
                    disabled={
                      activeItem?.file.type.startsWith('image/') ||
                      activeItem?.file.type.startsWith('video/')
                    }
                  >
                    Trim Audio
                  </option>
                  <option
                    value="remove_audio"
                    disabled={
                      activeItem?.file.type.startsWith('image/') ||
                      activeItem?.file.type.startsWith('audio/')
                    }
                  >
                    Remove Audio
                  </option>
                  <option
                    value="gif"
                    disabled={
                      activeItem?.file.type.startsWith('image/') ||
                      activeItem?.file.type.startsWith('audio/')
                    }
                  >
                    Convert to GIF (High Quality)
                  </option>
                  <option
                    value="trim"
                    disabled={
                      activeItem?.file.type.startsWith('image/') ||
                      activeItem?.file.type.startsWith('audio/')
                    }
                  >
                    Trim Video
                  </option>
                  <option
                    value="image_convert"
                    disabled={
                      activeItem?.file.type.startsWith('video/') ||
                      activeItem?.file.type.startsWith('audio/')
                    }
                  >
                    Convert Image (to PNG)
                  </option>
                </select>
              </div>

              <div
                style={{
                  padding: '14px',
                  backgroundColor: '#1a1a1a',
                  borderRadius: '10px',
                  minHeight: '100px',
                  border: '1px solid #252525'
                }}
              >
                {isAnalyzing ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100px',
                      gap: '10px'
                    }}
                  >
                    <div
                      style={{
                        width: '22px',
                        height: '22px',
                        border: '2px solid rgba(255,255,255,0.06)',
                        borderTop: '2px solid #3b82f6',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite'
                      }}
                    />
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#555' }}>Analyzing…</p>
                  </div>
                ) : selectedTool === 'compress' || selectedTool === 'trim' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedTool === 'trim' && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          paddingBottom: '12px',
                          borderBottom: '1px solid #333'
                        }}
                      >
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#aaa' }}>
                          Drag the handles on the preview timeline to set in/out points, or press
                          <b> I</b> / <b>O</b>.
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.7rem', color: '#888' }}>In</div>
                            <div
                              style={{
                                fontFamily: 'monospace',
                                fontSize: '0.95rem',
                                color: '#3b82f6',
                                padding: '6px 8px',
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #2a2a2a',
                                borderRadius: '4px'
                              }}
                            >
                              {startTime}
                            </div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.7rem', color: '#888' }}>Out</div>
                            <div
                              style={{
                                fontFamily: 'monospace',
                                fontSize: '0.95rem',
                                color: '#ef4444',
                                padding: '6px 8px',
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #2a2a2a',
                                borderRadius: '4px'
                              }}
                            >
                              {endTime}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div>
                      <label style={styles.label}>Codec</label>
                      <select
                        className="styled-select"
                        value={codec}
                        onChange={(e) => setCodec(e.target.value)}
                        style={styles.select}
                      >
                        <option value="libx264">H.264 (MP4/MKV)</option>
                        <option value="libx265">H.265 (HEVC)</option>
                        <option value="hevc_alpha">H.265 (HEVC with Alpha)</option>
                        <option value="libvpx-vp9">VP9 (WebM)</option>
                        <option value="vp9_alpha">VP9 (WebM with Alpha)</option>
                        <optgroup label="ProRes (Professional)">
                          <option value="prores-422">ProRes 422</option>
                          <option value="prores-hq">ProRes 422 HQ</option>
                          <option value="prores-lt">ProRes 422 LT</option>
                          <option value="prores-proxy">ProRes 422 Proxy</option>
                          <option value="prores-4444">ProRes 4444 (Alpha)</option>
                          <option value="prores-4444xq">ProRes 4444 XQ (Alpha)</option>
                        </optgroup>
                        <option value="hap">HAP</option>
                        <option value="hap_alpha">HAP Alpha</option>
                        <option value="copy">Copy (Direct)</option>
                      </select>
                    </div>

                    {/* Compression Method (Hidden for ProRes) */}
                    {!codec.toLowerCase().includes('prores') && !codec.toLowerCase().includes('hap') && codec !== 'copy' && (
                      <div>
                        <label style={styles.label}>Compression Method</label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button
                            className="mini-btn"
                            onClick={() => setCompressionMethod('crf')}
                            style={{
                              ...styles.miniButton,
                              backgroundColor: compressionMethod === 'crf' ? '#2563eb' : '#1e1e1e',
                              color: compressionMethod === 'crf' ? '#fff' : '#888',
                              borderColor: compressionMethod === 'crf' ? '#3b82f6' : '#2a2a2a'
                            }}
                          >
                            CRF (Quality)
                          </button>
                          <button
                            className="mini-btn"
                            onClick={() => setCompressionMethod('bitrate')}
                            style={{
                              ...styles.miniButton,
                              backgroundColor:
                                compressionMethod === 'bitrate' ? '#2563eb' : '#1e1e1e',
                              color: compressionMethod === 'bitrate' ? '#fff' : '#888',
                              borderColor: compressionMethod === 'bitrate' ? '#3b82f6' : '#2a2a2a'
                            }}
                          >
                            Bitrate
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Compression Value */}
                    {!codec.toLowerCase().includes('prores') && !codec.toLowerCase().includes('hap') && codec !== 'copy' && (
                      <div>
                        <label style={styles.label}>
                          {compressionMethod === 'crf'
                            ? 'Quality (CRF: 0-51)'
                            : 'Bitrate (e.g. 2M, 500k)'}
                        </label>
                        {compressionMethod === 'crf' ? (
                          <input
                            className="styled-input"
                            type="number"
                            value={crf}
                            onChange={(e) => setCrf(parseInt(e.target.value))}
                            style={styles.input}
                          />
                        ) : (
                          <input
                            className="styled-input"
                            type="text"
                            value={bitrate}
                            onChange={(e) => setBitrate(e.target.value)}
                            style={styles.input}
                          />
                        )}
                      </div>
                    )}

                    {/* Resize */}
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '4px'
                        }}
                      >
                        <label style={{ ...styles.label, marginBottom: 0 }}>
                          Resize (Width x Height)
                        </label>
                        <button
                          onClick={() => setKeepAspectRatio(!keepAspectRatio)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: keepAspectRatio ? '#3b82f6' : '#666',
                            cursor: 'pointer',
                            fontSize: '1.1rem'
                          }}
                          title="Link Aspect Ratio"
                        >
                          {keepAspectRatio ? '🔗' : '🔓'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                        <input
                          className="styled-input"
                          type="text"
                          placeholder="W"
                          value={resizeWidth}
                          onChange={(e) => handleWidthChange(e.target.value)}
                          style={styles.input}
                        />
                        <input
                          className="styled-input"
                          type="text"
                          placeholder="H"
                          value={resizeHeight}
                          onChange={(e) => handleHeightChange(e.target.value)}
                          style={styles.input}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          className="mini-btn"
                          onClick={() => handleScale(0.5)}
                          style={styles.miniButton}
                        >
                          ½
                        </button>
                        <button
                          className="mini-btn"
                          onClick={() => handleScale(0.333)}
                          style={styles.miniButton}
                        >
                          ⅓
                        </button>
                        <button
                          className="mini-btn"
                          onClick={() => handleScale(0.25)}
                          style={styles.miniButton}
                        >
                          ¼
                        </button>
                        <button
                          className="mini-btn"
                          onClick={() => {
                            if (originalWidth && originalHeight) {
                              setResizeWidth(originalWidth.toString())
                              setResizeHeight(originalHeight.toString())
                            }
                          }}
                          style={styles.miniButton}
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    {/* Output Format */}
                    <div>
                      <label style={styles.label}>Output Format</label>
                      <select
                        className="styled-select"
                        value={outputFormat}
                        onChange={(e) => setOutputFormat(e.target.value)}
                        style={styles.select}
                      >
                        <option value="mp4">MP4</option>
                        <option value="mkv">MKV (ProRes/H.264)</option>
                        <option value="mov">MOV (ProRes Native)</option>
                        <option value="avi">AVI</option>
                        <option value="webm">WebM</option>
                      </select>
                    </div>
                  </div>
                ) : selectedTool === 'gif' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#aaa' }}>
                      Drag the handles on the preview timeline to set the GIF in/out points, or
                      press
                      <b> I</b> / <b>O</b>. Leave the full clip selected to convert the whole video.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.7rem', color: '#888' }}>In</div>
                        <div
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.95rem',
                            color: '#3b82f6',
                            padding: '6px 8px',
                            backgroundColor: '#1e1e1e',
                            border: '1px solid #2a2a2a',
                            borderRadius: '4px'
                          }}
                        >
                          {startTime}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.7rem', color: '#888' }}>Out</div>
                        <div
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.95rem',
                            color: '#ef4444',
                            padding: '6px 8px',
                            backgroundColor: '#1e1e1e',
                            border: '1px solid #2a2a2a',
                            borderRadius: '4px'
                          }}
                        >
                          {endTime}
                        </div>
                      </div>
                    </div>
                    <p
                      style={{
                        color: '#888',
                        margin: '4px 0 0 0',
                        fontSize: '0.8rem',
                        textAlign: 'center'
                      }}
                    >
                      High-quality GIF conversion using <strong>Gifski</strong>.
                    </p>
                  </div>
                ) : selectedTool === 'extract_audio' || selectedTool === 'trim_audio' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedTool === 'trim_audio' && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          paddingBottom: '12px',
                          borderBottom: '1px solid #333'
                        }}
                      >
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#aaa' }}>
                          Drag the handles on the preview timeline to set in/out points, or press
                          <b> I</b> / <b>O</b>.
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.7rem', color: '#888' }}>In</div>
                            <div
                              style={{
                                fontFamily: 'monospace',
                                fontSize: '0.95rem',
                                color: '#3b82f6',
                                padding: '6px 8px',
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #2a2a2a',
                                borderRadius: '4px'
                              }}
                            >
                              {startTime}
                            </div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.7rem', color: '#888' }}>Out</div>
                            <div
                              style={{
                                fontFamily: 'monospace',
                                fontSize: '0.95rem',
                                color: '#ef4444',
                                padding: '6px 8px',
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #2a2a2a',
                                borderRadius: '4px'
                              }}
                            >
                              {endTime}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div>
                      <label style={styles.label}>Format</label>
                      <select
                        className="styled-select"
                        value={audioFormat}
                        onChange={(e) => {
                          const fmt = e.target.value as 'mp3' | 'wav' | 'aac' | 'm4a'
                          setAudioFormat(fmt)
                          if (fmt === 'wav') {
                            // wav has no quality knobs
                          } else if (fmt === 'mp3') {
                            setAudioMode('vbr')
                            setAudioQuality(2)
                          } else {
                            // aac / m4a: CBR only with native encoder
                            setAudioMode('cbr')
                            setAudioBitrate('192k')
                          }
                        }}
                        style={styles.select}
                      >
                        <option value="mp3">MP3 (libmp3lame)</option>
                        <option value="wav">WAV (PCM, lossless)</option>
                        <option value="aac">AAC (raw .aac)</option>
                        <option value="m4a">M4A (AAC in MP4)</option>
                      </select>
                    </div>

                    {audioFormat === 'wav' && (
                      <div>
                        <label style={styles.label}>Bit Depth</label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button
                            className="mini-btn"
                            onClick={() => setWavBitDepth('16')}
                            style={{
                              ...styles.miniButton,
                              backgroundColor: wavBitDepth === '16' ? '#2563eb' : '#1e1e1e',
                              color: wavBitDepth === '16' ? '#fff' : '#888',
                              borderColor: wavBitDepth === '16' ? '#3b82f6' : '#2a2a2a'
                            }}
                          >
                            16-bit
                          </button>
                          <button
                            className="mini-btn"
                            onClick={() => setWavBitDepth('24')}
                            style={{
                              ...styles.miniButton,
                              backgroundColor: wavBitDepth === '24' ? '#2563eb' : '#1e1e1e',
                              color: wavBitDepth === '24' ? '#fff' : '#888',
                              borderColor: wavBitDepth === '24' ? '#3b82f6' : '#2a2a2a'
                            }}
                          >
                            24-bit
                          </button>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#888', margin: '6px 0 0 0' }}>
                          WAV is lossless — no quality setting needed.
                        </p>
                      </div>
                    )}

                    {audioFormat === 'mp3' && (
                      <>
                        <div>
                          <label style={styles.label}>Mode</label>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                              className="mini-btn"
                              onClick={() => setAudioMode('vbr')}
                              style={{
                                ...styles.miniButton,
                                backgroundColor: audioMode === 'vbr' ? '#2563eb' : '#1e1e1e',
                                color: audioMode === 'vbr' ? '#fff' : '#888',
                                borderColor: audioMode === 'vbr' ? '#3b82f6' : '#2a2a2a'
                              }}
                            >
                              VBR (Quality)
                            </button>
                            <button
                              className="mini-btn"
                              onClick={() => setAudioMode('cbr')}
                              style={{
                                ...styles.miniButton,
                                backgroundColor: audioMode === 'cbr' ? '#2563eb' : '#1e1e1e',
                                color: audioMode === 'cbr' ? '#fff' : '#888',
                                borderColor: audioMode === 'cbr' ? '#3b82f6' : '#2a2a2a'
                              }}
                            >
                              CBR (Bitrate)
                            </button>
                          </div>
                        </div>
                        {audioMode === 'vbr' ? (
                          <div>
                            <label style={styles.label}>
                              Quality (V0 best – V9 worst): V{audioQuality}
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="9"
                              value={audioQuality}
                              onChange={(e) => setAudioQuality(parseInt(e.target.value))}
                              style={{ width: '100%' }}
                            />
                            <p style={{ fontSize: '0.7rem', color: '#888', margin: '4px 0 0 0' }}>
                              V0 ≈ 245 kbps · V2 ≈ 190 kbps · V4 ≈ 165 kbps
                            </p>
                          </div>
                        ) : (
                          <div>
                            <label style={styles.label}>Bitrate</label>
                            <select
                              className="styled-select"
                              value={audioBitrate}
                              onChange={(e) => setAudioBitrate(e.target.value)}
                              style={styles.select}
                            >
                              <option value="96k">96 kbps</option>
                              <option value="128k">128 kbps</option>
                              <option value="160k">160 kbps</option>
                              <option value="192k">192 kbps</option>
                              <option value="256k">256 kbps</option>
                              <option value="320k">320 kbps</option>
                            </select>
                          </div>
                        )}
                      </>
                    )}

                    {(audioFormat === 'aac' || audioFormat === 'm4a') && (
                      <div>
                        <label style={styles.label}>Bitrate</label>
                        <select
                          value={audioBitrate}
                          onChange={(e) => setAudioBitrate(e.target.value)}
                          style={styles.select}
                        >
                          <option value="96k">96 kbps</option>
                          <option value="128k">128 kbps</option>
                          <option value="160k">160 kbps</option>
                          <option value="192k">192 kbps</option>
                          <option value="256k">256 kbps</option>
                          <option value="320k">320 kbps</option>
                        </select>
                        <p style={{ fontSize: '0.7rem', color: '#888', margin: '4px 0 0 0' }}>
                          AAC at 128–192 kbps is comparable to MP3 at 192–256 kbps.
                        </p>
                      </div>
                    )}
                  </div>
                ) : selectedTool === 'image_convert' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <label style={styles.label}>Format</label>
                      <select
                        className="styled-select"
                        value={outputFormat}
                        onChange={(e) => setOutputFormat(e.target.value)}
                        style={styles.select}
                      >
                        <option value="png">PNG (Lossless)</option>
                        <option value="jpg">JPG (Lossy)</option>
                        <option value="webp">WebP (Modern)</option>
                        <option value="bmp">BMP (Bitmap)</option>
                        <option value="tga">TGA (Targa)</option>
                        <option value="tiff">TIFF (High Detail)</option>
                      </select>
                    </div>

                    {(outputFormat === 'jpg' || outputFormat === 'webp') && (
                      <div>
                        <label style={styles.label}>Quality (1-100)</label>
                        <input
                          type="range"
                          min="1"
                          max="100"
                          value={crf}
                          onChange={(e) => setCrf(parseInt(e.target.value))}
                          style={{ width: '100%' }}
                        />
                        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#888' }}>
                          {crf}%
                        </div>
                      </div>
                    )}

                    {/* Reuse Resize UI */}
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '4px'
                        }}
                      >
                        <label style={{ ...styles.label, marginBottom: 0 }}>
                          Resize (Width x Height)
                        </label>
                        <button
                          onClick={() => setKeepAspectRatio(!keepAspectRatio)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: keepAspectRatio ? '#3b82f6' : '#666',
                            cursor: 'pointer',
                            fontSize: '1.1rem'
                          }}
                          title="Link Aspect Ratio"
                        >
                          {keepAspectRatio ? '🔗' : '🔓'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                        <input
                          className="styled-input"
                          type="text"
                          placeholder="W"
                          value={resizeWidth}
                          onChange={(e) => handleWidthChange(e.target.value)}
                          style={styles.input}
                        />
                        <input
                          className="styled-input"
                          type="text"
                          placeholder="H"
                          value={resizeHeight}
                          onChange={(e) => handleHeightChange(e.target.value)}
                          style={styles.input}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          className="mini-btn"
                          onClick={() => handleScale(0.5)}
                          style={styles.miniButton}
                        >
                          ½
                        </button>
                        <button
                          className="mini-btn"
                          onClick={() => handleScale(0.333)}
                          style={styles.miniButton}
                        >
                          ⅓
                        </button>
                        <button
                          className="mini-btn"
                          onClick={() => handleScale(0.25)}
                          style={styles.miniButton}
                        >
                          ¼
                        </button>
                        <button
                          className="mini-btn"
                          onClick={() => {
                            if (originalWidth && originalHeight) {
                              setResizeWidth(originalWidth.toString())
                              setResizeHeight(originalHeight.toString())
                            }
                          }}
                          style={styles.miniButton}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: '#888', margin: 0, fontSize: '0.9rem', textAlign: 'center' }}>
                    Options for <strong>{selectedTool.replace('_', ' ')}</strong> will appear here.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Fixed bottom action bar */}
        <div
          style={{
            flexShrink: 0,
            padding: '14px 16px 16px',
            borderTop: '1px solid #222',
            backgroundColor: '#171717'
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              cursor: 'pointer',
              marginBottom: '12px',
              padding: '9px 10px',
              borderRadius: '8px',
              backgroundColor:
                replaceOriginal && !forcesExtensionChange ? 'rgba(239,68,68,0.06)' : 'transparent',
              border: `1px solid ${replaceOriginal && !forcesExtensionChange ? 'rgba(239,68,68,0.2)' : 'transparent'}`,
              transition: 'all 0.2s ease'
            }}
          >
            <input
              type="checkbox"
              checked={replaceOriginal && !forcesExtensionChange}
              onChange={(e) => setReplaceOriginal(e.target.checked)}
              disabled={isProcessing || forcesExtensionChange}
            />
            <span
              style={{
                fontSize: '0.82rem',
                color:
                  isProcessing || forcesExtensionChange
                    ? '#444'
                    : replaceOriginal
                      ? '#f87171'
                      : '#888',
                transition: 'color 0.2s',
                fontWeight: 500
              }}
            >
              Replace original file(s)
            </span>
          </label>

          {(() => {
            const activeCustomPath = activeItem?.customOutputPath
            return (
              <div
                style={{
                  marginBottom: '14px',
                  padding: '11px 12px',
                  backgroundColor: '#1a1a1a',
                  borderRadius: '8px',
                  border: '1px solid #252525'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px'
                  }}
                >
                  <label style={{ ...styles.label, marginBottom: 0 }}>
                    Output{' '}
                    {activeItem
                      ? `· ${activeItem.file.name.length > 22 ? activeItem.file.name.slice(0, 20) + '…' : activeItem.file.name}`
                      : ''}
                  </label>
                  {activeCustomPath && (
                    <button
                      className="mini-btn"
                      onClick={clearActiveCustomPath}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        padding: '1px 4px',
                        borderRadius: '4px'
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="mini-btn"
                    onClick={handleSelectSavePath}
                    disabled={isProcessing || activeIndex === null}
                    style={{
                      ...styles.miniButton,
                      backgroundColor: activeCustomPath ? '#1d4ed8' : 'rgba(59,130,246,0.1)',
                      color: activeCustomPath ? '#fff' : '#60a5fa',
                      borderColor: activeCustomPath ? '#3b82f6' : 'rgba(59,130,246,0.4)',
                      padding: '7px 11px',
                      flex: 'none',
                      fontSize: '0.78rem',
                      fontWeight: 600
                    }}
                  >
                    {activeCustomPath ? 'Custom' : 'Set Path'}
                  </button>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: activeCustomPath ? '#bbb' : '#444',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flex: 1
                    }}
                    title={
                      activeCustomPath ||
                      (activeItem ? 'Default: next to original' : 'Select an item first')
                    }
                  >
                    {activeCustomPath
                      ? activeCustomPath.split(/[\\/]/).pop()
                      : activeItem
                        ? 'Next to original'
                        : '—'}
                  </div>
                </div>
              </div>
            )
          })()}

          {isProcessing && (
            <div style={{ marginBottom: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.78rem',
                  color: '#666',
                  marginBottom: '6px'
                }}
              >
                <span style={{ color: '#888' }}>Processing…</span>
                <span style={{ fontWeight: 600, color: '#10b981' }}>{progress}%</span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '4px',
                  backgroundColor: '#1e1e1e',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}
              >
                <div
                  className="progress-shimmer"
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    borderRadius: '4px',
                    transition: 'width 0.25s ease-out'
                  }}
                />
              </div>
            </div>
          )}

          <button
            className={`btn-process${batchSelection.size > 0 && !isProcessing ? ' ready' : ''}`}
            onClick={handleProcessBatch}
            disabled={batchSelection.size === 0 || isProcessing}
            style={{
              width: '100%',
              padding: '13px',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '0.875rem',
              letterSpacing: '0.02em',
              cursor: batchSelection.size > 0 && !isProcessing ? 'pointer' : 'not-allowed',
              background:
                batchSelection.size > 0 && !isProcessing
                  ? advancedMode
                    ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                    : 'linear-gradient(135deg, #10b981, #059669)'
                  : '#1a1a1a',
              color: batchSelection.size > 0 && !isProcessing ? '#fff' : '#444',
              boxShadow: 'none'
            }}
          >
            {isProcessing
              ? 'Working…'
              : batchSelection.size === 0
                ? 'Select files to process'
                : `${advancedMode ? 'Run' : 'Process'} ${batchSelection.size} File${batchSelection.size > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App

const styles = {
  label: {
    display: 'block' as const,
    fontSize: '0.72rem',
    color: '#666',
    marginBottom: '5px',
    fontWeight: 500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const
  },
  select: {
    width: '100%',
    padding: '8px 10px',
    backgroundColor: '#1a1a1a',
    color: '#e0e0e0',
    border: '1px solid #2d2d2d',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem'
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    backgroundColor: '#1a1a1a',
    color: '#e0e0e0',
    border: '1px solid #2d2d2d',
    borderRadius: '6px',
    fontSize: '0.875rem',
    boxSizing: 'border-box' as const
  },
  miniButton: {
    flex: 1,
    padding: '6px 4px',
    backgroundColor: '#1e1e1e',
    color: '#888',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 'bold' as const,
    transition: 'all 0.15s ease'
  }
}
