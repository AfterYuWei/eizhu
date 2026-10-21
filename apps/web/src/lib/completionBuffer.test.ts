import { describe, expect, it } from 'vitest'

import { extractInputFromLine, isTuiCommand, resyncFromTerminal } from './completionBuffer'

describe('completionBuffer', () => {
  it('detects tui commands behind shell prefixes', () => {
    expect(isTuiCommand('sudo vim /etc/hosts')).toBe(true)
    expect(isTuiCommand('command less README.md')).toBe(true)
    expect(isTuiCommand('sudo echo hello')).toBe(false)
  })

  it('strips prompt text from complex shell lines', () => {
    expect(extractInputFromLine('[12:34:56] user@host:/srv/app$ git status')).toMatchObject({
      text: 'git status',
    })
  })

  it('falls back to raw input when no prompt delimiter is found', () => {
    expect(extractInputFromLine('plain command without prompt')).toEqual({
      text: 'plain command without prompt',
      promptEnd: 0,
    })
  })
})

it('读取滚动后的实际光标行，避免取到旧缓冲', () => {
  const terminal = { buffer: { active: { baseY: 100, cursorY: 2, getLine: (row: number) => row === 102 ? { isWrapped: false, translateToString: () => 'user@host$ 中文命令' } : undefined } } }
  expect(resyncFromTerminal(() => terminal as unknown as import('@xterm/xterm').Terminal).text).toBe('中文命令')
})
