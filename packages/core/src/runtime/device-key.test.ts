import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDeviceKey } from './device-key.ts'
import type { KeyProtector } from './device-key.ts'
const fileOnly: KeyProtector = {
  available: () => false,
  wrap: () => {
    throw new Error()
  },
  unwrap: () => {
    throw new Error()
  },
  restrict: async () => {},
}
test('fresh restricted key persists privately and is reused; never reads an old app directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-key-test-'))
  try {
    const first = await loadDeviceKey(root, fileOnly),
      again = await loadDeviceKey(root, fileOnly)
    assert.equal(first.mode, 'restricted-file')
    assert.equal(first.key.length, 32)
    assert.deepEqual(first.key, again.key)
    if (process.platform !== 'win32')
      assert.equal((await stat(join(root, 'device-key.json'))).mode & 0o777, 0o600)
    first.key.fill(0)
    again.key.fill(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('locked system key is preserved, never falls back or generates a new key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-key-test-'))
  try {
    const protect: KeyProtector = {
      ...fileOnly,
      available: () => true,
      wrap: (value) => Buffer.from(value),
      unwrap: (value) => value.toString(),
    }
    const first = await loadDeviceKey(root, protect)
    first.key.fill(0)
    const before = await readFile(join(root, 'device-key.json'))
    await assert.rejects(loadDeviceKey(root, fileOnly), {
      error: { code: 'KEY_LOCKED', message: '设备密钥无法解锁，原数据已保留；请恢复密钥库访问后重试' },
    })
    assert.deepEqual(await readFile(join(root, 'device-key.json')), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('existing data without device key cannot initialize a replacement key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-key-test-'))
  try {
    await writeFile(join(root, 'global.sqlite'), 'synthetic')
    await assert.rejects(loadDeviceKey(root, fileOnly), /设备密钥缺失/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
