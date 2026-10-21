const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/bridge', () => ({
  bridge: () =>
    new Proxy(
      {},
      {
        get: (_target, domain) =>
          new Proxy(
            {},
            {
              get: (_nested, method) => (input?: unknown) =>
                invoke(String(domain) + '.' + String(method), input),
            },
          ),
      },
    ),
}))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeCommandError } from '@eizhu/contracts'
import { snippetApi } from './snippet'

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => mockedInvoke.mockReset())

describe('snippetApi', () => {
  it('通过领域化 Tauri command 执行 CRUD', async () => {
    mockedInvoke.mockResolvedValueOnce([])
    await expect(snippetApi.list()).resolves.toEqual([])
    expect(mockedInvoke).toHaveBeenLastCalledWith('snippet.list', undefined)

    const request = { name: '磁盘', content: 'df -h' }
    mockedInvoke.mockResolvedValueOnce({ id: 's1', ...request })
    await snippetApi.create(request)
    expect(mockedInvoke).toHaveBeenLastCalledWith('snippet.create', { request })

    mockedInvoke.mockResolvedValueOnce({ id: 's1', ...request, name: '空间' })
    await snippetApi.update('s1', { name: '空间' })
    expect(mockedInvoke).toHaveBeenLastCalledWith('snippet.update', {
      id: 's1',
      request: { name: '空间' },
    })

    mockedInvoke.mockResolvedValueOnce(undefined)
    await snippetApi.delete('s1')
    expect(mockedInvoke).toHaveBeenLastCalledWith('snippet.delete', { id: 's1' })
  })

  it('保持 API 层结构化错误契约', async () => {
    const normalized = normalizeCommandError({
      code: 'VALIDATION',
      message: 'name and content are required',
    })
    expect(normalized.error).toEqual({
      code: 'VALIDATION',
      message: 'name and content are required',
    })
  })
})
