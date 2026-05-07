import { app, shell, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import crypto from 'crypto'
import icon from '../../build/icon.png?asset'
import fs from 'fs/promises'
import { createReadStream, rmSync } from 'fs'
import { Readable } from 'stream'

// Register custom protocol BEFORE app is ready, so the renderer can load proxy files
// from any origin via media:///<absolute-path>
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

const UNPLAYABLE_CODECS = new Set([
  'prores',
  'hap',
  'hap_alpha',
  'hap_q',
  'dnxhd',
  'dnxhr',
  'rawvideo',
  'v210',
  'v410',
  'cineform',
  'ffv1',
  'huffyuv',
  'utvideo',
  'hevc',
  'h265'
])

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      devTools: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.aldairgonzalez.vmt')

  // Block the devtools optimizer which enables F12 by default
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers

  // A universal helper to find ANY of our binaries
  const getToolPath = (toolName: string): string => {
    const osFolder = process.platform === 'win32' ? 'win' : 'mac'
    // Automatically append .exe on Windows
    const executableName = process.platform === 'win32' ? `${toolName}.exe` : toolName

    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'binaries', executableName)
    }
    return path.join(app.getAppPath(), 'resources', osFolder, executableName)
  }

  // Custom protocol: media:///<abs-path> serves files from disk with proper
  // Range support so <video>/<audio> can seek and stream.
  const mimeFor = (ext: string): string => {
    switch (ext.toLowerCase()) {
      case '.mp4':
      case '.m4v':
        return 'video/mp4'
      case '.webm':
        return 'video/webm'
      case '.mov':
        return 'video/quicktime'
      case '.mkv':
        return 'video/x-matroska'
      case '.mp3':
        return 'audio/mpeg'
      case '.m4a':
        return 'audio/mp4'
      case '.aac':
        return 'audio/aac'
      case '.wav':
        return 'audio/wav'
      default:
        return 'application/octet-stream'
    }
  }

  protocol.handle('media', async (request) => {
    const url = new URL(request.url)
    let p = decodeURIComponent(url.pathname)
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) p = p.slice(1)

    let stat
    try {
      stat = await fs.stat(p)
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const fileSize = stat.size
    const mime = mimeFor(path.extname(p))
    const rangeHeader = request.headers.get('range')

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (!match) return new Response(null, { status: 416 })
      const start = parseInt(match[1])
      const end = match[2] ? parseInt(match[2]) : fileSize - 1
      if (start >= fileSize || end >= fileSize) return new Response(null, { status: 416 })

      const stream = createReadStream(p, { start, end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1)
        }
      })
    }

    const stream = createReadStream(p)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes'
      }
    })
  })

  const proxyDir = path.join(app.getPath('temp'), 'media-toolkit-proxies')
  // Cleanup on startup to handle previous crashes
  try {
    rmSync(proxyDir, { recursive: true, force: true })
  } catch (err) {
    console.error('Failed to clean up proxy dir on startup:', err)
  }
  fs.mkdir(proxyDir, { recursive: true }).catch(() => {})

  // Track active proxy generation tasks
  const activeProxies = new Map<
    string,
    {
      ffmpeg: ChildProcess | null
      promise: Promise<{ needsProxy: true; proxyPath: string; codec: string }>
    }
  >()

  function probeCodec(filePath: string): Promise<string> {
    const ffprobePath = getToolPath('ffprobe')
    return new Promise((resolve) => {
      const ffprobe = spawn(ffprobePath, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'default=nw=1:nk=1',
        filePath
      ])
      let out = ''
      ffprobe.stdout.on('data', (d) => (out += d))
      ffprobe.on('close', () => resolve(out.trim()))
      ffprobe.on('error', () => resolve(''))
    })
  }

  // ── FFmpeg capability enumeration ─────────────────────────────────────
  // Cached at first request so we only shell-out once per app session.
  type EncoderInfo = {
    name: string
    description: string
    type: 'video' | 'audio' | 'subtitle'
    isHardware: boolean
  }
  type FormatInfo = { name: string; description: string; canMux: boolean; canDemux: boolean }
  type FFmpegCaps = {
    version: string
    encoders: EncoderInfo[]
    decoders: EncoderInfo[]
    formats: FormatInfo[]
  }
  let cachedCaps: FFmpegCaps | null = null

  const HARDWARE_HINTS = [
    'nvenc',
    'qsv',
    'amf',
    'vaapi',
    'videotoolbox',
    'mediacodec',
    'rkmpp',
    'omx',
    'cuda'
  ]

  const runFfmpeg = (args: string[]): Promise<string> =>
    new Promise((resolve) => {
      const proc = spawn(getToolPath('ffmpeg'), ['-hide_banner', ...args])
      let out = ''
      proc.stdout.on('data', (d) => (out += d.toString()))
      proc.stderr.on('data', (d) => (out += d.toString()))
      proc.on('close', () => resolve(out))
      proc.on('error', () => resolve(''))
    })

  const parseEncoders = (raw: string): EncoderInfo[] => {
    // Sample line:
    //   V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC ...
    // Don't rely on finding a divider/legend — match the encoder shape directly
    // and skip legend rows where the second token is "=".
    const lines = raw.split(/\r?\n/)
    const out: EncoderInfo[] = []
    for (const line of lines) {
      const m = line.match(/^\s*([VAS])[.\w]{5}\s+(\S+)\s+(.*)$/)
      if (!m) continue
      const name = m[2]
      if (name === '=') continue // legend row e.g. " V..... = Video"
      const description = m[3].trim()
      const type: EncoderInfo['type'] = m[1] === 'V' ? 'video' : m[1] === 'A' ? 'audio' : 'subtitle'
      const isHardware = HARDWARE_HINTS.some((h) => name.toLowerCase().includes(h))
      out.push({ name, description, type, isHardware })
    }
    return out
  }

  const parseFormats = (raw: string): FormatInfo[] => {
    // Sample line:
    //   DE mp4             MP4 (MPEG-4 Part 14)
    // Legend rows like " D. = Demuxing supported" already fail the regex
    // because '.' isn't in the [E ] character class for column 2.
    const lines = raw.split(/\r?\n/)
    const out: FormatInfo[] = []
    for (const line of lines) {
      const m = line.match(/^\s*([D ])([E ])\s+(\S+)\s+(.*)$/)
      if (!m) continue
      const name = m[3]
      if (name === '=') continue
      const canDemux = m[1] === 'D'
      const canMux = m[2] === 'E'
      const description = m[4].trim()
      for (const alias of name.split(',')) {
        out.push({ name: alias, description, canMux, canDemux })
      }
    }
    return out
  }

  const enumerateFFmpegCaps = async (): Promise<FFmpegCaps> => {
    if (cachedCaps) return cachedCaps
    const [versionRaw, encodersRaw, decodersRaw, formatsRaw] = await Promise.all([
      runFfmpeg(['-version']),
      runFfmpeg(['-encoders']),
      runFfmpeg(['-decoders']),
      runFfmpeg(['-formats'])
    ])
    const versionMatch = versionRaw.match(/ffmpeg version (\S+)/)
    let version = versionMatch ? versionMatch[1] : 'unknown'
    // Trim Gyan-style "...full_build-www.gyan.dev" tail to keep the header tidy
    version = version.replace(/-(full|essentials|shared|static)?_?build.*$/i, '')
    if (version.length > 32) version = version.slice(0, 32) + '…'
    cachedCaps = {
      version,
      encoders: parseEncoders(encodersRaw),
      decoders: parseEncoders(decodersRaw),
      formats: parseFormats(formatsRaw)
    }
    return cachedCaps
  }

  ipcMain.handle('get-ffmpeg-caps', async () => enumerateFFmpegCaps())

  // ── Advanced presets (JSON-backed in userData) ─────────────────────────
  type Preset = {
    id: string
    name: string
    settings: {
      videoCodec: string
      audioCodec: string
      videoFilters: string
      audioFilters: string
      extraArgs: string
      container: string
      outputExt: string
    }
    createdAt: string
    updatedAt: string
  }
  type PresetsFile = { version: number; presets: Preset[] }

  const presetsPath = (): string => path.join(app.getPath('userData'), 'vmt-presets.json')

  const readPresets = async (): Promise<PresetsFile> => {
    try {
      const raw = await fs.readFile(presetsPath(), 'utf-8')
      const parsed = JSON.parse(raw) as PresetsFile
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.presets)) {
        return { version: 1, presets: [] }
      }
      return parsed
    } catch {
      return { version: 1, presets: [] }
    }
  }

  const writePresetsAtomic = async (data: PresetsFile): Promise<void> => {
    const target = presetsPath()
    const tmp = `${target}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, target)
  }

  ipcMain.handle('list-presets', async () => (await readPresets()).presets)

  ipcMain.handle('save-preset', async (_event, payload) => {
    const { id, name, settings } = payload as Pick<Preset, 'id' | 'name' | 'settings'>
    if (!name || typeof name !== 'string' || !name.trim())
      throw new Error('Preset name is required')
    if (!settings || typeof settings !== 'object') throw new Error('Preset settings are required')

    const file = await readPresets()
    const now = new Date().toISOString()
    const existingIdx = id ? file.presets.findIndex((p) => p.id === id) : -1
    const trimmedName = name.trim().slice(0, 80)

    if (existingIdx >= 0) {
      file.presets[existingIdx] = {
        ...file.presets[existingIdx],
        name: trimmedName,
        settings,
        updatedAt: now
      }
    } else {
      file.presets.push({
        id: crypto.randomUUID(),
        name: trimmedName,
        settings,
        createdAt: now,
        updatedAt: now
      })
    }
    await writePresetsAtomic(file)
    return file.presets
  })

  ipcMain.handle('delete-preset', async (_event, { id }: { id: string }) => {
    const file = await readPresets()
    file.presets = file.presets.filter((p) => p.id !== id)
    await writePresetsAtomic(file)
    return file.presets
  })

  ipcMain.handle('rename-preset', async (_event, { id, name }: { id: string; name: string }) => {
    if (!name || !name.trim()) throw new Error('Preset name is required')
    const file = await readPresets()
    const idx = file.presets.findIndex((p) => p.id === id)
    if (idx < 0) throw new Error('Preset not found')
    file.presets[idx] = {
      ...file.presets[idx],
      name: name.trim().slice(0, 80),
      updatedAt: new Date().toISOString()
    }
    await writePresetsAtomic(file)
    return file.presets
  })

  // ── Advanced Mode (custom ffmpeg invocations) ──────────────────────────
  type AdvancedSettings = {
    videoCodec: string
    audioCodec: string
    videoFilters: string
    audioFilters: string
    extraArgs: string
    container: string
    outputExt: string
  }

  // Tokenize a freeform args string respecting single/double quotes.
  const tokenizeArgs = (s: string): string[] => {
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
        else if (c === '\\' && i + 1 < s.length) {
          cur += s[i + 1]
          i++
        } else cur += c
      } else if (c === "'") inS = true
      else if (c === '"') inD = true
      else if (/\s/.test(c)) {
        if (cur) {
          tokens.push(cur)
          cur = ''
        }
      } else cur += c
    }
    if (cur) tokens.push(cur)
    return tokens
  }

  // Forbid args that would clobber our pipeline (-i, -y, -n, -loglevel) or
  // attempt shell metacharacter abuse.
  const FORBIDDEN_TOKENS = new Set(['-i', '-y', '-n', '-loglevel', '-stats'])
  const validateExtraTokens = (tokens: string[]): string | null => {
    for (const t of tokens) {
      if (FORBIDDEN_TOKENS.has(t)) return `Disallowed flag in Extra Args: ${t}`
    }
    return null
  }

  const buildAdvancedArgs = (input: string, output: string, adv: AdvancedSettings): string[] => {
    const args: string[] = ['-hide_banner', '-y', '-i', input]
    if (adv.videoCodec) args.push('-c:v', adv.videoCodec)
    if (adv.audioCodec) args.push('-c:a', adv.audioCodec)
    if (adv.videoFilters) args.push('-vf', adv.videoFilters)
    if (adv.audioFilters) args.push('-af', adv.audioFilters)
    const extra = tokenizeArgs(adv.extraArgs)
    args.push(...extra)
    if (adv.container) args.push('-f', adv.container)
    args.push(output)
    return args
  }

  // Run ffmpeg with `-f null -t 0.5 -` to dry-run check the user's settings
  // against the actual file (catches codec/filter mismatches before the real run).
  ipcMain.handle('validate-advanced', async (_event, payload) => {
    const { filePath, advanced } = payload as { filePath: string; advanced: AdvancedSettings }
    const extra = tokenizeArgs(advanced.extraArgs)
    const forbidden = validateExtraTokens(extra)
    if (forbidden) return { ok: false, message: forbidden, command: '' }

    const args: string[] = ['-hide_banner', '-y', '-i', filePath]
    if (advanced.videoCodec) args.push('-c:v', advanced.videoCodec)
    if (advanced.audioCodec) args.push('-c:a', advanced.audioCodec)
    if (advanced.videoFilters) args.push('-vf', advanced.videoFilters)
    if (advanced.audioFilters) args.push('-af', advanced.audioFilters)
    args.push(...extra)
    args.push('-t', '0.5', '-f', 'null', '-')

    const command = ['ffmpeg', ...args].join(' ')

    return new Promise((resolve) => {
      let stderr = ''
      const proc = spawn(getToolPath('ffmpeg'), args)
      proc.stderr.on('data', (d) => (stderr += d.toString()))
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true, command })
        } else {
          // Extract last non-progress lines for a useful error message
          const errLines = stderr
            .split('\n')
            .filter((l) => l && !/^(frame=|size=|time=|bitrate=|speed=|video:)/.test(l))
            .slice(-4)
            .map((l) => l.trim())
            .filter(Boolean)
          const message = errLines.join('\n') || `ffmpeg exited with code ${code}`
          resolve({ ok: false, message, command })
        }
      })
      proc.on('error', (err) => resolve({ ok: false, message: err.message, command }))
    })
  })

  // Run the user's custom ffmpeg pipeline for real and report progress.
  ipcMain.handle('process-advanced', async (event, payload) => {
    const { filePath, advanced, replaceOriginal } = payload as {
      filePath: string
      advanced: AdvancedSettings
      replaceOriginal: boolean
    }
    const customOutputPath: string | undefined = payload.customOutputPath

    const ffmpegPath = getToolPath('ffmpeg')
    const parsedPath = path.parse(filePath)
    let outputExt = `.${(advanced.outputExt || 'mp4').replace(/^\.+/, '')}`

    // Robustness: If the input is an image, ensure the output extension is also an image format
    const isInputImage = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tga', '.tiff', '.gif'].includes(
      parsedPath.ext.toLowerCase()
    )
    const videoFormats = ['.mp4', '.mkv', '.mov', '.avi', '.webm']
    if (isInputImage && videoFormats.includes(outputExt.toLowerCase())) {
      outputExt = parsedPath.ext // Fallback to original image extension
    }

    let outputPath: string
    if (customOutputPath) {
      outputPath = customOutputPath
      if (!outputPath.toLowerCase().endsWith(outputExt.toLowerCase())) {
        if (!path.extname(outputPath)) outputPath += outputExt
      }
    } else {
      outputPath = path.join(parsedPath.dir, `${parsedPath.name}_advanced${outputExt}`)
    }

    // If replaceOriginal but we'd overwrite the source, write to temp and swap on success
    const willReplaceSource =
      replaceOriginal && parsedPath.ext.toLowerCase() === outputExt.toLowerCase()
    const tempOutput = willReplaceSource
      ? path.join(parsedPath.dir, `.${parsedPath.name}_advanced_tmp${outputExt}`)
      : outputPath
    if (willReplaceSource) outputPath = tempOutput

    const extra = tokenizeArgs(advanced.extraArgs)
    const forbidden = validateExtraTokens(extra)
    if (forbidden) throw new Error(forbidden)

    const args = buildAdvancedArgs(filePath, outputPath, advanced)

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(ffmpegPath, args)
      let stderr = ''
      proc.stderr.on('data', (d) => {
        const chunk = d.toString()
        stderr += chunk
        event.sender.send('ffmpeg-progress', chunk)
      })
      proc.on('close', async (code) => {
        if (code !== 0) {
          const errLines = stderr
            .split('\n')
            .filter((l) => l && !/^(frame=|size=|time=|bitrate=|speed=|video:)/.test(l))
            .slice(-4)
            .map((l) => l.trim())
            .filter(Boolean)
          reject(new Error(errLines.join('\n') || `ffmpeg exited with code ${code}`))
          return
        }
        try {
          if (willReplaceSource) {
            const finalPath = path.join(parsedPath.dir, `${parsedPath.name}${outputExt}`)
            await fs.unlink(filePath).catch(() => {})
            await fs.rename(tempOutput, finalPath)
            resolve(finalPath)
          } else {
            resolve(outputPath)
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
      proc.on('error', (err) => reject(err))
    })
  })

  ipcMain.handle('ensure-playable', async (event, { filePath }: { filePath: string }) => {
    // 1. Check if we are already generating a proxy for this file
    const existing = activeProxies.get(filePath)
    if (existing) return existing.promise

    const codec = await probeCodec(filePath)
    if (!codec || !UNPLAYABLE_CODECS.has(codec)) {
      return { needsProxy: false as const }
    }

    const hash = crypto.createHash('md5').update(filePath).digest('hex')
    const proxyPath = path.join(proxyDir, `${hash}.mp4`)

    // 2. Reuse a cached proxy if it's at least as new as the source
    try {
      const [srcStat, proxyStat] = await Promise.all([fs.stat(filePath), fs.stat(proxyPath)])
      if (proxyStat.mtimeMs >= srcStat.mtimeMs && proxyStat.size > 0) {
        return { needsProxy: true as const, proxyPath, codec }
      }
    } catch {
      // proxy doesn't exist yet
    }

    // 3. Start proxy generation
    const proxyPromise = (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          const ffmpegProcess = spawn(getToolPath('ffmpeg'), [
            '-i',
            filePath,
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '28',
            '-pix_fmt',
            'yuv420p',
            '-profile:v',
            'main',
            '-c:a',
            'aac',
            '-ac',
            '2',
            '-movflags',
            '+faststart',
            '-y',
            proxyPath
          ])

          // Update the active entry with the actual process handle
          const current = activeProxies.get(filePath)
          if (current) current.ffmpeg = ffmpegProcess

          let totalDur = 0
          ffmpegProcess.stderr.on('data', (data) => {
            const log = data.toString()
            const dm = log.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/)
            if (dm) {
              const [h, m, s] = dm[1].split(':')
              totalDur = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)
            }
            const tm = log.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/)
            if (tm && totalDur > 0) {
              const [h, m, s] = tm[1].split(':')
              const cur = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s)
              const pct = Math.min(100, Math.round((cur / totalDur) * 100))
              event.sender.send('proxy-progress', { filePath, percent: pct })
            }
          })

          ffmpegProcess.on('close', (code) => {
            if (code === 0) resolve()
            else if (code === null) reject(new Error('Proxy generation cancelled'))
            else reject(new Error(`Proxy generation failed (code ${code})`))
          })

          ffmpegProcess.on('error', (err) => reject(err))
        })

        return { needsProxy: true as const, proxyPath, codec }
      } finally {
        activeProxies.delete(filePath)
      }
    })()

    // Store immediately for deduplication
    activeProxies.set(filePath, { ffmpeg: null, promise: proxyPromise })
    return proxyPromise
  })

  ipcMain.handle('cancel-proxy', (_event, { filePath }: { filePath: string }) => {
    const active = activeProxies.get(filePath)
    if (active && active.ffmpeg) {
      active.ffmpeg.kill()
      activeProxies.delete(filePath)
      return true
    }
    return false
  })

  // Synchronous cleanup of the proxy temp dir on quit
  app.on('before-quit', () => {
    try {
      rmSync(proxyDir, { recursive: true, force: true })
    } catch (err) {
      console.error('Failed to clean up proxy dir on quit:', err)
    }
  })

  ipcMain.handle('show-in-folder', (_event, filePath) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('export-file', async (event, { sourcePath }: { sourcePath: string }) => {
    const parsed = path.parse(sourcePath)
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const ext = parsed.ext.replace('.', '') || 'file'

    const result = await dialog.showSaveDialog(win!, {
      title: 'Export As',
      defaultPath: parsed.base,
      filters: [
        { name: ext.toUpperCase(), extensions: [ext] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { canceled: true as const }
    }

    await fs.copyFile(sourcePath, result.filePath)
    return { canceled: false as const, filePath: result.filePath }
  })

  ipcMain.handle('select-save-path', async (event, { defaultPath }: { defaultPath: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined

    const result = await dialog.showSaveDialog(win!, {
      title: 'Select Output Destination',
      defaultPath: defaultPath,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })

    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('save-frame', async (_event, { filePath, time, customPath }) => {
    const ffmpegPath = getToolPath('ffmpeg')
    const parsedPath = path.parse(filePath)
    const outputPath: string =
      typeof customPath === 'string' && customPath.length > 0
        ? customPath
        : path.join(parsedPath.dir, `${parsedPath.name}_frame_${Math.floor(time)}s.png`)

    return new Promise((resolve, reject) => {
      // ffmpeg -ss [time] -i [input] -frames:v 1 [output]
      const ffmpeg = spawn(ffmpegPath, [
        '-ss',
        time.toString(),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-y',
        outputPath
      ])

      ffmpeg.on('close', (code) => {
        if (code === 0) resolve(outputPath)
        else reject(new Error(`FFmpeg failed to save frame (code ${code})`))
      })
    })
  })

  ipcMain.handle('get-metadata', async (_event, filePath) => {
    const ffprobePath = getToolPath('ffprobe')
    return new Promise((resolve, reject) => {
      const ffprobe = spawn(ffprobePath, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,duration',
        '-of',
        'json',
        filePath
      ])

      let output = ''
      ffprobe.stdout.on('data', (data) => (output += data))
      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            const data = JSON.parse(output)
            const stream = data.streams[0]
            resolve({
              width: stream.width,
              height: stream.height,
              duration: parseFloat(stream.duration)
            })
          } catch {
            reject(new Error('Failed to parse ffprobe output'))
          }
        } else {
          reject(new Error(`ffprobe failed with code ${code}`))
        }
      })
    })
  })

  ipcMain.handle('process-media', async (_event, payload) => {
    const { filePath, action, replaceOriginal, settings } = payload
    // customOutputPath / outputFolder are passed through the settings object from the renderer
    const customOutputPath: string | undefined =
      payload.customOutputPath ?? settings?.customOutputPath
    const outputFolder: string | undefined = payload.outputFolder ?? settings?.outputFolder
    const ffmpegPath = getToolPath('ffmpeg')

    // Basic setup for the output file
    const parsedPath = path.parse(filePath)
    let outputExt = parsedPath.ext
    let suffix = `_${action}`

    // 1. Determine the specific FFmpeg arguments based on the chosen tool
    let ffmpegArgs: string[] = []

    switch (action) {
      case 'compress': {
        const {
          codec = 'libx264',
          compressionMethod = 'crf',
          crf = 28,
          bitrate = '2M',
          width,
          height,
          format = 'mp4'
        } = settings || {}

        outputExt = `.${format}`

        // Robustness: if input is an image, don't allow video extensions
        const isInputImage = [
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.bmp',
          '.tga',
          '.tiff',
          '.gif'
        ].includes(parsedPath.ext.toLowerCase())
        const videoFormats = ['.mp4', '.mkv', '.mov', '.avi', '.webm']
        if (isInputImage && videoFormats.includes(outputExt.toLowerCase())) {
          outputExt = parsedPath.ext
        }
        ffmpegArgs = ['-i', filePath]

        // 1. Video Codec
        if (codec.startsWith('prores')) {
          ffmpegArgs.push('-c:v', 'prores_ks')
          const profileMap: Record<string, string> = {
            'prores-proxy': '0',
            'prores-lt': '1',
            'prores-422': '2',
            'prores-hq': '3',
            'prores-4444': '4',
            'prores-4444xq': '5'
          }
          ffmpegArgs.push('-profile:v', profileMap[codec] || '2')
          ffmpegArgs.push('-pix_fmt', codec.includes('4444') ? 'yuva444p10le' : 'yuv422p10le')
        } else if (codec === 'hevc_alpha') {
          ffmpegArgs.push(
            '-c:v',
            'libx265',
            '-x265-params',
            'lossless=1',
            '-pix_fmt',
            'yuva444p10le'
          )
        } else if (codec === 'vp9_alpha') {
          ffmpegArgs.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p')
        } else if (codec === 'hap_alpha') {
          ffmpegArgs.push('-c:v', 'hap', '-format', 'hap_alpha')
        } else {
          ffmpegArgs.push('-c:v', codec)
        }

        // 2. Compression (CRF or Bitrate)
        // Skip for ProRes as it uses profiles
        if (!codec.startsWith('prores')) {
          if (compressionMethod === 'crf') {
            ffmpegArgs.push('-crf', crf.toString())
          } else {
            ffmpegArgs.push('-b:v', bitrate)
          }
        }

        // 3. Resizing
        if (width || height) {
          const scale = `scale=${width || -1}:${height || -1}`
          ffmpegArgs.push('-vf', scale)
        }

        // 4. Common settings
        ffmpegArgs.push('-preset', 'fast', '-c:a', 'aac')
        break
      }
      case 'extract_audio':
      case 'trim_audio': {
        const {
          startTime,
          endTime,
          audioFormat = 'mp3',
          audioMode = 'vbr',
          audioQuality = 2,
          audioBitrate = '192k',
          wavBitDepth = '16'
        } = settings || {}

        suffix = action === 'trim_audio' ? '_trim' : '_audio'
        ffmpegArgs = []

        if (action === 'trim_audio') {
          ffmpegArgs.push('-ss', startTime || '00:00:00', '-to', endTime || '00:00:10')
        }
        ffmpegArgs.push('-i', filePath, '-vn')

        if (audioFormat === 'wav') {
          const codec = wavBitDepth === '24' ? 'pcm_s24le' : 'pcm_s16le'
          ffmpegArgs.push('-c:a', codec)
          outputExt = '.wav'
        } else if (audioFormat === 'mp3') {
          ffmpegArgs.push('-c:a', 'libmp3lame')
          if (audioMode === 'vbr') {
            ffmpegArgs.push('-q:a', String(audioQuality))
          } else {
            ffmpegArgs.push('-b:a', String(audioBitrate))
          }
          outputExt = '.mp3'
        } else if (audioFormat === 'aac') {
          ffmpegArgs.push('-c:a', 'aac', '-b:a', String(audioBitrate))
          outputExt = '.aac'
        } else if (audioFormat === 'm4a') {
          // AAC in MP4 container
          ffmpegArgs.push('-c:a', 'aac', '-b:a', String(audioBitrate), '-f', 'mp4')
          outputExt = '.m4a'
        }
        break
      }
      case 'remove_audio':
        // Copy video stream directly, drop audio (-an)
        ffmpegArgs = ['-i', filePath, '-c:v', 'copy', '-an']
        break
      case 'trim': {
        const {
          startTime,
          endTime,
          codec = 'libx264',
          compressionMethod = 'crf',
          crf = 28,
          bitrate = '2M',
          width,
          height,
          format
        } = settings || {}

        if (format) outputExt = `.${format}`

        ffmpegArgs = ['-ss', startTime || '00:00:00', '-to', endTime || '00:00:10', '-i', filePath]

        // Video codec
        if (codec.startsWith('prores')) {
          ffmpegArgs.push('-c:v', 'prores_ks')
          const profileMap: Record<string, string> = {
            'prores-proxy': '0',
            'prores-lt': '1',
            'prores-422': '2',
            'prores-hq': '3',
            'prores-4444': '4',
            'prores-4444xq': '5'
          }
          ffmpegArgs.push('-profile:v', profileMap[codec] || '2')
          ffmpegArgs.push('-pix_fmt', codec.includes('4444') ? 'yuva444p10le' : 'yuv422p10le')
        } else {
          ffmpegArgs.push('-c:v', codec)
        }

        // Quality (skip for ProRes / HAP / copy)
        if (!codec.startsWith('prores') && codec !== 'hap' && codec !== 'copy') {
          if (compressionMethod === 'crf') {
            ffmpegArgs.push('-crf', crf.toString())
          } else {
            ffmpegArgs.push('-b:v', bitrate)
          }
        }

        // Resize
        if (width || height) {
          ffmpegArgs.push('-vf', `scale=${width || -1}:${height || -1}`)
        }

        // Common
        if (codec !== 'copy') ffmpegArgs.push('-preset', 'fast')
        ffmpegArgs.push('-c:a', 'aac')
        break
      }
      case 'gif':
        // We'll handle this separately below as it needs a pipe
        break
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    // 2. Build the final output path
    let outputPath =
      customOutputPath || path.join(parsedPath.dir, `${parsedPath.name}${suffix}${outputExt}`)

    // If outputFolder is provided (used for batching), we use that directory but keep the original filename
    if (outputFolder) {
      const targetDir = path.extname(outputFolder) ? path.dirname(outputFolder) : outputFolder
      outputPath = path.join(targetDir, `${parsedPath.name}${suffix}${outputExt}`)
    }

    // If the custom path doesn't have the right extension, we append it unless it already has one
    if (
      (customOutputPath || outputFolder) &&
      !outputPath.toLowerCase().endsWith(outputExt.toLowerCase())
    ) {
      // Only append if it's a known extension mismatch or missing
      if (!path.extname(outputPath)) {
        outputPath += outputExt
      }
    }

    // 3. SPECIAL CASE: GIF (using gifski)
    if (action === 'gif') {
      const gifskiPath = getToolPath('gifski')
      const gifOutputPath = outputPath.replace(outputExt, '.gif')
      const { startTime, endTime } = settings || {}

      const ffmpegGifArgs: string[] = []
      if (startTime) ffmpegGifArgs.push('-ss', startTime)
      if (endTime) ffmpegGifArgs.push('-to', endTime)
      ffmpegGifArgs.push('-i', filePath, '-v', 'error', '-f', 'yuv4mpegpipe', '-')

      return new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, ffmpegGifArgs)
        const gifski = spawn(gifskiPath, ['-o', gifOutputPath, '-'])

        // Handle pipe errors to prevent EPIPE crashes
        ffmpeg.stdout.pipe(gifski.stdin).on('error', (err: Error & { code?: string }) => {
          if (err.code !== 'EPIPE') {
            console.error('Pipe Error:', err)
          }
        })

        ffmpeg.stderr.on('data', (data) => console.log(`FFmpeg Error: ${data}`))
        gifski.stderr.on('data', (data) => console.log(`Gifski Error: ${data}`))

        gifski.on('close', (code) => {
          if (code === 0) resolve(gifOutputPath)
          else reject(new Error(`Gifski exited with code ${code}. Check logs.`))
        })

        ffmpeg.on('error', (err) => {
          console.error('FFmpeg Process Error:', err)
          reject(err)
        })

        gifski.on('error', (err) => {
          console.error('Gifski Process Error:', err)
          reject(err)
        })
      })
    }

    // 4. Execute standard FFmpeg commands
    ffmpegArgs.push('-y', outputPath)

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, ffmpegArgs)

      ffmpeg.stderr.on('data', (data) => {
        // In the future, we will parse this to drive a real progress bar
        _event.sender.send('ffmpeg-progress', data.toString())
      })

      ffmpeg.on('close', async (code) => {
        if (code === 0) {
          try {
            if (replaceOriginal) {
              // SECURITY CHECK: Do the extensions match exactly?
              if (parsedPath.ext.toLowerCase() === outputExt.toLowerCase()) {
                // Safe to replace! Delete original, rename new file to exact original name.
                const finalReplacedPath = path.join(
                  parsedPath.dir,
                  `${parsedPath.name}${outputExt}`
                )
                await fs.unlink(filePath)
                await fs.rename(outputPath, finalReplacedPath)
                resolve(finalReplacedPath)
              } else {
                // DANGER: Extensions differ. DO NOT delete the original.
                // Just rename the temp file to look clean (e.g., video_extract_audio.mp3 -> video.mp3)
                const safeOutputPath = path.join(parsedPath.dir, `${parsedPath.name}${outputExt}`)
                try {
                  await fs.rename(outputPath, safeOutputPath)
                  resolve(safeOutputPath)
                } catch {
                  // If a file with that name already exists, fallback to the temp name
                  resolve(outputPath)
                }
              }
            } else {
              // If they didn't check the box, just return the temporary file
              resolve(outputPath)
            }
          } catch (err: unknown) {
            reject(
              new Error(
                `File system error during replacement: ${
                  err instanceof Error ? err.message : String(err)
                }`
              )
            )
          }
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`))
        }
      })
    })
  })

  ipcMain.handle('convert-image', async (_event, payload) => {
    const { filePath, settings } = payload
    const customOutputPath: string | undefined =
      payload.customOutputPath ?? settings?.customOutputPath
    const outputFolder: string | undefined = payload.outputFolder ?? settings?.outputFolder
    const ffmpegPath = getToolPath('ffmpeg')
    const parsedPath = path.parse(filePath)
    let format = settings?.format || 'png'
    const { width, height, crf = 80 } = settings || {}

    // Safety check: if they somehow requested a video format for an image, fallback to png
    const videoFormats = ['mp4', 'mkv', 'mov', 'avi', 'webm']
    if (videoFormats.includes(format.toLowerCase())) {
      format = 'png'
    }

    const outputExt = `.${format}`
    let outputPath =
      customOutputPath || path.join(parsedPath.dir, `${parsedPath.name}_converted${outputExt}`)

    if (outputFolder) {
      const targetDir = path.extname(outputFolder) ? path.dirname(outputFolder) : outputFolder
      outputPath = path.join(targetDir, `${parsedPath.name}_converted${outputExt}`)
    }

    const args = ['-i', filePath]

    // 1. Resizing
    if (width || height) {
      args.push('-vf', `scale=${width || -1}:${height || -1}`)
    }

    // 2. Quality / Compression
    if (format === 'jpg' || format === 'jpeg') {
      // FFmpeg use -q:v for JPG quality (1-31, 1 is best. We map 100-0 to 1-31)
      const qVal = Math.max(1, Math.min(31, Math.floor((31 * (100 - crf)) / 100)))
      args.push('-q:v', qVal.toString())
    } else if (format === 'webp') {
      args.push('-q:v', crf.toString())
    }

    args.push('-y', outputPath)

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, args)
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve(outputPath)
        else reject(new Error(`FFmpeg failed to convert image (code ${code})`))
      })
    })
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
