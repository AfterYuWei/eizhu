// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { queryHistory, readLegacyHistory, reliableHistoryCommand } from './commandHistory'
import { useHistoryStore } from '@/store/history'

function terminal(line: string, type = 'normal'): Terminal {
  return { buffer: { active: { type, baseY: 10, cursorY: 0, getLine: (row: number) => row === 10 ? { isWrapped: false, translateToString: () => line } : undefined } } } as unknown as Terminal
}
beforeEach(() => { localStorage.clear(); useHistoryStore.setState(useHistoryStore.getInitialState(), true) })
it('records only echoed input in a recognizable prompt in the normal buffer', () => {
  const buffer = { text: 'echo 中文', cursor: 7, stale: false }
  expect(reliableHistoryCommand(buffer, terminal('user@host:~$ echo 中文'))).toBe('echo 中文')
  expect(reliableHistoryCommand(buffer, terminal('Password: '))).toBeNull()
  expect(reliableHistoryCommand(buffer, terminal('$ echo 中文', 'alternate'))).toBeNull()
  expect(reliableHistoryCommand({ ...buffer, stale: true }, terminal('$ echo 中文'))).toBeNull()
  expect(reliableHistoryCommand({ ...buffer, text: ' echo 中文' }, terminal('$ echo 中文'))).toBeNull()
  expect(reliableHistoryCommand({ ...buffer, text: 'echo one\necho two' }, terminal('$ echo one'))).toBeNull()
})
it('legacy history stays pending and suggestions are isolated by server', () => {
  localStorage.setItem('eizhu-cmd-history', JSON.stringify({ entries: [{ command: 'cd /private', lastAt: Date.now(), count: 2 }] }))
  expect(readLegacyHistory()).toHaveLength(1)
  expect(queryHistory('a', '/private')).toEqual([])
  expect(localStorage.getItem('eizhu-cmd-history')).not.toBeNull()
  useHistoryStore.setState({ entries: { a: [{ id: '1', command: 'cd /private', cwd: '/', count: 1, lastAt: Date.now() }] } })
  expect(queryHistory('b', '/private')).toEqual([])
  expect(queryHistory('a', '/private')).toHaveLength(1)
})
