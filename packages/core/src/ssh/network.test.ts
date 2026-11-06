import test from 'node:test'
import assert from 'node:assert/strict'
import { addressBytes, connectionError } from './network.ts'
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

test('connection diagnostics retain recognized causes and never serialize raw library errors', () => {
  for (const [code, expected] of [
    ['ENOTFOUND', 'SSH_DNS_FAILED'],
    ['EAI_AGAIN', 'SSH_DNS_FAILED'],
    ['ECONNREFUSED', 'SSH_CONNECTION_REFUSED'],
    ['EHOSTUNREACH', 'SSH_NETWORK_UNREACHABLE'],
    ['ENETUNREACH', 'SSH_NETWORK_UNREACHABLE'],
    ['ETIMEDOUT', 'SSH_TIMEOUT'],
    ['ECONNRESET', 'SSH_CONNECTION_RESET'],
    ['EPIPE', 'SSH_CONNECTION_RESET'],
  ]) {
    const error = connectionError({ code, message: 'password=synthetic-secret' })
    assert.equal(error.error.code, expected)
    assert.ok(!error.message.includes('synthetic-secret'))
  }
  assert.equal(
    connectionError({ code: 'ECONNREFUSED', message: '' }, true).error.code,
    'PROXY_CONNECTION_REFUSED',
  )
  assert.equal(connectionError({ level: 'client-authentication', message: '' }).error.code, 'SSH_AUTH_FAILED')
  assert.equal(connectionError({ level: 'client-timeout', message: '' }).error.code, 'SSH_TIMEOUT')
  assert.equal(
    connectionError({ message: 'Handshake failed: no matching key exchange algorithm' }).error.code,
    'SSH_NEGOTIATION_FAILED',
  )
  const unknown = connectionError({ message: 'unknown error with synthetic-secret' })
  assert.equal(unknown.error.code, 'SSH_CONNECTION_FAILED')
  assert.ok(!unknown.message.includes('synthetic-secret'))
})
