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
import { vaultApi } from './vault'

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => mockedInvoke.mockReset())

describe('vaultApi', () => {
  it('通过领域化 Tauri command 执行凭据操作', async () => {
    mockedInvoke.mockResolvedValueOnce([])
    await vaultApi.list({ type: 'password', q: '生产' })
    expect(mockedInvoke).toHaveBeenLastCalledWith('vault.list', {
      vaultType: 'password',
      q: '生产',
    })

    mockedInvoke.mockResolvedValueOnce({ id: 'v1' })
    const request = {
      name: 'root',
      type: 'password' as const,
      username: 'root',
      password: 'secret',
    }
    await vaultApi.create(request)
    expect(mockedInvoke).toHaveBeenLastCalledWith('vault.create', { request })

    await vaultApi.update('v1', request)
    expect(mockedInvoke).toHaveBeenLastCalledWith('vault.update', {
      id: 'v1',
      request,
    })

    await vaultApi.reveal('v1')
    expect(mockedInvoke).toHaveBeenLastCalledWith('vault.reveal', { id: 'v1' })

    await vaultApi.references('v1')
    expect(mockedInvoke).toHaveBeenLastCalledWith('vault.references', { id: 'v1' })

    await vaultApi.delete('v1')
    expect(mockedInvoke).toHaveBeenLastCalledWith('vault.delete', { id: 'v1' })
  })

  it('使用 Rust 生成 OpenSSH 密钥对并保留删除引用详情', async () => {
    const request = { algo: 'ed25519' as const, passphrase: 'secret' }
    await vaultApi.generateKeyPair(request)
    expect(mockedInvoke).toHaveBeenLastCalledWith('vault.generateKeyPair', {
      request,
    })

    const normalized = normalizeCommandError({
      code: 'IN_USE',
      message: 'vault entry is referenced by profiles',
      references: [{ id: 'p1', name: '生产服务器' }],
    })
    expect(normalized.error.code).toBe('IN_USE')
    expect(normalized.references).toEqual([{ id: 'p1', name: '生产服务器' }])
  })
})
