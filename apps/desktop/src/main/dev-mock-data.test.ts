import assert from 'node:assert/strict'
import test from 'node:test'
import { equal, portable } from '@eizhu/core/sync/model'
import { validateGraph } from '@eizhu/core/local/model'
import { createDevMockData, devMockEnabled, devMockIds } from './dev-mock-data.ts'

test('mock mode is explicit, unpackaged, local-renderer-only and separate from smoke acceptance', () => {
  assert.equal(devMockEnabled(undefined, true, undefined, false), false)
  assert.equal(devMockEnabled('1', false, 'http://127.0.0.1:5173/', false), true)
  for (const [packaged, rendererUrl, smoke] of [
    [true, 'http://127.0.0.1:5173/', false],
    [false, undefined, false],
    [false, 'https://example.invalid/', false],
    [false, 'http://127.0.0.1:5173/', true],
  ] as const) assert.throws(() => devMockEnabled('1', packaged, rendererUrl, smoke))
})

test('mock workspaces have valid independent graphs and cover identity, edits, deletion and local host trust', () => {
  const { offline, account, cloud } = createDevMockData()
  for (const payload of [offline, account, cloud]) validateGraph(payload)
  assert.equal(offline.profiles.length, 3)
  const localApp = account.profiles.find(p => p.id === devMockIds.application)!
  const remoteApp = cloud.profiles.find(p => p.id === devMockIds.application)!
  assert.notEqual(localApp.name, remoteApp.name)
  assert.equal(equal(localApp, remoteApp), false)
  const localDuplicate = account.profiles.find(p => p.id === devMockIds.sameNameLocal)!
  const cloudDuplicate = cloud.profiles.find(p => p.id === devMockIds.sameNameCloud)!
  assert.equal(localDuplicate.name, cloudDuplicate.name)
  assert.equal(localDuplicate.host, cloudDuplicate.host)
  assert.notEqual(localDuplicate.id, cloudDuplicate.id)
  assert(account.profiles.some(p => p.id === devMockIds.cloudDeleted))
  assert(!cloud.profiles.some(p => p.id === devMockIds.cloudDeleted))
  const localTrust = account.profiles.find(p => p.id === devMockIds.hostTrust)!
  const cloudTrust = cloud.profiles.find(p => p.id === devMockIds.hostTrust)!
  assert.equal(equal(localTrust, cloudTrust), true)
  assert(!JSON.stringify(portable('profile', localTrust)).includes('host_key_fingerprint'))
  assert(cloud.snippets.some(s => s.id === devMockIds.snippetDeleted))
  assert(account.profiles.every(p => p.name.startsWith('【MOCK】')))
  assert.notEqual(account.groups[0].name, offline.groups[0].name)
})
