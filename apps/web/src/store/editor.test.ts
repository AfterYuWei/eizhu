import { beforeEach, expect, it, vi } from 'vitest'
import { editApi } from '@/api/edit'
import { useEditorStore } from './editor'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
vi.mock('@/api/edit', () => ({ editApi: { readFile: vi.fn(), writeFile: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
const remote = { path: '/f', content: 'opening', size: 7, mod_time: 't1', content_hash: 'h1', language: 'plaintext', line_ending: 'lf' as const, read_only: false }
beforeEach(() => { vi.resetAllMocks(); setWorkspaceGeneration(1); useEditorStore.setState(useEditorStore.getInitialState(), true); vi.mocked(editApi.readFile).mockResolvedValue(remote) })
async function open() { await useEditorStore.getState().openFile('session', 'sftp', '/f'); return useEditorStore.getState().tabs[0].id }
it('failed saves preserve local content; repeated conflicts require a new manual merge', async () => {
  const id = await open()
  useEditorStore.getState().setContent(id, 'local')
  vi.mocked(editApi.writeFile).mockRejectedValue({ error: { code: 'FILE_MODIFIED', message: 'changed' } })
  vi.mocked(editApi.readFile).mockResolvedValue({ ...remote, content: 'latest', content_hash: 'h2', mod_time: 't2' })
  expect(await useEditorStore.getState().saveFile(id)).toBe(false)
  let tab = useEditorStore.getState().tabs[0]
  expect(tab.content).toBe('local')
  expect(tab.mergePreview).toMatchObject({ openingContent: 'opening', localContent: 'local', remoteContent: 'latest' })
  useEditorStore.getState().mergeFile(id, 'manually merged')
  vi.mocked(editApi.readFile).mockResolvedValue({ ...remote, content: 'changed again', content_hash: 'h3', mod_time: 't3' })
  expect(await useEditorStore.getState().saveFile(id)).toBe(false)
  expect(editApi.writeFile).toHaveBeenLastCalledWith('session', '/f', expect.objectContaining({ content: 'manually merged', expected_content_hash: 'h2', expected_mod_time: 't2' }))
  tab = useEditorStore.getState().tabs[0]
  expect(tab.content).toBe('manually merged')
  expect(tab.mergePreview?.remoteContent).toBe('changed again')
})
it('successful save confirms only submitted content and keeps edits made while saving dirty', async () => {
  const id = await open(); useEditorStore.getState().setContent(id, 'submitted')
  let finish!: (value: { path: string; size: number; mod_time: string }) => void
  vi.mocked(editApi.writeFile).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const pending = useEditorStore.getState().saveFile(id)
  useEditorStore.getState().setContent(id, 'new edit')
  finish({ path: '/f', size: 9, mod_time: 'new' }); expect(await pending).toBe(true)
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'new edit', originalContent: 'submitted' })
})
it('cancelled comparison preserves the original optimistic token and save-as requires a new target', async () => {
  const id = await open(); useEditorStore.getState().setContent(id, 'local')
  vi.mocked(editApi.readFile).mockResolvedValue({ ...remote, mod_time: 'new', content_hash: 'new', content: 'remote' })
  await useEditorStore.getState().compareFile(id); useEditorStore.getState().dismissMerge(id)
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'local', modTime: 't1', contentHash: 'h1' })
  vi.mocked(editApi.writeFile).mockResolvedValue({ path: '/f.copy', mod_time: 'copy', size: 5 })
  expect(await useEditorStore.getState().saveAs(id, '/f.copy')).toBe(true)
  expect(editApi.writeFile).toHaveBeenLastCalledWith('session', '/f.copy', expect.objectContaining({ create_new: true, expected_mod_time: '' }))
  expect(useEditorStore.getState().tabs[0].path).toBe('/f.copy')
})
it('old workspace read results cannot restore closed editor state', async () => {
  let finish!: (value: typeof remote) => void
  vi.mocked(editApi.readFile).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  const pending = useEditorStore.getState().openFile('old', 'sftp', '/old')
  setWorkspaceGeneration(2); useEditorStore.getState().closeAll(); finish(remote); await pending
  expect(useEditorStore.getState().tabs).toEqual([])
})
