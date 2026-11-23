import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Terminal, type IDecoration, type IDecorationOptions } from '@xterm/xterm'
import { TerminalHighlighting } from './terminalHighlighting'
import { getTerminalHighlightColors, getTerminalTheme, terminalThemes } from './terminalThemes'

const osc = (code: string) => `\x1b]133;${code}\x07`
const prompt = osc('A') + 'user$ ' + osc('B')
const options = { theme: 'default', logs: false }
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
const color = (row: number, column: number) => [...spans.values()].find((span) => span.foregroundColor && span.marker.line === row
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

it('所有预设保留原配色，日志语义色达到 4.5:1 背景对比度', () => {
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
    expect(getTerminalTheme(theme.id)).toBe(theme.theme)
  }
})

it('命令和普通输出保留原配色，仅按开关为日志等级补色且没有右侧提示条', async () => {
  await write(prompt + 'echo ERROR\r\n' + osc('C') + 'ERROR 数据库失败\r\n' + prompt)
  expect(spans.size).toBe(0)
  const original = text()
  highlighting.update({ ...options, logs: true }); paint()
  expect(color(0, 6)).toBeUndefined()
  expect(color(1, 0)).toBe(getTerminalHighlightColors('default').error)
  expect([...spans.values()].every((span) => span.anchor !== 'right' && span.layer === 'bottom')).toBe(true)
  highlighting.update({ ...options, theme: 'one-light', logs: true }); paint()
  expect(color(1, 0)).toBe(getTerminalHighlightColors('one-light').error)
  highlighting.update(options); paint()
  expect(spans.size).toBe(0)
  expect(text()).toBe(original)
})

it('保留 ANSI、隐藏及反色，日志仅匹配大写完整等级词', async () => {
  highlighting.update({ ...options, logs: true })
  await write(prompt + '\x1b[35mecho\x1b[39m INFO\r\n' + osc('C')
    + '\x1b[32mERROR\x1b[39m ERROR_COUNT error INFO WARN WARNING FATAL DEBUG TRACE\r\n'
    + '\x1b[7mERROR\x1b[0m \x1b[8mWARN\x1b[0m')
  const colors = getTerminalHighlightColors('default')
  expect(terminal.buffer.normal.getLine(0)!.getCell(6)!.getFgColor()).toBe(5)
  expect(color(0, 6)).toBeUndefined()
  expect(color(0, 11)).toBeUndefined()
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

it('分片 OSC、Unicode 和跨软换行日志保留边界', async () => {
  highlighting.update({ ...options, logs: true })
  for (const part of ['\x1b]', '133;', 'A\x07user$ \x1b]133;', 'B\x1b', '\\']) await write(part)
  await write('echo 中文🧪\r\n' + osc('C') + ' '.repeat(38) + 'ERROR failed')
  const colors = getTerminalHighlightColors('default')
  expect(color(0, 11)).toBeUndefined()
  expect(color(1, 38)).toBe(colors.error)
  expect(color(2, 0)).toBe(colors.error)
})

it('长中文命令在窗口重排后仍与日志输出分离', async () => {
  highlighting.update({ ...options, logs: true })
  await write(prompt + 'echo ' + '中文路径'.repeat(8) + '\r\n' + osc('C') + 'ERROR failed\r\n' + prompt)
  for (const cols of [23, 80]) {
    terminal.resize(cols, 10); paint()
    expect([...spans.values()].reduce((sum, span) => sum + (span.width ?? 1), 0)).toBe(5)
    expect([...spans.values()].every((span) => span.foregroundColor === getTerminalHighlightColors('default').error)).toBe(true)
  }
})

it('续行与密码输入不产生装饰或本地回显', async () => {
  highlighting.update({ ...options, logs: true })
  await write(prompt + "echo 'ERROR\r\n" + osc('A;k=s') + '> ' + osc('B') + "中文'\r\n" + osc('C') + 'password: ')
  expect(spans.size).toBe(0)
  terminal.input('secret\r', true); paint()
  expect(text()).not.toContain('secret')
  await write('\r\nERROR failed\r\n' + prompt)
  expect([...spans.values()].reduce((sum, span) => sum + (span.width ?? 1), 0)).toBe(5)
})

it('备用屏幕暂停日志装饰，清屏和重连清理旧状态', async () => {
  highlighting.update({ ...options, logs: true })
  await write(prompt + 'vim\r\n' + osc('C') + 'ERROR failed')
  expect(spans.size).toBeGreaterThan(0)
  await write('\x1b[?1049hERROR')
  expect(spans.size).toBe(0)
  await write('\x1b[?1049l')
  expect(spans.size).toBeGreaterThan(0)
  await write('\x1b[2J\x1b[Hraw terminal')
  expect(spans.size).toBe(0)
  highlighting.reset(); terminal.reset(); paint()
  await write('plain unsupported shell$ echo hello')
  expect(spans.size).toBe(0)
})

it('持续输出只装饰可视区域，滚动与销毁时正确释放', async () => {
  highlighting.update({ ...options, logs: true })
  await write(prompt + 'long-running\r\n' + osc('C') + 'ERROR output\r\n'.repeat(100))
  expect(spans.size).toBeGreaterThan(0)
  await write(Array.from({ length: 200 }, (_, i) => prompt + `echo ${i}\r\n` + osc('C') + `ERROR ${i}\r\n`).join(''))
  expect(terminal.markers.length).toBeLessThanOrEqual((terminal.rows + 20) * 3)
  expect([...spans.values()].every((span) => span.marker.line >= terminal.buffer.normal.viewportY)).toBe(true)
  terminal.scrollToTop(); paint()
  expect(spans.size).toBeGreaterThan(0)
  expect([...spans.values()].every((span) => span.marker.line < terminal.buffer.normal.viewportY + terminal.rows)).toBe(true)
  highlighting.dispose()
  expect(terminal.markers.length).toBe(0)
  expect(spans.size).toBe(0)
})
