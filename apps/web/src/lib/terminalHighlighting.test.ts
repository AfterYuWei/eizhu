import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Terminal, type IDecoration, type IDecorationOptions } from '@xterm/xterm'
import { TerminalHighlighting } from './terminalHighlighting'
import { getTerminalHighlightColors, getTerminalTheme, terminalThemes } from './terminalThemes'

const osc = (code: string) => `\x1b]133;${code}\x07`
const prompt = osc('A') + 'user$ ' + osc('B')
const options = { theme: 'default', commands: true, logs: false }
let terminal: Terminal, highlighting: TerminalHighlighting
let frame: FrameRequestCallback | undefined
let spans: Map<IDecoration, IDecorationOptions>
const paint = () => { const callback = frame; frame = undefined; callback?.(0) }
const write = async (data: string | Uint8Array) => {
  await new Promise<void>((resolve) => {
    const subscription = terminal.onWriteParsed(() => { subscription.dispose(); resolve() })
    terminal.write(data)
  })
  paint()
}
const color = (row: number, column: number) => [...spans.values()].find((span) => span.marker.line === row
  && column >= (span.x ?? 0) && column < (span.x ?? 0) + (span.width ?? 1))?.foregroundColor
const text = () => Array.from({ length: terminal.buffer.normal.length }, (_, row) => terminal.buffer.normal.getLine(row)!.translateToString(true)).join('\n')

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined })
  terminal = new Terminal({ cols: 40, rows: 8, scrollback: 20, allowProposedApi: true })
  spans = new Map()
  const register = terminal.registerDecoration.bind(terminal)
  vi.spyOn(terminal, 'registerDecoration').mockImplementation((span) => {
    const decoration = register(span)
    if (decoration) {
      spans.set(decoration, span)
      decoration.onDispose(() => spans.delete(decoration))
    }
    return decoration
  })
  highlighting = new TerminalHighlighting(options)
  terminal.loadAddon(highlighting)
})
afterEach(() => { terminal.dispose(); vi.unstubAllGlobals(); frame = undefined })

it('所有预设主题的语义色达到 4.5:1 背景对比度，包括正文对比不足的 Solarized Light', () => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  for (const theme of terminalThemes) {
    const background = luminance(theme.theme.background!)
    const colors = getTerminalHighlightColors(theme.id)
    for (const color of Object.values(colors)) {
      const foreground = luminance(color)
      expect((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
    const rendered = getTerminalTheme(theme.id, true)
    if (theme.category === 'light') {
      const output = luminance(rendered.foreground!)
      expect((background + 0.05) / (output + 0.05)).toBeGreaterThanOrEqual(4.5)
      expect((output + 0.05) / (luminance(colors.command) + 0.05)).toBeGreaterThanOrEqual(3)
      expect(rendered.red).toBe(theme.theme.red)
      expect(rendered.blue).toBe(theme.theme.blue)
    } else expect(rendered).toBe(theme.theme)
    expect(getTerminalTheme(theme.id, false)).toBe(theme.theme)
  }
})

it('区分提示符、已提交命令与输出，并能立即恢复原色', async () => {
  await write(prompt + 'echo ERROR\r\n' + osc('C') + 'ERROR 数据库失败\r\n' + prompt)
  const colors = getTerminalHighlightColors('default')
  expect(color(0, 0)).toBeUndefined()
  expect(color(0, 6)).toBe(colors.command)
  expect(color(0, 11)).toBe(colors.command)
  expect(color(1, 0)).toBeUndefined()
  highlighting.update({ ...options, logs: true }); paint()
  expect(color(1, 0)).toBe(colors.error)
  expect(color(1, 6)).toBeUndefined()
  const original = text()
  highlighting.update({ ...options, commands: false }); paint()
  expect(spans.size).toBe(0)
  expect(text()).toBe(original)
  highlighting.update({ ...options, theme: 'one-light' }); paint()
  expect(color(0, 6)).toBe(getTerminalHighlightColors('one-light').command)
  expect([...spans.values()].every((span) => span.layer === 'bottom')).toBe(true)
})

it('跟随远端回显编辑与提示符重绘，不从本地按键生成内容', async () => {
  await write(prompt + 'systemctl status nginx')
  await write('\b\b\b\b\b\x1b[Kredis')
  expect(text()).toContain('systemctl status redis')
  expect(color(0, 27)).toBe(getTerminalHighlightColors('default').command)
  expect(color(0, 28)).toBeUndefined()
  await write('\r\x1b[2K' + prompt + 'ls')
  expect(color(0, 6)).toBe(getTerminalHighlightColors('default').command)
  expect(color(0, 8)).toBeUndefined()
  const original = text()
  terminal.input('local input is not an echo', true)
  paint()
  expect(text()).toBe(original)
})

it('保留 ANSI 前景色、隐藏及反色属性，日志只匹配大写完整等级词', async () => {
  highlighting.update({ ...options, logs: true })
  await write(prompt + '\x1b[35mecho\x1b[39m INFO\r\n' + osc('C')
    + '\x1b[32mERROR\x1b[39m ERROR_COUNT error INFO WARN WARNING FATAL DEBUG TRACE\r\n'
    + '\x1b[7mERROR\x1b[0m \x1b[8mWARN\x1b[0m')
  const colors = getTerminalHighlightColors('default')
  expect(color(0, 6)).toBeUndefined()
  expect(color(0, 11)).toBe(colors.command)
  expect(color(1, 0)).toBeUndefined()
  expect(color(1, 6)).toBeUndefined()
  expect(color(1, 18)).toBeUndefined()
  expect(color(1, 24)).toBe(colors.info)
  expect(color(1, 29)).toBe(colors.warning)
  expect(color(1, 34)).toBe(colors.warning)
  expect(color(2, 0)).toBe(colors.warning)
  expect([...spans.values()].some((span) => span.foregroundColor === colors.muted)).toBe(true)
  const last = terminal.buffer.normal.baseY + terminal.buffer.normal.cursorY
  expect(color(last, 0)).toBeUndefined()
  expect(color(last, 6)).toBeUndefined()
})

it('分片 OSC、Unicode、跨软换行的日志等级均能正确识别', async () => {
  highlighting.update({ ...options, logs: true })
  for (const part of ['\x1b]', '133;', 'A\x07user$ \x1b]133;', 'B\x1b', '\\']) await write(part)
  await write('echo 中文🧪\r\n' + osc('C') + ' '.repeat(38) + 'ERROR failed')
  const colors = getTerminalHighlightColors('default')
  expect(color(0, 11)).toBe(colors.command)
  expect(color(1, 38)).toBe(colors.error)
  expect(color(2, 0)).toBe(colors.error)
})

it('中文长命令的逻辑行锚点在窗口重排后仍指向命令文字', async () => {
  await write(prompt + 'echo ' + '中文路径'.repeat(8) + '\r\n' + osc('C') + 'done\r\n' + prompt)
  terminal.resize(23, 10); paint()
  const colors = getTerminalHighlightColors('default')
  let count = 0
  for (let row = 0; row < terminal.buffer.normal.length; row++) {
    const line = terminal.buffer.normal.getLine(row)!
    for (let column = 0; column < terminal.cols; column++) {
      if (['中', '文', '路', '径'].includes(line.getCell(column)!.getChars())) {
        expect(color(row, column)).toBe(colors.command)
        count++
      }
    }
  }
  expect(count).toBe(32)
  terminal.resize(80, 10); paint()
  expect(color(0, 6)).toBe(colors.command)
  expect(color(0, 0)).toBeUndefined()
})

it('提示符自身跨越中文宽字符换行时，强调色从实际命令开始', async () => {
  await write(osc('A') + '中'.repeat(41) + '$ ' + osc('B') + 'ls')
  const colors = getTerminalHighlightColors('default')
  expect(color(2, 2)).toBeUndefined()
  expect(color(2, 4)).toBe(colors.command)
  terminal.resize(60, 8); paint()
  const buffer = terminal.buffer.normal
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row)!
    for (let column = 0; column < terminal.cols; column++) {
      const chars = line.getCell(column)!.getChars()
      if (chars === '中' || chars === '$') expect(color(row, column)).toBeUndefined()
      if (chars === 'l' || chars === 's') expect(color(row, column)).toBe(colors.command)
    }
  }
})

it('续行提示符保持原色，程序内部交互与密码输入不作为命令着色', async () => {
  await write(prompt + "echo 'first\r\n" + osc('A;k=s') + '> ' + osc('B') + "中文'\r\n" + osc('C') + 'password: ')
  const colors = getTerminalHighlightColors('default')
  expect(color(0, 6)).toBe(colors.command)
  expect(color(1, 0)).toBeUndefined()
  expect(color(1, 2)).toBe(colors.command)
  terminal.input('secret\r', true); paint()
  expect(text()).not.toContain('secret')
  expect(color(2, 0)).toBeUndefined()
  await write('>>> print(1)')
  expect(color(2, 10)).toBeUndefined()
})

it('备用屏幕暂停着色，退出恢复；清屏和重连清理旧识别状态', async () => {
  await write(prompt + 'vim\r\n' + osc('C'))
  await write('\x1b[?1049hERROR')
  expect(spans.size).toBe(0)
  await write('\x1b[?1049l' + prompt + 'pwd')
  expect(color(0, 6)).toBe(getTerminalHighlightColors('default').command)
  await write('\x1b[2J\x1b[Hraw terminal')
  expect(spans.size).toBe(0)
  await write(prompt + 'ls')
  highlighting.reset(); terminal.reset(); paint()
  await write('plain unsupported shell$ echo hello')
  expect(spans.size).toBe(0)
})

it('持续输出只装饰可视区域，标记随滚动缓冲淘汰并在销毁时释放', async () => {
  await write(Array.from({ length: 200 }, (_, i) => prompt + `echo ${i}\r\n` + osc('C') + `${i}\r\n`).join(''))
  expect(terminal.markers.length).toBeLessThanOrEqual((terminal.rows + 20) * 3)
  expect([...spans.values()].every((span) => span.marker.line >= terminal.buffer.normal.viewportY)).toBe(true)
  // Repeated trim events move live markers even when the next run reuses the same row/key.
  for (let i = 0; i < 5; i++) {
    await write(prompt + `echo ${i}\r\n` + osc('C') + `${i}\r\n`)
    const buffer = terminal.buffer.normal
    expect(color(buffer.baseY + buffer.cursorY - 2, 6)).toBe(getTerminalHighlightColors('default').command)
    expect(color(buffer.baseY + buffer.cursorY - 1, 0)).toBeUndefined()
  }
  terminal.scrollToTop(); paint()
  expect(spans.size).toBeGreaterThan(0)
  expect([...spans.values()].every((span) => span.marker.line < terminal.buffer.normal.viewportY + terminal.rows)).toBe(true)
  highlighting.dispose()
  expect(terminal.markers.length).toBe(0)
  expect(spans.size).toBe(0)
})
