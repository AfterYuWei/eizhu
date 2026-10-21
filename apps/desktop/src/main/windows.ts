import { BrowserWindow, dialog, screen } from 'electron'
import { join } from 'node:path'
import type { DesktopEvents, RuntimeContext } from '@eizhu/contracts'
import { randomUUID } from 'node:crypto'
import { eventSchemas,fail,failureOf } from '@eizhu/contracts'

type Transition = {
  id: string
  kind: 'workspace' | 'application'
  resolve: (accepted: boolean) => void
  timer: NodeJS.Timeout
}
export class Windows {
  main!: BrowserWindow
  editor?: BrowserWindow
  private editorReady = false
  private opens: DesktopEvents['eizhu-editor-open-file'][] = []
  private transition?: Transition
  private closing = false
  private quitting = false
  private editorCloseRequest?:string
  canOpenEditor():boolean{return !this.closing&&!this.transition&&!this.editorCloseRequest}
  private directory: string
  private context: () => RuntimeContext
  private quit: () => Promise<void>
  constructor(directory: string, context: () => RuntimeContext, quit: () => Promise<void>) {
    this.directory = directory
    this.context = context
    this.quit = quit
  }
  create(kind: 'main' | 'editor'): BrowserWindow {
    const area = screen.getPrimaryDisplay().workAreaSize
    const window = new BrowserWindow({
      title: kind === 'main' ? 'eizhu' : 'eizhu — 编辑器',
      width: kind === 'main' ? Math.round(area.width * 0.85) : 1280,
      height: kind === 'main' ? Math.round(area.height * 0.85) : 800,
      useContentSize: kind === 'editor',
      center: true,
      minWidth: Math.min(900, Math.round(area.width * 0.85)),
      minHeight: Math.min(600, Math.round(area.height * 0.85)),
      show: false,
      icon:
        process.platform === 'darwin'
          ? undefined
          : join(
              this.directory,
              '../../resources',
              process.platform === 'win32' ? 'icon.ico' : '256x256.png',
            ),
      backgroundColor: '#0A0A0A',
      frame: process.platform === 'darwin',
      titleBarStyle: process.platform === 'darwin' && kind === 'main' ? 'hidden' : undefined,
      trafficLightPosition: process.platform === 'darwin' && kind === 'main' ? { x: 16, y: 24 } : undefined,
      webPreferences: {
        preload: join(this.directory, '../preload/index.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    })
    const [outerWidth, outerHeight] = window.getSize(),
      [innerWidth, innerHeight] = window.getContentSize()
    window.setMinimumSize(
      Math.min(900, innerWidth) + outerWidth - innerWidth,
      Math.min(600, innerHeight) + outerHeight - innerHeight,
    )
    if (kind === 'main') this.main = window
    else {
      this.editor = window
      this.editorReady = false
    }
    window.setMenuBarVisibility(false)
    const state = () => this.emit(window, 'eizhu-window-state', { maximized: window.isMaximized() })
    window.on('maximize', state)
    window.on('unmaximize', state)
    window.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      if (kind === 'main') void this.requestQuit()
      else {this.editorCloseRequest??=randomUUID();this.emit(window, 'eizhu-window-close-request', {requestId:this.editorCloseRequest})}
    })
    window.on('closed', () => {
      if (kind === 'editor') {
        this.editor = undefined
        this.editorReady = false
        this.editorCloseRequest=undefined
        this.opens = []
        this.transition?.resolve(false)
        if (this.transition) clearTimeout(this.transition.timer)
        this.transition = undefined
      }
    })
    return window
  }
  kind(window: BrowserWindow): 'main' | 'editor' {
    return window === this.main ? 'main' : 'editor'
  }
  owns(window: BrowserWindow): boolean {
    return window === this.main || window === this.editor
  }
  emit<K extends keyof DesktopEvents>(window: BrowserWindow, name: K, payload: DesktopEvents[K]): void {
    eventSchemas[name].parse(payload)
    if (!window.isDestroyed())
      window.webContents.send('eizhu:event', { context: this.context(), name, payload })
  }
  broadcast<K extends keyof DesktopEvents>(name: K, payload: DesktopEvents[K]): void {
    for (const window of [this.main, this.editor])
      if (window && !window.isDestroyed()) this.emit(window, name, payload)
  }
  enqueueOpen(input: DesktopEvents['eizhu-editor-open-file']): void {
    if (this.opens.length >= 32) throw new Error('Editor open queue full')
    if (this.editorReady && this.editor) this.emit(this.editor, 'eizhu-editor-open-file', input)
    else this.opens.push(input)
  }
  readyEditor(): void {
    this.editorReady = true
    if (!this.editor) return
    for (const open of this.opens.splice(0)) this.emit(this.editor, 'eizhu-editor-open-file', open)
    this.editor.show()
  }
  confirmTransition(): Promise<boolean> {
    return this.confirm('workspace')
  }
  confirmApplicationClose(): Promise<boolean> {
    return this.confirm('application')
  }
  private confirm(kind: 'workspace' | 'application'): Promise<boolean> {
    if (!this.editor) return Promise.resolve(true)
    if (!this.editorReady || this.transition) return Promise.resolve(false)
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.transition = undefined
        resolve(false)
      }, 120_000)
      this.transition = { id, kind, resolve, timer }
      if (kind === 'workspace') this.emit(this.editor!, 'eizhu-editor-transition', { requestId: id })
      else this.emit(this.editor!, 'eizhu-app-close-request', { requestId: id })
      this.editor!.show()
    })
  }
  resolveTransition(id: string, accepted: boolean): boolean {
    return this.resolveConfirmation('workspace', id, accepted)
  }
  resolveApplicationClose(id: string, accepted: boolean): boolean {
    return this.resolveConfirmation('application', id, accepted)
  }
  private resolveConfirmation(kind: Transition['kind'], id: string, accepted: boolean): boolean {
    if (this.transition?.id !== id || this.transition.kind !== kind) return false
    clearTimeout(this.transition.timer)
    this.transition.resolve(accepted)
    this.transition = undefined
    return true
  }
  cancelConfirmations(): void {
    if (!this.transition) return
    clearTimeout(this.transition.timer)
    this.transition.resolve(false)
    this.transition = undefined
  }
  async requestQuit(): Promise<void> {
    if (this.closing) return
    this.closing = true
    try {
      if (await this.confirmApplicationClose()) {
        this.quitting = true
        await this.quit()
      }
    } catch (cause) {
      this.quitting = false
      dialog.showErrorBox('无法退出 eizhu', failureOf(cause).message + '。窗口和未保存内容已保留，请重试关闭应用。')
    } finally {
      this.closing = false
    }
  }
  closeEditor(accepted: boolean,requestId?:string): void {
    if((this.editorCloseRequest&&requestId!==this.editorCloseRequest)||(requestId&&!this.editorCloseRequest))fail('REQUEST_EXPIRED','此关闭确认请求已失效')
    this.editorCloseRequest=undefined
    if (accepted) this.editor?.destroy()
  }
}
