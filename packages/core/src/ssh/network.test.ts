import test from 'node:test'
import assert from 'node:assert/strict'
import { addressBytes } from './network.ts'
test('SOCKS destination encoding preserves IPv4, IPv6, mapped IPv4 and remote DNS', () => {
  assert.deepEqual([...addressBytes('127.0.0.1')], [1, 127, 0, 0, 1])
  const v6 = addressBytes('::1')
  assert.equal(v6.length, 17)
  assert.equal(v6[0], 4)
  assert.equal(v6.readUInt16BE(15), 1)
  const mapped = addressBytes('::ffff:127.0.0.1')
  assert.equal(mapped.readUInt16BE(11), 65535)
  assert.equal(mapped.readUInt16BE(13), 0x7f00)
  assert.equal(mapped.readUInt16BE(15), 1)
  assert.equal(addressBytes('example.invalid')[0], 3)
})
