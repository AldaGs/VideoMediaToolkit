import React, { useEffect, useMemo, useState } from 'react'
import type { FFmpegCaps, EncoderInfo, Preset } from '../env'
import { Combobox, ComboboxGroup } from './Combobox'

export interface AdvancedSettings {
  videoCodec: string
  audioCodec: string
  videoFilters: string
  audioFilters: string
  extraArgs: string
  container: string
  outputExt: string
}

export const defaultAdvancedSettings: AdvancedSettings = {
  videoCodec: 'libx264',
  audioCodec: 'aac',
  videoFilters: '',
  audioFilters: '',
  extraArgs: '',
  container: 'mp4',
  outputExt: 'mp4'
}

export interface SimpleStateSnapshot {
  selectedTool: string
  codec: string
  compressionMethod: 'crf' | 'bitrate'
  crf: number
  bitrate: string
  resizeWidth: string
  resizeHeight: string
  outputFormat: string
  audioFormat: 'mp3' | 'wav' | 'aac' | 'm4a'
  audioMode: 'vbr' | 'cbr'
  audioQuality: number
  audioBitrate: string
  wavBitDepth: '16' | '24'
  startTime: string
  endTime: string
}

// Token-aware split that respects single/double quotes — same shape as main.
function tokenizeArgs(s: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let inS = false
  let inD = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inS) {
      if (c === "'") inS = false
      else cur += c
    } else if (inD) {
      if (c === '"') inD = false
      else if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i++ }
      else cur += c
    } else if (c === "'") inS = true
    else if (c === '"') inD = true
    else if (/\s/.test(c)) { if (cur) { tokens.push(cur); cur = '' } }
    else cur += c
  }
  if (cur) tokens.push(cur)
  return tokens
}

// Build the same args list main will execute, using placeholders for I/O.
export function buildPreviewArgs(
  inputName: string,
  outputName: string,
  adv: AdvancedSettings
): string[] {
  const args: string[] = ['-hide_banner', '-y', '-i', inputName]
  if (adv.videoCodec) args.push('-c:v', adv.videoCodec)
  if (adv.audioCodec) args.push('-c:a', adv.audioCodec)
  if (adv.videoFilters) args.push('-vf', adv.videoFilters)
  if (adv.audioFilters) args.push('-af', adv.audioFilters)
  args.push(...tokenizeArgs(adv.extraArgs))
  if (adv.container) args.push('-f', adv.container)
  args.push(outputName)
  return args
}

// Quote args that contain whitespace for human-readable display only.
export function formatCommand(args: string[]): string {
  return args
    .map((a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(' ')
}

// Translate the Simple-mode form state into a best-effort AdvancedSettings.
// Used to keep Advanced "mirroring" Simple until the user explicitly edits Advanced.
export function simpleToAdvanced(s: SimpleStateSnapshot): AdvancedSettings {
  const result: AdvancedSettings = { ...defaultAdvancedSettings }
  const extra: string[] = []

  const codecMap: Record<string, string> = {
    libx264: 'libx264',
    libx265: 'libx265',
    hevc_alpha: 'libx265',
    'libvpx-vp9': 'libvpx-vp9',
    vp9_alpha: 'libvpx-vp9',
    'prores-422': 'prores_ks',
    'prores-hq': 'prores_ks',
    'prores-lt': 'prores_ks',
    'prores-proxy': 'prores_ks',
    'prores-4444': 'prores_ks',
    'prores-4444xq': 'prores_ks',
    hap: 'hap',
    hap_alpha: 'hap',
    copy: 'copy'
  }
  const proresProfile: Record<string, string> = {
    'prores-proxy': '0',
    'prores-lt': '1',
    'prores-422': '2',
    'prores-hq': '3',
    'prores-4444': '4',
    'prores-4444xq': '5'
  }

  if (s.selectedTool === 'compress' || s.selectedTool === 'trim') {
    result.videoCodec = codecMap[s.codec] || 'libx264'
    result.audioCodec = s.codec === 'copy' ? 'copy' : 'aac'

    if (proresProfile[s.codec]) extra.push(`-profile:v ${proresProfile[s.codec]}`)
    if (s.codec === 'hap_alpha') extra.push('-format hap_alpha')

    if (!s.codec.startsWith('prores') && s.codec !== 'hap' && s.codec !== 'hap_alpha' && s.codec !== 'copy') {
      if (s.compressionMethod === 'crf') extra.push(`-crf ${s.crf}`)
      else extra.push(`-b:v ${s.bitrate}`)
    }

    if (s.resizeWidth && s.resizeHeight) {
      result.videoFilters = `scale=${s.resizeWidth}:${s.resizeHeight}`
    }
    if (s.selectedTool === 'trim') {
      extra.unshift(`-ss ${s.startTime}`, `-to ${s.endTime}`)
    }
    result.container = s.outputFormat
    result.outputExt = s.outputFormat
  } else if (s.selectedTool === 'extract_audio' || s.selectedTool === 'trim_audio') {
    const audioCodecMap: Record<string, string> = {
      mp3: 'libmp3lame',
      wav: s.wavBitDepth === '24' ? 'pcm_s24le' : 'pcm_s16le',
      aac: 'aac',
      m4a: 'aac'
    }
    result.audioCodec = audioCodecMap[s.audioFormat] || 'aac'
    result.videoCodec = 'copy'

    extra.push('-vn')

    if (s.audioFormat === 'mp3' && s.audioMode === 'vbr') {
      extra.push(`-q:a ${s.audioQuality}`)
    } else if (s.audioFormat !== 'wav') {
      extra.push(`-b:a ${s.audioBitrate}`)
    }

    if (s.selectedTool === 'trim_audio') {
      extra.unshift(`-ss ${s.startTime}`, `-to ${s.endTime}`)
    }

    const containerMap: Record<string, string> = {
      mp3: 'mp3',
      wav: 'wav',
      aac: 'adts',
      m4a: 'mp4'
    }
    result.container = containerMap[s.audioFormat] || s.audioFormat
    result.outputExt = s.audioFormat
  } else if (s.selectedTool === 'remove_audio') {
    result.videoCodec = 'copy'
    result.audioCodec = 'copy'
    extra.push('-an')
    result.container = s.outputFormat
    result.outputExt = s.outputFormat
  } else if (s.selectedTool === 'gif') {
    result.videoCodec = 'gif'
    result.audioCodec = 'copy'
    extra.unshift(`-ss ${s.startTime}`, `-to ${s.endTime}`)
    if (s.resizeWidth && s.resizeHeight) {
      result.videoFilters = `scale=${s.resizeWidth}:${s.resizeHeight}:flags=lanczos`
    }
    result.container = 'gif'
    result.outputExt = 'gif'
  } else if (s.selectedTool === 'image_convert') {
    const imgEncMap: Record<string, string> = {
      png: 'png',
      jpg: 'mjpeg',
      jpeg: 'mjpeg',
      webp: 'libwebp',
      bmp: 'bmp',
      tga: 'targa',
      tiff: 'tiff'
    }
    result.videoCodec = imgEncMap[s.outputFormat] || 'png'
    result.audioCodec = 'copy'
    extra.push('-frames:v 1')
    if (s.outputFormat === 'jpg' || s.outputFormat === 'jpeg') {
      extra.push(`-q:v ${Math.round((100 - s.crf) / 100 * 31) + 1}`)
    } else if (s.outputFormat === 'webp') {
      extra.push(`-quality ${s.crf}`)
    }
    if (s.resizeWidth && s.resizeHeight) {
      result.videoFilters = `scale=${s.resizeWidth}:${s.resizeHeight}`
    }
    result.container = 'image2'
    result.outputExt = s.outputFormat
  }

  result.extraArgs = extra.join(' ')
  return result
}

// Curated "Common" lists — the encoders most users actually reach for.
const COMMON_VIDEO = ['libx264', 'libx265', 'libvpx-vp9', 'libvpx', 'libaom-av1', 'prores_ks', 'mjpeg', 'gif', 'copy']
const COMMON_AUDIO = ['aac', 'libmp3lame', 'libopus', 'libvorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'ac3', 'copy']
const COMMON_CONTAINERS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'mp3', 'm4a', 'wav', 'ogg', 'flac', 'gif']

function categorize(
  encoders: EncoderInfo[],
  type: 'video' | 'audio',
  commonList: string[]
): { common: EncoderInfo[]; hardware: EncoderInfo[]; other: EncoderInfo[] } {
  const filtered = encoders.filter((e) => e.type === type)
  const byName = new Map(filtered.map((e) => [e.name, e]))
  const common: EncoderInfo[] = []
  for (const name of commonList) {
    const e = byName.get(name)
    if (e) common.push(e)
    else if (name === 'copy') common.push({ name: 'copy', description: 'Stream copy (no re-encode)', type, isHardware: false })
  }
  const hardware = filtered.filter((e) => e.isHardware && !commonList.includes(e.name))
  const usedNames = new Set([...common.map((e) => e.name), ...hardware.map((e) => e.name)])
  const other = filtered.filter((e) => !usedNames.has(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  return { common, hardware, other }
}

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
    fontSize: '0.82rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    boxSizing: 'border-box' as const
  }
}

export function AdvancedPanel({
  caps,
  loading,
  error,
  fileType, // 'video' | 'audio' | 'image' | null
  settings,
  onChange,
  onReload,
  dirty,
  onSyncFromSimple,
  inputFileName,
  onValidate,
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  activePresetId
}: {
  caps: FFmpegCaps | null
  loading: boolean
  error: string | null
  fileType: 'video' | 'audio' | 'image' | null
  settings: AdvancedSettings
  onChange: (s: AdvancedSettings) => void
  onReload: () => void
  dirty: boolean
  onSyncFromSimple: () => void
  inputFileName?: string
  onValidate?: () => Promise<{ ok: true; command: string } | { ok: false; message: string; command: string }>
  presets: Preset[]
  onApplyPreset: (preset: Preset) => void
  onSavePreset: (name: string, overwriteId?: string) => Promise<void>
  onDeletePreset: (id: string) => Promise<void>
  onRenamePreset: (id: string, newName: string) => Promise<void>
  activePresetId: string | null
}): React.JSX.Element {
  const [saveModal, setSaveModal] = useState<{ open: boolean; defaultName?: string; renameId?: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Preset | null>(null)
  const [validateState, setValidateState] = useState<
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'ok'; command: string }
    | { status: 'error'; message: string; command: string }
  >({ status: 'idle' })

  // Reset validation state whenever settings change
  React.useEffect(() => {
    if (validateState.status !== 'idle') setValidateState({ status: 'idle' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.videoCodec, settings.audioCodec, settings.videoFilters, settings.audioFilters, settings.extraArgs, settings.container])

  const runValidate = async (): Promise<void> => {
    if (!onValidate) return
    setValidateState({ status: 'running' })
    try {
      const r = await onValidate()
      if (r.ok) setValidateState({ status: 'ok', command: r.command })
      else setValidateState({ status: 'error', message: r.message, command: r.command })
    } catch (err) {
      setValidateState({ status: 'error', message: err instanceof Error ? err.message : String(err), command: '' })
    }
  }
  const videoCats = useMemo(
    () => (caps ? categorize(caps.encoders, 'video', COMMON_VIDEO) : { common: [], hardware: [], other: [] }),
    [caps]
  )
  const audioCats = useMemo(
    () => (caps ? categorize(caps.encoders, 'audio', COMMON_AUDIO) : { common: [], hardware: [], other: [] }),
    [caps]
  )
  const muxFormats = useMemo(
    () => (caps ? caps.formats.filter((f) => f.canMux).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [caps]
  )

  // Convert categorized encoder lists into Combobox groups
  const catsToGroups = (cats: {
    common: EncoderInfo[]
    hardware: EncoderInfo[]
    other: EncoderInfo[]
  }): ComboboxGroup[] => {
    const groups: ComboboxGroup[] = []
    if (cats.common.length) {
      groups.push({
        label: 'Common',
        items: cats.common.map((e) => ({ value: e.name, label: e.name, description: e.description }))
      })
    }
    if (cats.hardware.length) {
      groups.push({
        label: `Hardware (${cats.hardware.length})`,
        items: cats.hardware.map((e) => ({ value: e.name, label: e.name, description: e.description }))
      })
    }
    if (cats.other.length) {
      groups.push({
        label: `All (${cats.other.length})`,
        items: cats.other.map((e) => ({ value: e.name, label: e.name, description: e.description }))
      })
    }
    return groups
  }

  const containerGroups: ComboboxGroup[] = useMemo(() => {
    if (!caps) return []
    const muxByName = new Map(muxFormats.map((f) => [f.name, f]))
    const groups: ComboboxGroup[] = []
    const commonItems = COMMON_CONTAINERS.filter((c) => muxByName.has(c) || true).map((c) => ({
      value: c,
      label: c,
      description: muxByName.get(c)?.description
    }))
    if (commonItems.length) groups.push({ label: 'Common', items: commonItems })
    const otherItems = muxFormats
      .filter((f) => !COMMON_CONTAINERS.includes(f.name))
      .map((f) => ({ value: f.name, label: f.name, description: f.description }))
    if (otherItems.length) groups.push({ label: `All (${otherItems.length})`, items: otherItems })
    return groups
  }, [caps, muxFormats])

  const update = (patch: Partial<AdvancedSettings>): void => onChange({ ...settings, ...patch })

  if (loading) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: '#666' }}>
        <div style={{ width: '22px', height: '22px', border: '2px solid rgba(255,255,255,0.06)', borderTop: '2px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
        <p style={{ margin: 0, fontSize: '0.78rem' }}>Loading FFmpeg capabilities…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center' }}>
        <p style={{ color: '#f87171', fontSize: '0.82rem', margin: '0 0 10px' }}>Failed to load encoders</p>
        <p style={{ color: '#666', fontSize: '0.72rem', margin: '0 0 14px', wordBreak: 'break-word' }}>{error}</p>
        <button className="mini-btn" onClick={onReload} style={{ padding: '6px 14px', backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#ccc', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    )
  }

  if (!caps) return <div />

  const showVideo = fileType === 'video' || fileType === null
  const showAudio = fileType === 'video' || fileType === 'audio' || fileType === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Header strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', backgroundColor: '#1a1a1a', border: '1px solid #252525', borderRadius: '8px' }}>
        <span style={{ fontSize: '0.7rem', color: '#666', fontFamily: 'monospace' }}>
          ffmpeg <span style={{ color: '#bbb' }}>{caps.version}</span>
        </span>
        <span style={{ fontSize: '0.68rem', color: '#444' }}>
          {caps.encoders.length} enc · {caps.formats.filter((f) => f.canMux).length} mux
        </span>
      </div>

      {/* Presets bar */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
          <label style={{ ...styles.label, marginBottom: 0 }}>Preset</label>
          <button
            onClick={() => setSaveModal({ open: true, defaultName: '' })}
            style={{
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.4)',
              color: '#60a5fa', fontSize: '0.7rem', cursor: 'pointer',
              padding: '3px 9px', borderRadius: '5px', fontFamily: 'inherit',
              fontWeight: 600, transition: 'all 0.15s ease',
              display: 'inline-flex', alignItems: 'center', gap: '4px'
            }}
            title="Save current Advanced settings as a preset"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Save Preset
          </button>
        </div>
        <Combobox
          value={activePresetId || (dirty ? 'custom' : '')}
          onChange={(id) => {
            if (id === 'custom') return // Already in custom state
            const p = presets.find((x) => x.id === id)
            if (p) onApplyPreset(p)
          }}
          groups={[
            ...(dirty && !activePresetId
              ? [
                  {
                    label: 'Current',
                    items: [{ value: 'custom', label: '— Custom —', description: 'Modified settings' }]
                  }
                ]
              : []),
            ...(presets.length
              ? [
                  {
                    label: `Saved (${presets.length})`,
                    items: presets.map((p) => ({
                      value: p.id,
                      label: p.name,
                      description: `${p.settings.videoCodec} · ${p.settings.audioCodec} · ${p.settings.outputExt}`
                    }))
                  }
                ]
              : [])
          ]}
          placeholder={presets.length ? 'Apply a preset…' : 'No presets saved yet'}
          searchPlaceholder={`Search ${presets.length} preset${presets.length !== 1 ? 's' : ''}…`}
          disabled={presets.length === 0 && !dirty}
          onDeleteItem={(id) => {
            const p = presets.find((x) => x.id === id)
            if (p) setDeleteConfirm(p)
          }}
        />
        {presets.length > 0 && (
          <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {presets.map((p) => (
              <span
                key={p.id}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  fontSize: '0.68rem', padding: '2px 8px',
                  backgroundColor: p.id === activePresetId ? 'rgba(59,130,246,0.12)' : '#1a1a1a',
                  border: `1px solid ${p.id === activePresetId ? 'rgba(59,130,246,0.4)' : '#252525'}`,
                  borderRadius: '10px',
                  color: p.id === activePresetId ? '#60a5fa' : '#888'
                }}
              >
                <button
                  onClick={() => onApplyPreset(p)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 'inherit', fontFamily: 'inherit' }}
                >
                  {p.name}
                </button>
                {p.id === activePresetId && (
                  <button
                    onClick={() => setSaveModal({ open: true, defaultName: p.name, renameId: p.id })}
                    title="Rename preset"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: '0 2px', fontSize: '0.7rem', lineHeight: 1 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#3b82f6' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#666' }}
                  >
                    ✎
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sync state strip */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px', borderRadius: '8px',
          backgroundColor: dirty ? 'rgba(245,158,11,0.07)' : 'rgba(16,185,129,0.06)',
          border: `1px solid ${dirty ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.2)'}`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            backgroundColor: dirty ? '#f59e0b' : '#10b981',
            display: 'inline-block', flexShrink: 0
          }} />
          <span style={{ fontSize: '0.72rem', color: dirty ? '#fbbf24' : '#34d399', fontWeight: 500 }}>
            {dirty ? 'Custom (overrides Simple)' : 'Mirroring Simple settings'}
          </span>
        </div>
        {dirty && (
          <button
            onClick={onSyncFromSimple}
            style={{
              background: 'none', border: '1px solid rgba(245,158,11,0.3)',
              color: '#fbbf24', fontSize: '0.7rem', cursor: 'pointer',
              padding: '3px 8px', borderRadius: '5px', fontFamily: 'inherit',
              fontWeight: 500, transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            title="Discard changes and re-sync from Simple settings"
          >
            Sync from Simple
          </button>
        )}
      </div>

      {/* Video codec */}
      {showVideo && (
        <div>
          <label style={styles.label}>Video Codec</label>
          <Combobox
            value={settings.videoCodec}
            onChange={(v) => update({ videoCodec: v })}
            groups={catsToGroups(videoCats)}
            placeholder="Select video codec…"
            searchPlaceholder={`Search ${videoCats.common.length + videoCats.hardware.length + videoCats.other.length} video codecs…`}
          />
        </div>
      )}

      {/* Audio codec */}
      {showAudio && (
        <div>
          <label style={styles.label}>Audio Codec</label>
          <Combobox
            value={settings.audioCodec}
            onChange={(v) => update({ audioCodec: v })}
            groups={catsToGroups(audioCats)}
            placeholder="Select audio codec…"
            searchPlaceholder={`Search ${audioCats.common.length + audioCats.hardware.length + audioCats.other.length} audio codecs…`}
          />
        </div>
      )}

      {/* Filters */}
      {showVideo && (
        <div>
          <label style={styles.label}>Video Filters (-vf)</label>
          <input
            className="styled-input"
            type="text"
            placeholder="e.g. scale=1280:-2,fps=30"
            value={settings.videoFilters}
            onChange={(e) => update({ videoFilters: e.target.value })}
            style={styles.input}
          />
        </div>
      )}

      {showAudio && (
        <div>
          <label style={styles.label}>Audio Filters (-af)</label>
          <input
            className="styled-input"
            type="text"
            placeholder="e.g. loudnorm,aresample=48000"
            value={settings.audioFilters}
            onChange={(e) => update({ audioFilters: e.target.value })}
            style={styles.input}
          />
        </div>
      )}

      {/* Extra args */}
      <div>
        <label style={styles.label}>Extra Arguments</label>
        <input
          className="styled-input"
          type="text"
          placeholder="e.g. -tune film -movflags +faststart"
          value={settings.extraArgs}
          onChange={(e) => update({ extraArgs: e.target.value })}
          style={styles.input}
        />
        <p style={{ fontSize: '0.68rem', color: '#444', margin: '4px 0 0 0' }}>
          Inserted before output. Don't include <code style={{ color: '#666' }}>-i</code> or output path.
        </p>
      </div>

      {/* Container / output extension */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          <label style={styles.label}>Container (-f)</label>
          <Combobox
            value={settings.container}
            onChange={(v) => update({ container: v, outputExt: v })}
            groups={containerGroups}
            placeholder="Select container…"
            searchPlaceholder={`Search ${muxFormats.length} containers…`}
          />
        </div>
        <div style={{ width: '90px' }}>
          <label style={styles.label}>Ext</label>
          <input
            className="styled-input"
            type="text"
            value={settings.outputExt}
            onChange={(e) => update({ outputExt: e.target.value.replace(/^\.+/, '') })}
            style={styles.input}
          />
        </div>
      </div>

      {/* Resolved Command preview */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
          <label style={{ ...styles.label, marginBottom: 0 }}>Resolved Command</label>
          {onValidate && (
            <button
              onClick={runValidate}
              disabled={validateState.status === 'running'}
              style={{
                background: validateState.status === 'running' ? '#1a1a1a' : 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.4)',
                color: '#60a5fa', fontSize: '0.7rem', cursor: validateState.status === 'running' ? 'wait' : 'pointer',
                padding: '3px 10px', borderRadius: '5px', fontFamily: 'inherit',
                fontWeight: 600, transition: 'all 0.15s ease'
              }}
            >
              {validateState.status === 'running' ? 'Validating…' : 'Validate'}
            </button>
          )}
        </div>
        <pre
          style={{
            margin: 0, padding: '10px 12px',
            backgroundColor: '#0d0d0d', border: '1px solid #222',
            borderRadius: '8px', color: '#bbb',
            fontSize: '0.72rem', lineHeight: 1.55,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const,
            maxHeight: '120px', overflowY: 'auto' as const
          }}
        >
          <span style={{ color: '#666' }}>ffmpeg </span>
          {formatCommand(
            buildPreviewArgs(inputFileName || '<input>', `<output>.${settings.outputExt || 'mp4'}`, settings)
              .slice(1) // strip the leading 'ffmpeg' since we already render it muted
          )}
        </pre>

        {/* Validation result */}
        {validateState.status === 'ok' && (
          <div style={{ marginTop: '8px', padding: '8px 12px', backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 500 }}>Validated · 0.5s dry-run succeeded</span>
          </div>
        )}
        {validateState.status === 'error' && (
          <div style={{ marginTop: '8px', padding: '10px 12px', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: '0.75rem', color: '#f87171', fontWeight: 600 }}>Validation failed</span>
            </div>
            <pre style={{ margin: 0, fontSize: '0.7rem', color: '#999', fontFamily: 'monospace', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, lineHeight: 1.5 }}>
              {validateState.message}
            </pre>
          </div>
        )}
      </div>

      {/* Save preset modal */}
      {saveModal?.open && (
        <SavePresetModal
          existingPresets={presets}
          defaultName={saveModal.defaultName || ''}
          onCancel={() => setSaveModal(null)}
          onSave={async (name, overwriteId) => {
            await onSavePreset(name, overwriteId)
            setSaveModal(null)
          }}
          onRename={onRenamePreset}
          renameId={saveModal.renameId}
        />
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <ConfirmModal
          title="Delete preset?"
          message={`"${deleteConfirm.name}" will be removed permanently.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={async () => {
            await onDeletePreset(deleteConfirm.id)
            setDeleteConfirm(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Save Preset Modal ─────────────────────────────────────────────
function SavePresetModal({
  existingPresets,
  defaultName,
  onCancel,
  onSave
}: {
  existingPresets: Preset[]
  defaultName: string
  onCancel: () => void
  onSave: (name: string, overwriteId?: string) => Promise<void>
  onRename?: (id: string, name: string) => Promise<void>
  renameId?: string
}): React.JSX.Element {
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const trimmed = name.trim()
  const conflict = existingPresets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())

  const handleSubmit = async (overwriteId?: string): Promise<void> => {
    if (!trimmed) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (renameId && onRename) {
        await onRename(renameId, trimmed)
      } else {
        await onSave(trimmed, overwriteId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.18s ease'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="done-card"
        style={{
          width: '100%', maxWidth: '420px',
          background: 'linear-gradient(145deg, #181818, #1c1c1c)',
          border: '1px solid #2a2a2a', borderRadius: '14px',
          padding: '22px', color: '#e0e0e0'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
            {renameId ? 'Rename Preset' : 'Save Preset'}
          </h3>
        </div>

        <label style={{ display: 'block', fontSize: '0.72rem', color: '#666', marginBottom: '5px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>
          Name
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !conflict) handleSubmit() }}
          placeholder="e.g. 4K → Twitter"
          maxLength={80}
          style={{
            width: '100%', padding: '9px 11px',
            backgroundColor: '#0d0d0d', color: '#e0e0e0',
            border: `1px solid ${error ? '#ef4444' : '#2a2a2a'}`,
            borderRadius: '7px', fontSize: '0.875rem',
            fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none'
          }}
        />
        {error && (
          <p style={{ margin: '6px 2px 0', fontSize: '0.72rem', color: '#f87171' }}>{error}</p>
        )}
        {conflict && !error && (
          <p style={{ margin: '6px 2px 0', fontSize: '0.72rem', color: '#fbbf24' }}>
            A preset named "{conflict.name}" already exists.
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' }}>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: '7px 14px', borderRadius: '7px',
              backgroundColor: 'transparent', border: '1px solid #2a2a2a',
              color: '#888', fontSize: '0.8rem', cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'inherit'
            }}
          >
            Cancel
          </button>
          {conflict ? (
            <button
              onClick={() => handleSubmit(conflict.id)}
              disabled={saving || !trimmed}
              style={{
                padding: '7px 14px', borderRadius: '7px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                border: 'none', color: '#fff',
                fontSize: '0.8rem', fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
                fontFamily: 'inherit'
              }}
            >
              {saving ? 'Saving…' : 'Overwrite'}
            </button>
          ) : renameId ? (
            <button
              onClick={() => handleSubmit()}
              disabled={saving || !trimmed || trimmed === defaultName}
              style={{
                padding: '7px 14px', borderRadius: '7px',
                background: (trimmed && trimmed !== defaultName) ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#1a1a1a',
                border: 'none', color: (trimmed && trimmed !== defaultName) ? '#fff' : '#444',
                fontSize: '0.8rem', fontWeight: 600,
                cursor: saving ? 'wait' : ((trimmed && trimmed !== defaultName) ? 'pointer' : 'not-allowed'),
                fontFamily: 'inherit'
              }}
            >
              {saving ? 'Saving…' : 'Rename'}
            </button>
          ) : (
            <button
              onClick={() => handleSubmit()}
              disabled={saving || !trimmed}
              style={{
                padding: '7px 14px', borderRadius: '7px',
                background: trimmed ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#1a1a1a',
                border: 'none', color: trimmed ? '#fff' : '#444',
                fontSize: '0.8rem', fontWeight: 600,
                cursor: saving ? 'wait' : (trimmed ? 'pointer' : 'not-allowed'),
                fontFamily: 'inherit'
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Generic Confirm Modal ─────────────────────────────────────────
function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}): React.JSX.Element {
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.18s ease'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="done-card"
        style={{
          width: '100%', maxWidth: '380px',
          background: 'linear-gradient(145deg, #181818, #1c1c1c)',
          border: '1px solid #2a2a2a', borderRadius: '14px',
          padding: '22px', color: '#e0e0e0'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{title}</h3>
        <p style={{ margin: '8px 0 18px 0', fontSize: '0.82rem', color: '#888', lineHeight: 1.55 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={working}
            style={{
              padding: '7px 14px', borderRadius: '7px',
              backgroundColor: 'transparent', border: '1px solid #2a2a2a',
              color: '#888', fontSize: '0.8rem', cursor: working ? 'wait' : 'pointer',
              fontFamily: 'inherit'
            }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setWorking(true)
              try { await onConfirm() } finally { setWorking(false) }
            }}
            disabled={working}
            style={{
              padding: '7px 14px', borderRadius: '7px',
              background: danger
                ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                : 'linear-gradient(135deg, #3b82f6, #2563eb)',
              border: 'none', color: '#fff',
              fontSize: '0.8rem', fontWeight: 600,
              cursor: working ? 'wait' : 'pointer',
              fontFamily: 'inherit'
            }}
          >
            {working ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
