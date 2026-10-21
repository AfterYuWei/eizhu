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

import { documentApi, pickDocumentText } from './document'

describe('documentApi', () => {
  beforeEach(() => invoke.mockReset())

  it('uses opaque references instead of content URIs', async () => {
    invoke
      .mockResolvedValueOnce([{ reference: 'document://token-1', name: 'id_ed25519', size: 12 }])
      .mockResolvedValueOnce('private key')
      .mockResolvedValueOnce(undefined)

    await expect(pickDocumentText(['text/plain'], 1024)).resolves.toBe('private key')
    expect(invoke).toHaveBeenNthCalledWith(1, 'document.pick', {
      multiple: false,
      mimeTypes: ['text/plain'],
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'document.readText', {
      reference: 'document://token-1',
      maxBytes: 1024,
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'document.release', {
      reference: 'document://token-1',
    })
  })

  it('releases a staged document even when decoding fails', async () => {
    invoke
      .mockResolvedValueOnce([{ reference: 'document://token-2', name: 'bad', size: 2 }])
      .mockRejectedValueOnce(new Error('encoding'))
      .mockResolvedValueOnce(undefined)

    await expect(pickDocumentText()).rejects.toThrow('encoding')
    expect(invoke).toHaveBeenLastCalledWith('document.release', {
      reference: 'document://token-2',
    })
  })

  it('exports text through the native destination picker', async () => {
    invoke.mockResolvedValue('content://saved')
    await documentApi.exportText('key', 'id_ed25519', 'application/x-pem-file')
    expect(invoke).toHaveBeenCalledWith('document.exportText', {
      content: 'key',
      suggestedName: 'id_ed25519',
      mimeType: 'application/x-pem-file',
    })
  })
})
