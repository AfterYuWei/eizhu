import { expect, it, vi } from 'vitest'
import { dirtyEditorTabs, saveBeforeEditorClose } from './editorCloseGuard'
it('checks all dirty tabs and stops closing when any save fails', async () => {
  const tabs = [{ id: 'a', content: 'changed', originalContent: '' }, { id: 'b', content: 'changed', originalContent: '' }]
  expect(dirtyEditorTabs({ kind: 'workspace', requestId: 'r' }, tabs)).toHaveLength(2)
  const save = vi.fn(async (id: string) => { if (id === 'b') return false; tabs[0].originalContent = 'changed'; return true })
  expect(await saveBeforeEditorClose({ kind: 'window' }, () => tabs, save)).toBe(false)
  expect(save.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
})
it('rechecks edits that occur during save and limits tab close to its own tab', async () => {
  const tabs = [{ id: 'a', content: 'first', originalContent: '' }, { id: 'b', content: 'dirty', originalContent: '' }]
  const save = async () => { tabs[0].originalContent = 'first'; tabs[0].content = 'typed while saving'; return true }
  expect(await saveBeforeEditorClose({ kind: 'application' }, () => tabs, save)).toBe(false)
  tabs[0].content = 'first'
  expect(await saveBeforeEditorClose({ kind: 'tab', tabId: 'a' }, () => tabs, vi.fn())).toBe(true)
})
