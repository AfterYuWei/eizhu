import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { invokeCommand } from './tauri'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { syncApi } from './sync'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const mocked = vi.mocked(invoke)
beforeEach(() => { mocked.mockReset(); setWorkspaceGeneration(1); vi.stubGlobal('window', { __TAURI_INTERNALS__: {} }) })
describe('账号同步与空间隔离', () => {
  it('逐条解决冲突绑定用户看到的云端修订号', async () => {
    mocked.mockResolvedValue(undefined)
    await syncApi.resolveConflict('profile', 'server-1', 'keep_local', 4)
    expect(mocked).toHaveBeenCalledWith('sync_resolve_conflict', { itemType: 'profile', itemId: 'server-1', choice: 'keep_local', remoteRevision: 4, workspaceGeneration: 1 })
  })
  it('账号切换后丢弃原空间尚未返回的结果', async () => {
    let resolve!: (value: unknown) => void
    mocked.mockImplementation(() => new Promise((done) => { resolve = done }) as ReturnType<typeof invoke>)
    const result = invokeCommand('profile_list')
    setWorkspaceGeneration(2); resolve([{ id: 'old-account' }])
    await expect(result).rejects.toMatchObject({ error: { code: 'WORKSPACE_CHANGED' } })
  })
  it('实时同步接口不访问备份版本或第三方云', async () => {
    mocked.mockResolvedValue(undefined)
    await syncApi.status(); await syncApi.syncNow(); await syncApi.unlock('password'); await syncApi.preview(); await syncApi.bootstrap('preview-token', 'merge')
    expect(mocked.mock.calls.map(([command]) => command)).toEqual(['sync_status', 'sync_now', 'sync_unlock', 'sync_preview', 'sync_bootstrap'])
  })
})
