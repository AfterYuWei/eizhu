import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import ssh2 from 'ssh2'
import { FileEndpoint } from '../packages/core/src/sftp/endpoint.ts'
import { SFTP_TRANSFER_CHUNK_BYTES } from '../packages/contracts/src/sftp.ts'

// A synthetic SFTP peer with a fixed per-response delay isolates window/RTT
// effects from disks and IPC. OpenSSH + Electron acceptance: desktop:smoke:sftp.
const bytes = 32 * 1024 * 1024 + 17, responseDelayMs = 40
const { Client, Server, utils } = ssh2
const host = utils.generateKeyPairSync('ed25519')
const server = new Server({ hostKeys: [host.private] }, (peer) => {
  peer.setNoDelay(true)
  peer.on('error', () => undefined)
  peer.on('authentication', (context) => context.accept())
  peer.on('ready', () => peer.on('session', (accept) => {
    accept().on('sftp', (accept) => {
      const sftp = accept(), data = Buffer.alloc(bytes), timers = new Set()
      const reply = (work) => {
        const timer = setTimeout(() => { timers.delete(timer); work() }, responseDelayMs)
        timers.add(timer)
      }
      sftp.on('error', () => undefined)
      sftp.once('close', () => {
        for (const timer of timers) clearTimeout(timer)
        sftp.end()
      })
      sftp.on('LSTAT', (id) => sftp.attrs(id, { mode: 0o100600, size: bytes, mtime: 1, uid: 1, gid: 1 }))
      sftp.on('OPEN', (id) => sftp.handle(id, Buffer.from('handle')))
      sftp.on('CLOSE', (id) => sftp.status(id, 0))
      sftp.on('WRITE', (id, _handle, offset, block) => {
        block.copy(data, offset)
        reply(() => sftp.status(id, 0))
      })
      sftp.on('READ', (id, _handle, offset, length) => reply(() => {
        const block = data.subarray(offset, offset + length)
        if (block.length) sftp.data(id, block)
        else sftp.status(id, 1)
      }))
    })
  }))
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const measurements = []
try {
  for (const blockBytes of [512 * 1024, SFTP_TRANSFER_CHUNK_BYTES]) {
    console.error(`SFTP benchmark: ${blockBytes} bytes/window`)
    const client = new Client()
    let endpoint, handle
    try {
      await new Promise((resolve, reject) => client.once('ready', resolve).once('error', reject).connect({
        host: '127.0.0.1', port: server.address().port, username: 'synthetic', password: 'synthetic',
      }))
      client.setNoDelay(true)
      const channel = await new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)))
      endpoint = new FileEndpoint(channel)
      const block = Buffer.alloc(blockBytes, 91), expected = createHash('sha256')
      handle = await endpoint.open('/large.bin', true, true)
      let started = performance.now()
      for (let offset = 0; offset < bytes; offset += block.length) {
        const data = block.subarray(0, Math.min(block.length, bytes - offset))
        await handle.write(offset, data)
        expected.update(data)
      }
      await handle.close()
      const uploadMs = performance.now() - started
      console.error(`SFTP upload: ${uploadMs.toFixed(0)} ms`)
      handle = await endpoint.open('/large.bin')
      const actual = createHash('sha256')
      started = performance.now()
      for (let offset = 0; offset < bytes;) {
        const data = await handle.read(offset, Math.min(block.length, bytes - offset))
        assert.ok(data.length > 0, 'Unexpected EOF')
        actual.update(data)
        offset += data.length
      }
      await handle.close()
      const downloadMs = performance.now() - started
      console.error(`SFTP download: ${downloadMs.toFixed(0)} ms`)
      assert.equal(actual.digest('hex'), expected.digest('hex'))
      measurements.push({ blockBytes, bytes, responseDelayMs, sha256: true,
        uploadMiBs: bytes / 1024 ** 2 / (uploadMs / 1000), downloadMiBs: bytes / 1024 ** 2 / (downloadMs / 1000) })
    } finally {
      await handle?.close()
      await endpoint?.close()
      await new Promise((resolve) => { client.once('close', resolve); client.destroy() })
    }
  }
  console.log(JSON.stringify({ synthetic: true, measurements }, null, 2))
} finally {
  await new Promise((resolve) => server.close(resolve))
}
