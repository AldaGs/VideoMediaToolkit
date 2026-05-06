import type { AdvancedSettingsPayload } from '../env'

export type AdvancedSettings = AdvancedSettingsPayload

export const defaultAdvancedSettings: AdvancedSettings = {
  videoCodec: 'libx264',
  audioCodec: 'aac',
  videoFilters: '',
  audioFilters: '',
  extraArgs: '-crf 23 -preset medium',
  container: 'mp4',
  outputExt: 'mp4'
}

export function tokenizeArgs(s: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'") {
      if (inQuotes === c) inQuotes = null
      else if (!inQuotes) inQuotes = c
      else current += c
    } else if (c === ' ' && !inQuotes) {
      if (current) result.push(current)
      current = ''
    } else {
      current += c
    }
  }
  if (current) result.push(current)
  return result
}

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

export function formatCommand(args: string[]): string {
  return args.map((a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')
}

export interface SimpleStateSnapshot {
  selectedTool: string
  outputFormat: string
  codec: string
  compressionMethod: 'crf' | 'bitrate'
  crf: number
  bitrate: string
  resizeWidth: string
  resizeHeight: string
  audioFormat: string
  audioMode: 'vbr' | 'cbr'
  audioQuality: number
  audioBitrate: string
  wavBitDepth: '16' | '24'
  startTime: string
  endTime: string
}

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
    hap_alpha: 'hap_alpha',
    'png-alpha': 'png'
  }

  result.videoCodec = codecMap[s.codec] || 'libx264'

  if (s.selectedTool === 'extract_audio') {
    result.videoCodec = ''
    result.videoFilters = ''
  }

  const isLosslessOrMezzanine =
    s.codec.startsWith('prores') || s.codec.startsWith('hap') || s.codec === 'copy'

  if (!isLosslessOrMezzanine) {
    if (s.compressionMethod === 'crf') {
      extra.push('-crf', s.crf.toString())
    } else {
      extra.push('-b:v', s.bitrate)
    }
  }

  if (s.resizeWidth || s.resizeHeight) {
    const w = s.resizeWidth || '-1'
    const h = s.resizeHeight || '-1'
    result.videoFilters = `scale=${w}:${h}`
  }

  const audioMap: Record<string, string> = {
    mp3: 'libmp3lame',
    wav: 'pcm_s16le',
    aac: 'aac',
    m4a: 'aac'
  }
  result.audioCodec = audioMap[s.audioFormat] || 'aac'

  if (s.audioFormat === 'mp3') {
    if (s.audioMode === 'vbr') extra.push('-q:a', s.audioQuality.toString())
    else extra.push('-b:a', s.audioBitrate)
  } else if (s.audioFormat === 'wav') {
    result.audioCodec = s.wavBitDepth === '24' ? 'pcm_s24le' : 'pcm_s16le'
  }

  result.extraArgs = extra.join(' ')
  result.outputExt = s.outputFormat
  result.container = s.outputFormat

  return result
}
