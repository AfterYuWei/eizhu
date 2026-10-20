import { app, BrowserWindow as TestWindow, screen } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import type { Windows } from './windows.ts'
import type { RuntimeHost } from './runtime-host.ts'
import updater from 'electron-updater'

async function shown(window: BrowserWindow): Promise<void> {
  if (window.isVisible()) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Renderer bootstrap timed out')), 30000)
    window.once('show', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
/** Runs only with --smoke-test and an explicit isolated temporary data root. Never loads user data. */
export async function runSmoke(options: {
  windows: Windows
  runtime: () => RuntimeHost
  load: (window: BrowserWindow) => Promise<void>
  root: string
  keyMode: string
  startedAt: number
}): Promise<void> {
  const { windows, root } = options,
    window = windows.main
  await shown(window)
  const firstWindowMs = performance.now() - options.startedAt
  const health = await options.runtime().call('runtime.health')
  const crypto = await options.runtime().call('runtime.smoke')
  const renderer = await window.webContents.executeJavaScript(`(async () => ({
    node: typeof process, require: typeof require, bridge: typeof window.eizhu.app.bootstrap,
    health: await window.eizhu.runtime.health(), text: document.body.innerText.includes('新建连接'),
    reserved: await window.eizhu.group.list().then(() => 'unexpected-success', e => e.code),
    inputValidation: await window.eizhu.settings.write({ key: 'credential', value: 'synthetic' }).then(() => 'unexpected-success', e => e.code)
  }))()`)
  assert.equal(renderer.node, 'undefined')
  assert.equal(renderer.require, 'undefined')
  assert.equal(renderer.text, true)
  assert.equal(renderer.reserved, 'STAGE_NOT_READY')
  assert.equal(renderer.inputValidation, 'BAD_REQUEST')
  window.setContentSize(1280, 720)
  await window.webContents.executeJavaScript(
    `(async () => { await document.fonts.ready; document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); await new Promise(requestAnimationFrame) })()`,
  )
  await writeFile(join(root, 'home-light.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`document.documentElement.classList.replace('light', 'dark')`)
  await writeFile(join(root, 'home-dark.png'), (await window.webContents.capturePage()).toPNG())

  const editor = windows.create('editor')
  const available = screen.getDisplayMatching(editor.getBounds()).workAreaSize
  const content = editor.getContentSize()
  const outer = editor.getSize()
  const frameWidth = outer[0] - content[0]
  const frameHeight = outer[1] - content[1]
  const editorGeometry = {
    requested: [1280, 800],
    actual: content,
    workArea: [available.width, available.height],
    frame: [frameWidth, frameHeight],
  }
  // Windows CI has a 1024px display: the OS can constrain the initial native window to its work area.
  assert.deepEqual(content, [
    Math.min(1280, available.width - frameWidth),
    Math.min(800, available.height - frameHeight),
  ])
  await options.load(editor)
  await shown(editor)
  assert.equal(await windows.confirmTransition(), true)
  assert.equal(await windows.confirmApplicationClose(), true)
  const persistedValue = JSON.stringify({ state: { theme: 'light' }, version: 1 })
  await window.webContents.executeJavaScript(
    'window.eizhu.settings.write(' + JSON.stringify({ key: 'eizhu-settings', value: persistedValue }) + ')',
  )
  const editorBootstrap = await editor.webContents.executeJavaScript('window.eizhu.app.bootstrap()')
  assert.equal(editorBootstrap.window, 'editor')
  assert.equal(editorBootstrap.context.runtimeId, options.runtime().context.runtimeId)
  await writeFile(join(root, 'editor-empty.png'), (await editor.webContents.capturePage()).toPNG())

  // Kill the real utility process, preserve renderer memory, restart from committed SQLite state.
  const before = options.runtime().context
  await editor.webContents.executeJavaScript(`window.__eizhuSmokeUnsaved = 'synthetic unsaved buffer'`)
  process.kill(options.runtime().processId!, 'SIGTERM')
  const failed = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      const status = await window.eizhu.runtime.health().then(() => 'alive', e => e.code)
      if (status === 'RUNTIME_UNAVAILABLE') return status
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return 'timeout'
  })()`)
  assert.equal(failed, 'RUNTIME_UNAVAILABLE')
  const restored = await window.webContents.executeJavaScript('window.eizhu.runtime.restart()')
  assert.notEqual(restored.runtimeId, before.runtimeId)
  assert.equal(restored.generation, before.generation + 1)
  assert.equal(
    await editor.webContents.executeJavaScript('window.__eizhuSmokeUnsaved'),
    'synthetic unsaved buffer',
  )
  assert.equal(await windows.confirmTransition(), true)
  const persisted = await options.runtime().call<Record<string, string>>('settings.read')
  assert.equal(persisted['eizhu-settings'], persistedValue)
  const offlineEditor = new TestWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  })
  let monaco: { typescript: boolean; json: boolean; model: boolean }
  try {
    await offlineEditor.loadURL('eizhu://app/smoke.html')
    monaco = await offlineEditor.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 300; i++) {
        const result = document.getElementById('result')
        if (result?.dataset.state === 'passed') return JSON.parse(result.textContent)
        if (result?.dataset.state === 'failed') throw new Error(result.textContent)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Monaco worker timed out')
    })()`)
    assert.deepEqual(monaco, { typescript: true, json: true, model: true })
  } finally {
    offlineEditor.destroy()
  }
  const report = {
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    packaged: app.isPackaged,
    dataRoot: root,
    keyMode: options.keyMode,
    health,
    crypto,
    renderer,
    editor: true,
    editorGeometry,
    recovery: {
      failed,
      generation: restored.generation,
      retainedEditorMemory: true,
      persistedSettings: true,
    },
    updaterModule: typeof updater.autoUpdater.checkForUpdates === 'function',
    monaco,
    firstWindowMs,
    processMetrics: app.getAppMetrics().map(({ type, memory, cpu }) => ({ type, memory, cpu })),
    screenshots: ['home-light.png', 'home-dark.png', 'editor-empty.png'],
  }
  await writeFile(join(root, 'smoke.json'), JSON.stringify(report, null, 2))
  console.log('EIZHU_SMOKE_OK', JSON.stringify(report))
}
