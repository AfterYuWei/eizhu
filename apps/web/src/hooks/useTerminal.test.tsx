// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTerminal } from './useTerminal'

const terminal = vi.hoisted(() => ({
  readClipboard: vi.fn<() => Promise<string>>(),
  paste: vi.fn(),
  keyHandler: (_event: KeyboardEvent): boolean => true,
}))
vi.mock('@/lib/clipboard', () => ({ readClipboardText: terminal.readClipboard, writeClipboardText: vi.fn() }))
vi.mock('@/lib/terminalThemes', () => ({ getTerminalTheme: () => ({}) }))
vi.mock('@/lib/terminalHighlighting', () => ({
  TerminalHighlighting: class {
    update() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
  },
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    element = document.createElement('div')
    options = {}
    unicode = { activeVersion: '' }
    cols = 80
    rows = 24
    paste = terminal.paste
    open(container: HTMLElement) {
      const textarea = document.createElement('textarea')
      // xterm 的自定义处理器返回 false 本身不会取消 DOM 默认行为。
      textarea.addEventListener('keydown', (event) => terminal.keyHandler(event))
      textarea.addEventListener('paste', (event) => this.paste(event.clipboardData?.getData('text/plain')))
      this.element.append(textarea)
      container.append(this.element)
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      terminal.keyHandler = handler
    }
    loadAddon() {}
    onData() {}
    onResize() {}
    dispose() {}
    clearTextureAtlas() {}
    refresh() {}
  },
}))

let host: HTMLDivElement, root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  terminal.readClipboard.mockResolvedValue('first\r\nsecond\rthird')
  vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function Test() {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal({ containerRef })
  return <div ref={containerRef} />
}

it.each([
  { platform: 'Macintosh', metaKey: true, ctrlKey: false, shiftKey: false },
  { platform: 'Windows', metaKey: false, ctrlKey: true, shiftKey: false },
  { platform: 'Linux', metaKey: false, ctrlKey: true, shiftKey: true },
])('$platform 粘贴快捷键只写入一次，并取消默认粘贴及冒泡', async ({ platform, ...modifiers }) => {
  vi.stubGlobal('navigator', { userAgent: platform })
  await act(async () => root.render(<Test />))
  const bubbled = vi.fn()
  host.addEventListener('keydown', bubbled)
  const textarea = host.querySelector('textarea')!
  const key = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true, ...modifiers })
  await act(async () => {
    if (textarea.dispatchEvent(key)) {
      // 模拟未取消按键时系统继续派发的原生粘贴。
      const paste = new Event('paste', { bubbles: true })
      Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'first\r\nsecond\rthird' } })
      textarea.dispatchEvent(paste)
    }
  })
  expect(terminal.readClipboard).toHaveBeenCalledTimes(1)
  expect(terminal.paste).toHaveBeenCalledExactlyOnceWith('first\nsecond\nthird')
  expect(key.defaultPrevented).toBe(true)
  expect(bubbled).not.toHaveBeenCalled()
})

it('原生粘贴事件继续交给 xterm，不重复读取剪贴板', async () => {
  await act(async () => root.render(<Test />))
  const paste = new Event('paste', { bubbles: true })
  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'native paste' } })
  await act(async () => host.querySelector('textarea')!.dispatchEvent(paste))
  expect(terminal.paste).toHaveBeenCalledExactlyOnceWith('native paste')
  expect(terminal.readClipboard).not.toHaveBeenCalled()
})
