import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  shell,
} from 'electron'
import { mkdir, appendFile, writeFile, chmod, open, stat, rename } from 'node:fs/promises'
import { join, basename, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstatSync, readdirSync, realpathSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  foundation,
  requestSchema,
  isFoundationOperation,
  sameContext,
  fail,
  failureOf,
  redactLogText,
} from '@eizhu/contracts'
import type { Bootstrap, PlatformCapabilities, RuntimeContext } from '@eizhu/contracts'
import { loadDeviceKey } from '@eizhu/core/runtime/device-key'
import { RuntimeHost } from './runtime-host.ts'
import { Windows } from './windows.ts'
import { assetPath, isTrustedPage } from './security.ts'
declare const __EIZHU_VERSION__: string
declare const __EIZHU_CHANNEL__: string

const smoke = process.argv.includes('--smoke-test')
const smokeRoot = process.argv.find((value) => value.startsWith('--smoke-root='))?.slice(13)
if (smoke && !smokeRoot) throw new Error('Smoke test requires an isolated --smoke-root')
if (
  smoke &&
  (lstatSync(smokeRoot!).isSymbolicLink() ||
    !realpathSync(smokeRoot!).startsWith(realpathSync(tmpdir()) + sep) ||
    readdirSync(smokeRoot!).length)
)
  throw new Error('Smoke root must be a fresh empty temporary directory')
if (process.platform !== 'win32') process.umask(0o077)
const dataRoot = smoke
  ? join(smokeRoot!, 'profile')
  : join(app.getPath('appData'), app.isPackaged ? 'eizhu-desktop' : 'eizhu-desktop-dev')
// Electron path overrides require existing directories, including on the first normal installation.
mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
mkdirSync(join(dataRoot, 'chromium'), { recursive: true, mode: 0o700 })
app.setPath('userData', dataRoot)
app.setPath('sessionData', join(dataRoot, 'chromium'))
app.setName('eizhu')
if (process.platform === 'win32') app.setAppUserModelId('com.yuweinfo.eizhu')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'eizhu',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
let runtime: RuntimeHost
let windows: Windows
let settings: Bootstrap['settings'] = {}
let keyMode: 'system' | 'restricted-file'
let deviceKey: Buffer | undefined
let shuttingDown = false
let healthy = false
let restarting: Promise<RuntimeContext> | undefined
const startedAt = performance.now()
function runtimeFailed(): void {
  healthy = false
  windows?.broadcast('eizhu-runtime-state', { status: 'failed', message: '业务进程已退出，未保存内容仍保留' })
}
async function restartRuntime(): Promise<RuntimeContext> {
  restarting ??= (async () => {
    windows.cancelConfirmations()
    healthy = false
    await runtime.close()
    const candidate = new RuntimeHost(dataRoot, __dirname, runtime.context.generation + 1, runtimeFailed)
    let nextSettings: Bootstrap['settings']
    try {
      await candidate.start()
      nextSettings = await candidate.call('settings.read')
    } catch (cause) {
      await candidate.close()
      throw cause
    }
    runtime = candidate
    settings = nextSettings
    healthy = true
    for (const window of [windows.main, windows.editor]) {
      if (window && !window.isDestroyed()) window.webContents.send('eizhu:context', bootstrap(window))
    }
    windows.broadcast('eizhu-workspace-changed', {
      id: runtime.context.workspaceId,
      generation: runtime.context.generation,
      userId: 0,
    })
    windows.broadcast('eizhu-runtime-state', { status: 'ready' })
    return runtime.context
  })().finally(() => {
    restarting = undefined
  })
  return restarting
}

function capabilities(): PlatformCapabilities {
  return {
    platform:
      process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'win32'
          ? 'windows'
          : process.platform === 'linux'
            ? 'linux'
            : 'unknown',
    runtime: 'desktop',
    windowControls: true,
    appUpdates: false,
    dragOut: false,
    nativeFilePaths: true,
    documentPicker: false,
    secureKeyStore: keyMode === 'system',
    maxConcurrentTransfers: 5,
  }
}
function authenticate(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (
    !window ||
    !windows.owns(window) ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedPage(event.senderFrame.url, devUrl)
  )
    fail('FORBIDDEN', '调用来源未授权')
  return window
}
function bootstrap(window: BrowserWindow): Bootstrap {
  return {
    context: runtime.context,
    workspace: { id: 'offline', generation: runtime.context.generation, userId: 0 },
    platform: capabilities(),
    window: windows.kind(window),
    version: __EIZHU_VERSION__,
    settings,
  }
}
async function quit(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await restarting?.catch(() => undefined)
    healthy = false
    await runtime?.close()
    deviceKey?.fill(0)
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    app.quit()
  } catch (cause) {
    shuttingDown = false
    runtimeFailed()
    throw cause
  }
}
async function load(window: BrowserWindow): Promise<void> {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  const suffix = window === windows.editor ? '?window=editor' : ''
  if (devUrl) await window.loadURL(devUrl + suffix)
  else await window.loadURL('eizhu://app/index.html' + suffix)
}
async function execute(window: BrowserWindow, operation: string, input: unknown): Promise<unknown> {
  if (!isFoundationOperation(operation)) return fail('STAGE_NOT_READY', '该业务能力将在后续实施阶段开放')
  const value = foundation[operation].input.parse(input)
  switch (operation) {
    case 'app.bootstrap':
      return bootstrap(window)
    case 'app.ready':
      window.show()
      return
    case 'runtime.health':
    case 'workspace.status':
      return runtime.call(operation)
    case 'runtime.restart':
      if (window !== windows.main) fail('FORBIDDEN', '仅主窗口可恢复业务进程')
      return restartRuntime()
    case 'settings.write': {
      if (window !== windows.main && window !== windows.editor) fail('FORBIDDEN', '窗口未授权')
      const data = foundation['settings.write'].input.parse(value)
      await runtime.call(operation, data)
      if (data.value === null) delete settings[data.key]
      else settings[data.key] = data.value
      for (const other of [windows.main, windows.editor])
        if (other && other !== window) windows.emit(other, 'eizhu-settings-changed', data)
      return
    }
    case 'window.minimize':
      window.minimize()
      return
    case 'window.toggleMaximize':
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return
    case 'window.state':
      return { maximized: window.isMaximized() }
    case 'window.close':
      window.close()
      return
    case 'editor.open':
      if (window !== windows.main) fail('FORBIDDEN', '仅主窗口可打开编辑器')
      // File/session ownership is enabled with the actual editor use case in stage 4.
      return fail('STAGE_NOT_READY', '文件编辑将在阶段 4 开放')
    case 'editor.ready':
      if (window !== windows.editor) fail('FORBIDDEN', '仅编辑器可确认就绪')
      windows.readyEditor()
      return
    case 'editor.show':
      if (window !== windows.editor) fail('FORBIDDEN', '仅编辑器可显示')
      window.show()
      return
    case 'editor.confirmTransition':
      if (window !== windows.main) fail('FORBIDDEN', '仅主窗口可请求切换')
      return windows.confirmTransition()
    case 'editor.resolveTransition': {
      if (window !== windows.editor) fail('FORBIDDEN', '仅编辑器可确认切换')
      const data = foundation['editor.resolveTransition'].input.parse(value)
      if (!windows.resolveTransition(data.requestId, data.accepted))
        fail('REQUEST_EXPIRED', '此确认请求已失效，请重试')
      return
    }
    case 'editor.resolveClose': {
      if (window !== windows.editor) fail('FORBIDDEN', '仅编辑器可确认关闭')
      windows.closeEditor(foundation['editor.resolveClose'].input.parse(value).shouldClose)
      return
    }
    case 'editor.resolveAppClose': {
      if (window !== windows.editor) fail('FORBIDDEN', '仅编辑器可确认退出')
      const data = foundation['editor.resolveAppClose'].input.parse(value)
      if (!windows.resolveApplicationClose(data.requestId, data.shouldClose))
        fail('REQUEST_EXPIRED', '此退出请求已失效，请重试')
      return
    }
    case 'clipboard.read':
      return clipboard.readText()
    case 'clipboard.write':
      await clipboard.writeText(foundation['clipboard.write'].input.parse(value).text)
      return
    case 'system.openExternal':
      await shell.openExternal(foundation['system.openExternal'].input.parse(value).url)
      return
    case 'system.saveText': {
      const data = foundation['system.saveText'].input.parse(value)
      const result = await dialog.showSaveDialog(window, { defaultPath: basename(data.suggestedName) })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, data.content, { mode: 0o600 })
      return result.filePath
    }
    case 'diagnostics.read': {
      const { kind } = foundation['diagnostics.read'].input.parse(value)
      const path = join(dataRoot, `${kind}.log`)
      try {
        const handle = await open(path, 'r')
        try {
          const size = (await handle.stat()).size,
            buffer = Buffer.alloc(Math.min(262144, size))
          await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length))
          return { kind, path, content: buffer.toString('utf8') }
        } finally {
          await handle.close()
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind, path, content: '' }
        throw error
      }
    }
    case 'diagnostics.clear': {
      const { kind } = foundation['diagnostics.clear'].input.parse(value)
      await writeFile(join(dataRoot, `${kind}.log`), '', { mode: 0o600 })
      return
    }
    case 'diagnostics.append': {
      const data = foundation['diagnostics.append'].input.parse(value)
      // Only test builds retain frontend diagnostics. Structured secrets are redacted again in main.
      if (__EIZHU_CHANNEL__ === 'test') {
        const lines = data.lines.map(redactLogText)
        const path = join(dataRoot, 'frontend.log')
        if (
          await stat(path).then(
            (info) => info.size > 2 * 1024 * 1024,
            () => false,
          )
        )
          await rename(path, `${path}.previous`)
        await appendFile(path, lines.join('\n') + '\n', { mode: 0o600 })
      }
      return
    }
  }
}

app.on('before-quit', (event) => {
  if (!shuttingDown) {
    event.preventDefault()
    void windows?.requestQuit()
  }
})
app.on('window-all-closed', () => {
  if (!shuttingDown) void quit()
})
app.on('second-instance', () => {
  windows?.main?.show()
  windows?.main?.focus()
})
app.on('activate', () => {
  if (windows?.main && !windows.main.isDestroyed()) {
    windows.main.show()
    windows.main.focus()
  }
})
// Deep links are registered now; OAuth validation and handling arrive with stage 5.
app.on('open-url', (event) => event.preventDefault())

async function start(): Promise<void> {
  if (!smoke && !app.requestSingleInstanceLock()) {
    app.exit(0)
    return
  }
  await app.whenReady()
  await mkdir(dataRoot, { recursive: true, mode: 0o700 })
  await chmod(dataRoot, 0o700)
  const key = await loadDeviceKey(dataRoot, {
    available: () =>
      !smoke &&
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    wrap: (value) => safeStorage.encryptString(value),
    unwrap: (value) => safeStorage.decryptString(value),
    restrict: async (path) => {
      if (process.platform === 'win32')
        await promisify(execFile)(
          'icacls.exe',
          [path, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:F`],
          { windowsHide: true },
        )
      else await chmod(path, 0o600)
    },
  })
  keyMode = key.mode
  deviceKey = key.key
  runtime = new RuntimeHost(dataRoot, __dirname, 1, runtimeFailed)
  await runtime.start()
  healthy = true
  settings = await runtime.call('settings.read')
  windows = new Windows(__dirname, () => runtime.context, quit)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      process.platform === 'darwin'
        ? [
            {
              label: 'eizhu',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
            { role: 'editMenu' },
            { role: 'windowMenu' },
          ]
        : [],
    ),
  )
  const renderer = join(__dirname, '../renderer')
  protocol.handle('eizhu', async (request) => {
    try {
      const path = assetPath(renderer, request.url)
      if (!path) return new Response('Forbidden', { status: 403 })
      const response = await net.fetch(pathToFileURL(path).href)
      const headers = new Headers(response.headers)
      headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
      )
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    contents.session.setPermissionCheckHandler(() => false)
  })
  ipcMain.handle('eizhu:bootstrap', (event) => bootstrap(authenticate(event)))
  ipcMain.handle('eizhu:request', async (event, raw) => {
    let context: RuntimeContext | undefined
    let id: string | undefined
    try {
      const window = authenticate(event),
        request = requestSchema.parse(raw)
      context = request.context
      id = request.id
      if (!healthy && ['runtime.health', 'workspace.status', 'settings.write'].includes(request.operation))
        fail('RUNTIME_UNAVAILABLE', '业务进程不可用，未保存内容仍保留')
      if (!sameContext(request.context, runtime.context)) fail('WORKSPACE_CHANGED', '数据空间已变化，请重试')
      const value = await execute(window, request.operation, request.input)
      return { id, context, value }
    } catch (cause) {
      return { id, context, error: failureOf(cause) }
    }
  })
  const window = windows.create('main')
  await load(window)
  if (smoke) {
    const { runSmoke } = await import('./smoke.ts')
    await runSmoke({ windows, runtime: () => runtime, load, root: dataRoot, keyMode, startedAt })
    await quit()
  }
}
void start().catch(async (cause) => {
  console.error('eizhu initialization failed; existing data retained')
  if (smoke) console.error(cause)
  await runtime?.close().catch(() => undefined)
  deviceKey?.fill(0)
  if (!smoke) {
    const failure = failureOf(cause)
    await appendFile(
      join(dataRoot, 'backend.log'),
      JSON.stringify({ code: failure.code, message: failure.message }) + '\n',
      { mode: 0o600 },
    ).catch(() => undefined)
    dialog.showErrorBox('eizhu 运行失败', `${failure.message}\n原数据已保留，请修复问题后重试。`)
  }
  app.exit(1)
})
