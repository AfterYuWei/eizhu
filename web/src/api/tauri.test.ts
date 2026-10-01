// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { normalizeCommandError } from './tauri'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

describe('Tauri 结构化错误', () => {
  it('保留重试、会话、阶段与详情上下文', () => {
    const error = normalizeCommandError({
      code: 'BACKGROUND_LIMIT',
      message: 'window expired',
      retryable: true,
      session_id: 'session-1',
      stage: 'background',
      details: { remaining_seconds: 0 },
    })
    expect(error.error.code).toBe('BACKGROUND_LIMIT')
    expect(error.retryable).toBe(true)
    expect(error.sessionId).toBe('session-1')
    expect(error.stage).toBe('background')
    expect(error.details).toEqual({ remaining_seconds: 0 })
  })
})

// A response from the previous account must never enter the new workspace's stores.
describe('账号空间 IPC 隔离', () => {
  it('丢弃空间切换前发出的业务响应', async () => {
    const { invokeCommand } = await import('./tauri')
    const { setWorkspaceGeneration } = await import('@/lib/workspaceScope')
    const spy = invokeMock.mockReset()
    let finish!: (value: string[]) => void
    spy.mockImplementation(() => new Promise<string[]>((resolve) => { finish = resolve }))
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    setWorkspaceGeneration(10)
    const request = invokeCommand('profile_list')
    expect(spy).toHaveBeenCalledWith('profile_list', { workspaceGeneration: 10 })
    setWorkspaceGeneration(11)
    finish(['old account'])
    await expect(request).rejects.toMatchObject({ error: { code: 'WORKSPACE_CHANGED' } })
    spy.mockReset()
  })

  it('本地空间导入携带预期账号空间代次', async () => {
    const { invokeCommand } = await import('./tauri')
    const { setWorkspaceGeneration } = await import('@/lib/workspaceScope')
    const spy = invokeMock.mockReset().mockResolvedValue(undefined)
    setWorkspaceGeneration(12)
    await invokeCommand('workspace_import_local')
    expect(spy).toHaveBeenCalledWith('workspace_import_local', { workspaceGeneration: 12 })
    spy.mockReset()
  })
})
