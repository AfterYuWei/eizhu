import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { TerminalStream } from './stream.ts'
class Port extends EventEmitter {
  messages: Array<{ type: string; offset: number; bytes?: Uint8Array }> = []
  closed = false
  start() {}
  postMessage(m: unknown) {
    this.messages.push(m as (typeof this.messages)[number])
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }
}
const tick = () => new Promise((r) => setTimeout(r, 60))
test('binary terminal waits for real byte acknowledgements and keeps replay bounded', async () => {
  const flow: boolean[] = [],
    stream = new TerminalStream((p) => flow.push(p)),
    port = new Port()
  stream.bind(port)
  stream.output(Buffer.alloc(1024 * 1024, 7))
  await tick()
  let packets = port.messages.filter((m) => m.type === 'data')
  assert.equal(
    packets.reduce((n, p) => n + p.bytes!.length, 0),
    65536,
  )
  assert.ok(flow.includes(true))
  assert.equal(stream.bufferedBytes, 1024 * 1024)
  port.emit('message', { data: { type: 'ack', offset: packets[0].offset } })
  await tick()
  packets = port.messages.filter((m) => m.type === 'data')
  assert.equal(packets.length, 3)
  port.emit('message', { data: { type: 'ack', offset: 999999999 } })
  assert.equal(port.closed, true)
  stream.output(Buffer.alloc(2 * 1024 * 1024))
  assert.equal(stream.bufferedBytes, 1024 * 1024)
  const next = new Port()
  stream.bind(next)
  assert.ok(next.messages[0].offset > 0)
  stream.close()
})
test('replacing a terminal port cannot retain an old consumer', () => {
  const stream = new TerminalStream(() => {}),
    old = new Port(),
    next = new Port()
  stream.bind(old)
  stream.bind(next)
  assert.equal(old.closed, true)
  assert.equal(next.closed, false)
  stream.close()
  assert.equal(next.closed, true)
})
