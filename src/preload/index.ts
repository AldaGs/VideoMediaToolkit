import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type MediaSettings = {
  startTime?: string
  endTime?: string
  [key: string]: string | number | boolean | undefined
}

const api = {
  // Takes the File object and the settings, packages them up securely
  processMedia: (
    file: File,
    action: string,
    replaceOriginal: boolean,
    settings?: MediaSettings
  ) => {
    const filePath = webUtils.getPathForFile(file)
    // Send a combined object payload to Node
    return ipcRenderer.invoke('process-media', { filePath, action, replaceOriginal, settings })
  },
  saveFrame: (file: File, time: number, customPath?: string) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('save-frame', { filePath, time, customPath })
  },
  getMetadata: (file: File) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('get-metadata', filePath)
  },
  // Add the new Image handler
  convertImage: (file: File, settings?: MediaSettings) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('convert-image', { filePath, settings })
  },
  showInFolder: (filePath: string) => ipcRenderer.invoke('show-in-folder', filePath),
  ensurePlayable: (file: File) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('ensure-playable', { filePath }) as Promise<
      { needsProxy: false } | { needsProxy: true; proxyPath: string; codec: string }
    >
  },
  onProxyProgress: (cb: (data: { filePath: string; percent: number }) => void) =>
    ipcRenderer.on('proxy-progress', (_e, value) => cb(value)),
  removeProxyListeners: () => ipcRenderer.removeAllListeners('proxy-progress'),
  cancelProxy: (file: File) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('cancel-proxy', { filePath })
  },
  exportFile: (sourcePath: string) =>
    ipcRenderer.invoke('export-file', { sourcePath }) as Promise<
      { canceled: true } | { canceled: false; filePath: string }
    >,
  selectAudioFile: () =>
    ipcRenderer.invoke('select-audio-file') as Promise<string | null>,
  selectSavePath: (defaultPath: string) =>
    ipcRenderer.invoke('select-save-path', { defaultPath }) as Promise<string | null>,
  getFfmpegCaps: () => ipcRenderer.invoke('get-ffmpeg-caps'),
  listPresets: () => ipcRenderer.invoke('list-presets'),
  savePreset: (preset: { id?: string; name: string; settings: unknown }) =>
    ipcRenderer.invoke('save-preset', preset),
  deletePreset: (id: string) => ipcRenderer.invoke('delete-preset', { id }),
  renamePreset: (id: string, name: string) => ipcRenderer.invoke('rename-preset', { id, name }),
  validateAdvanced: (file: File, advanced: unknown) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('validate-advanced', { filePath, advanced })
  },
  processAdvanced: (
    file: File,
    advanced: unknown,
    replaceOriginal: boolean,
    customOutputPath?: string
  ) => {
    const filePath = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('process-advanced', {
      filePath,
      advanced,
      replaceOriginal,
      customOutputPath
    })
  },
  onProgress: (callback: (log: string) => void) =>
    ipcRenderer.on('ffmpeg-progress', (_event, value) => callback(value)),
  removeListeners: () => ipcRenderer.removeAllListeners('ffmpeg-progress')
}

// 2. Safely expose both the standard toolkit and our custom API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api) // Only called ONCE now!
  } catch (error) {
    console.error(error)
  }
} else {
  // Fallback for non-isolated environments (rare in modern Electron)
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
