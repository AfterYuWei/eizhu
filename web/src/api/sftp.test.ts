// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { sftpApi } from './sftp'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'

afterEach(() => { invokeMock.mockReset(); vi.unstubAllGlobals(); })

describe('sftpApi', () => {
  it.each(['ask', 'overwrite', 'rename', 'skip'] as const)(
    '移动文档上传传递 %s 冲突策略',
    async (conflictResolution) => {
      invokeMock.mockResolvedValue({ tasks: [] })

      await sftpApi.uploadDocument('session-1', 'document://one', '/srv', conflictResolution)

      expect(invokeMock).toHaveBeenCalledWith('sftp_upload_document', {
        sessionId: 'session-1',
        reference: 'document://one',
        destDir: '/srv',
        conflictResolution,
      })
    },
  )

  it('通过细粒度 Tauri command 发起跨会话传输', async () => {
    const response = { task_id: 'tx-1', method: 'relay', tasks: [] }
    invokeMock.mockResolvedValue(response)

    await expect(
      sftpApi.transfer('source-1', 'target-1', ['/tmp/a.txt'], '/srv', 'overwrite', 'preserve'),
    ).resolves.toEqual(response)

    expect(invokeMock).toHaveBeenCalledWith('sftp_transfer', {
      sourceSessionId: 'source-1',
      targetSessionId: 'target-1',
      paths: ['/tmp/a.txt'],
      destDir: '/srv',
      conflictResolution: 'overwrite',
      directoryMode: 'preserve',
    })
  })

  it('上传逐块发送并等待 Rust 确认，不读取完整 ArrayBuffer', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 7).fill(3)
    const file = new File([bytes], '测试.bin')
    const arrayBuffer = vi.fn(() => { throw new Error('不应整文件读取') })
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer })
    Object.defineProperty(file, 'stream', {
      value: () => new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
    })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'sftp_upload_begin') {
        return { upload_id: 'ul-1', tasks: [{ id: 'tx-2', status: 'transferring' }] }
      }
      if (command === 'sftp_upload_finish') {
        return { tasks: [{ id: 'tx-2', status: 'completed' }] }
      }
      return { received: bytes.length }
    })
    const onTasks = vi.fn()

    const response = await sftpApi.upload('s1', [file], '/tmp', false, onTasks)

    expect(response.tasks).toEqual([{ id: 'tx-2', status: 'completed' }])
    expect(onTasks).toHaveBeenCalledWith([{ id: 'tx-2', status: 'transferring' }])
    expect(arrayBuffer).not.toHaveBeenCalled()
    const chunks = invokeMock.mock.calls.filter(([command]) => command === 'sftp_upload_chunk')
    expect(chunks).toHaveLength(3)
    expect(chunks.every(([, chunk]) => (chunk as Uint8Array).byteLength <= 512 * 1024)).toBe(true)
    expect(chunks[0][2].headers['x-eizhu-upload-id']).toBe('ul-1')
  })

  it('下载按 offset 拉取有界块并在 EOF 清理任务', async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5])
    invokeMock.mockImplementation(async (command: string, args: Record<string, number>) => {
      if (command === 'sftp_download_chunk') {
        return expected.slice(args.offset, args.offset + 2)
      }
      return undefined
    })

    const reader = sftpApi.streamDownloadFile('tx-3').getReader()
    const actual: number[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      actual.push(...value)
    }

    expect(actual).toEqual([...expected])
    const pulls = invokeMock.mock.calls.filter(([command]) => command === 'sftp_download_chunk')
    expect(pulls.map(([, args]) => args.offset)).toEqual([0, 2, 4, 5])
    expect(pulls.every(([, args]) => args.maxBytes === 512 * 1024)).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('sftp_download_close', { taskId: 'tx-3' })
  })

  it('合并浏览器小块，等待写入确认后才发下一块或提交', async () => {
    const bytes = Uint8Array.from({ length: 1024 * 1024 + 7 }, (_, index) => index % 251)
    const file = new File([bytes], 'large.bin')
    Object.defineProperty(file, 'stream', { value: () => new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          controller.enqueue(bytes.subarray(offset, offset + 64 * 1024))
        }
        controller.close()
      },
    }) })
    let acknowledge!: () => void
    const ack = new Promise<void>((resolve) => { acknowledge = resolve })
    const sent: Uint8Array[] = []
    invokeMock.mockImplementation(async (command: string, chunk: Uint8Array) => {
      if (command === 'sftp_upload_begin') return { upload_id: 'ul', tasks: [{ id: 'tx' }] }
      if (command === 'sftp_upload_chunk') {
        sent.push(chunk.slice())
        if (sent.length === 1) await ack
      }
      return { tasks: [{ id: 'tx', status: 'completed' }] }
    })
    const upload = sftpApi.upload('s', [file], '/')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(invokeMock.mock.calls.some(([name]) => name === 'sftp_upload_finish')).toBe(false)
    acknowledge()
    await upload
    expect(sent.map((chunk) => chunk.length)).toEqual([512 * 1024, 512 * 1024, 7])
    const actual = new Uint8Array(bytes.length)
    let offset = 0
    for (const chunk of sent) { actual.set(chunk, offset); offset += chunk.length }
    expect(actual.findIndex((byte, index) => byte !== bytes[index])).toBe(-1)
    expect(invokeMock.mock.calls.filter(([name]) => name === 'sftp_upload_chunk')
      .map(([, , options]) => options.headers['x-eizhu-chunk-sequence'])).toEqual(['0', '1', '2'])
    expect(invokeMock.mock.calls.at(-1)![0]).toBe('sftp_upload_finish')
  })
})


describe('上传恢复与空间保护', () => {
  it('恢复只检查元数据，不读取原文件计算旧检查点摘要', async () => {
    const file = new File(['done'], 'a', { lastModified: 10 })
    const slice = vi.fn(() => { throw new Error('不应回读已传内容') })
    Object.defineProperty(file, 'slice', { value: slice })
    invokeMock.mockImplementation(async (command) => command === 'sftp_upload_checkpoint'
      ? { size: 4, last_modified: 10, blocks: [{ length: 4, sha256: 'legacy-digest' }] }
      : { upload_id: '', tasks: [{ id: 'tx', status: 'completed' }], received: 4, sequence: 1 })
    await expect(sftpApi.resumeUpload('tx', file)).resolves.toEqual({ tasks: [{ id: 'tx', status: 'completed' }] })
    expect(slice).not.toHaveBeenCalled()
    expect(invokeMock.mock.calls.find(([name]) => name === 'sftp_resume_upload')![1]).not.toHaveProperty('digests')
  })

  it('源文件身份不符时不发起恢复、不自行提交偏移', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    invokeMock.mockResolvedValue({ size: 3, last_modified: 10, blocks: [] })
    await expect(sftpApi.resumeUpload('tx', new File(['abc'], 'a', { lastModified: 20 }))).rejects.toThrow('修改时间')
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['sftp_upload_checkpoint'])
  })
  it.each([undefined, null])('兼容未记录修改时间的旧检查点：%s', async (lastModified) => {
    invokeMock.mockImplementation(async (command) => command === 'sftp_upload_checkpoint'
      ? { size: 4, last_modified: lastModified, blocks: [] }
      : { upload_id: '', tasks: [{ id: 'tx', status: 'completed' }], received: 4, sequence: 1 })
    await expect(sftpApi.resumeUpload('tx', new File(['done'], 'a'))).resolves.toEqual({ tasks: [{ id: 'tx', status: 'completed' }] })
  })
  it('提交已完成时不重放输入或发送原始文件', async () => {
    invokeMock.mockImplementation(async (command) => command === 'sftp_upload_checkpoint'
      ? { size: 0, last_modified: 10, blocks: [] }
      : { upload_id: '', tasks: [{ id: 'tx', status: 'completed' }], received: 0, sequence: 0 })
    expect(await sftpApi.resumeUpload('tx', new File([], 'a', { lastModified: 10 }))).toEqual({ tasks: [{ id: 'tx', status: 'completed' }] })
    const args = invokeMock.mock.calls.find(([name]) => name === 'sftp_resume_upload')![1]
    expect(args).not.toHaveProperty('digests')
    expect(args).not.toHaveProperty('offset')
  })
  it('空间切换后不发送剩余原始数据，也不操作新空间的任务', async () => {
    setWorkspaceGeneration(5)
    const file = new File(['a'], 'a')
    Object.defineProperty(file, 'stream', { value: () => new ReadableStream({ start(controller) {
      setWorkspaceGeneration(6); controller.enqueue(new Uint8Array([1])); controller.close()
    } }) })
    invokeMock.mockResolvedValue({ upload_id: 'ul', tasks: [{ id: 'tx' }] })
    await expect(sftpApi.upload('s', [file], '/')).rejects.toThrow('空间已切换')
    expect(invokeMock.mock.calls.map(([name]) => name)).toEqual(['sftp_upload_begin'])
  })
})
