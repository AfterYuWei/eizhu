import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { SFTPWrapper } from 'ssh2'
import { FileEndpoint } from './endpoint.ts'

class Channel extends EventEmitter {
  position = 0
  writeAck?: (error?: Error) => void
  closeAck?: (error?: Error) => void
  open(_path: string, _flags: string, _mode: number, done: (error: null, handle: Buffer) => void) {
    done(null, Buffer.from('handle'))
  }
  write(_handle: Buffer, _data: Buffer, _offset: number, _length: number, position: number, done: (error?: Error) => void) {
    this.position = position
    this.writeAck = done
  }
  close(_handle: Buffer, done: (error?: Error) => void) { this.closeAck = done }
  destroy() { this.emit('close') }
}

test('远端写入和关闭都等待 ACK，超过 4 GiB 的偏移保持精确', async () => {
  const channel = new Channel(), endpoint = new FileEndpoint(channel as unknown as SFTPWrapper)
  const handle = await endpoint.open('/large.part', true, true)
  let written = false, closed = false
  const writing = handle.write(5 * 1024 ** 3 + 17, Buffer.from('abc')).then(() => { written = true })
  assert.equal(channel.position, 5 * 1024 ** 3 + 17)
  await Promise.resolve()
  assert.equal(written, false)
  channel.writeAck!()
  await writing
  const closing = handle.close().then(() => { closed = true })
  await Promise.resolve()
  assert.equal(closed, false)
  channel.closeAck!()
  await closing
  await endpoint.close()
})

test('远端 CLOSE 没有响应时 20 秒超时并关闭通道，禁止挂起到永远', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const channel = new Channel(), endpoint = new FileEndpoint(channel as unknown as SFTPWrapper)
  const handle = await endpoint.open('/large.part', true, true)
  const closing = handle.close()
  const rejected = assert.rejects(closing, /服务器 20 秒未响应/)
  t.mock.timers.tick(20_000)
  await rejected
  await assert.rejects(handle.write(0, Buffer.from('a')), /File session closed/)
  await endpoint.close()
})

test('写入使用 16 个有界并发包，乱序确认或单包失败都等待整批结束', async (t) => {
  const channel = new Channel(), endpoint = new FileEndpoint(channel as unknown as SFTPWrapper)
  const requests: Array<{ offset: number; length: number; done: (error?: Error) => void }> = []
  t.mock.method(channel, 'write', (_h: Buffer, _b: Buffer, _off: number, length: number, offset: number, done: (error?: Error) => void) => {
    requests.push({ offset, length, done })
  })
  const handle = await endpoint.open('/large.part', true, true)
  let settled = false
  const writing = handle.write(0, Buffer.alloc(512 * 1024)).finally(() => { settled = true })
  const rejected = assert.rejects(writing, /synthetic failure/)
  assert.equal(requests.length, 16)
  assert.ok(requests.every((r, i) => r.offset === i * 32768 && r.length === 32768))
  requests[15].done(new Error('synthetic failure'))
  await Promise.resolve()
  assert.equal(settled, false)
  for (const request of requests.slice(0, 15).reverse()) request.done()
  await rejected
  const closing = handle.close()
  channel.closeAck!()
  await closing
  await endpoint.close()
})

test('并发读取处理短读、乱序响应和非整块 EOF，不丢失字节', async () => {
  const bytes = Buffer.alloc(512 * 1024 - 17)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  class Reader extends Channel {
    lstat(_path: string, done: (error: null, attrs: unknown) => void) {
      done(null, { mode: 0o100600, size: bytes.length, mtime: 1, uid: 1, gid: 1 })
    }
    read(_h: Buffer, buffer: Buffer, offset: number, length: number, position: number, done: (error: Error | null, count: number) => void) {
      // Return shorter packets than requested, as allowed by SFTP.
      const data = bytes.subarray(position, position + Math.min(length, 4096))
      queueMicrotask(() => { data.copy(buffer, offset); done(null, data.length) })
    }
  }
  const channel = new Reader(), endpoint = new FileEndpoint(channel as unknown as SFTPWrapper)
  const handle = await endpoint.open('/large.bin')
  assert.deepEqual(await handle.read(0, 512 * 1024), bytes)
  assert.equal((await handle.read(bytes.length, 512 * 1024)).length, 0)
  const closing = handle.close()
  channel.closeAck!()
  await closing
  await endpoint.close()
})
