export interface MediaSettings {
  startTime?: string
  endTime?: string
  codec?: string
  crf?: number
  bitrate?: string
  width?: number
  height?: number
  format?: string
  compressionMethod?: 'crf' | 'bitrate'
  audioFormat?: 'mp3' | 'wav' | 'aac' | 'm4a'
  audioMode?: 'vbr' | 'cbr'
  audioQuality?: number
  audioBitrate?: string
  wavBitDepth?: '16' | '24'
  [key: string]: string | number | boolean | undefined
}

export interface IElectronAPI {
  processMedia: (
    file: File,
    action: string,
    replaceOriginal: boolean,
    settings?: MediaSettings
  ) => Promise<string>
  saveFrame: (file: File, time: number, customPath?: string) => Promise<string>
  getMetadata: (file: File) => Promise<{ width: number; height: number; duration: number }>
  convertImage: (file: File, settings?: MediaSettings) => Promise<string>
  onProgress: (callback: (log: string) => void) => void
  removeListeners: () => void
  showInFolder: (filePath: string) => Promise<void>
  exportFile: (
    sourcePath: string
  ) => Promise<{ canceled: true } | { canceled: false; filePath: string }>
  ensurePlayable: (
    file: File
  ) => Promise<{ needsProxy: false } | { needsProxy: true; proxyPath: string; codec: string }>
  onProxyProgress: (cb: (data: { filePath: string; percent: number }) => void) => void
  removeProxyListeners: () => void
  cancelProxy: (file: File) => Promise<boolean>
  selectSavePath: (defaultPath: string) => Promise<string | null>
  getFfmpegCaps: () => Promise<FFmpegCaps>
  validateAdvanced: (
    file: File,
    advanced: AdvancedSettingsPayload
  ) => Promise<{ ok: true; command: string } | { ok: false; message: string; command: string }>
  processAdvanced: (
    file: File,
    advanced: AdvancedSettingsPayload,
    replaceOriginal: boolean,
    customOutputPath?: string
  ) => Promise<string>
  listPresets: () => Promise<Preset[]>
  savePreset: (preset: { id?: string; name: string; settings: AdvancedSettingsPayload }) => Promise<Preset[]>
  deletePreset: (id: string) => Promise<Preset[]>
  renamePreset: (id: string, name: string) => Promise<Preset[]>
}

export interface AdvancedSettingsPayload {
  videoCodec: string
  audioCodec: string
  videoFilters: string
  audioFilters: string
  extraArgs: string
  container: string
  outputExt: string
}

export interface Preset {
  id: string
  name: string
  settings: AdvancedSettingsPayload
  createdAt: string
  updatedAt: string
}

export interface EncoderInfo {
  name: string
  description: string
  type: 'video' | 'audio' | 'subtitle'
  isHardware: boolean
}

export interface FormatInfo {
  name: string
  description: string
  canMux: boolean
  canDemux: boolean
}

export interface FFmpegCaps {
  version: string
  encoders: EncoderInfo[]
  decoders: EncoderInfo[]
  formats: FormatInfo[]
}

// Tell TypeScript that the global Window object has this API attached
declare global {
  interface Window {
    api: IElectronAPI
  }
}
