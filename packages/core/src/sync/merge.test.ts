import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DesktopError, syncResolveBatchSchema } from '@eizhu/contracts'
import { payloadSchema } from '../local/model.ts'
import { mergeConflictValue } from './merge.ts'
import { summary } from './model.ts'

const profile = payloadSchema.parse({
  profiles: [
    {
      id: 'profile',
      name: '服务器',
      host: '192.0.2.1',
      port: 22,
      username: 'deploy',
      auth_type: 'password',
      inline_credential: { password: 'synthetic-local' },
      options: '{}',
      note: '本机备注',
      sort_order: 0,
    },
  ],
}).profiles[0]
const cloud = {
  ...profile,
  host: '192.0.2.2',
  note: '云端备注',
  inline_credential: { password: 'synthetic-cloud' },
}
const failure = (code: string) => (error: unknown) =>
  error instanceof DesktopError && error.error.code === code

test('field merging chooses independently while credentials never cross the summary boundary', () => {
  const merged = mergeConflictValue('profile', profile, cloud, {
    host: 'local',
    note: 'cloud',
    credential_changed: 'cloud',
  })
  assert.equal('host' in merged ? merged.host : '', profile.host)
  assert.equal('note' in merged ? merged.note : '', cloud.note)
  assert.deepEqual('inline_credential' in merged ? merged.inline_credential : null, cloud.inline_credential)
  assert(!JSON.stringify(summary('profile', profile, cloud)).includes('synthetic-local'))
  assert.throws(
    () => mergeConflictValue('profile', profile, cloud, { host: 'local' }),
    failure('SYNC_MERGE_INVALID'),
  )
  assert.throws(() => mergeConflictValue('profile', null, cloud, {}), failure('SYNC_MERGE_INVALID'))
})

test('connection options can be selected without exposing raw settings or syncing host fingerprints', () => {
  const local = {
    ...profile,
    options: JSON.stringify({ keepalive: 30, host_key_fingerprint: 'local-trust' }),
  }
  const remote = { ...profile, options: JSON.stringify({ keepalive: 60 }) }
  assert.equal(summary('profile', local, remote)?.options_changed, true)
  const merged = mergeConflictValue('profile', local, remote, { options_changed: 'cloud' })
  assert.equal('options' in merged ? merged.options : '', remote.options)
  const onlyFingerprint = {
    ...local,
    options: JSON.stringify({ keepalive: 30, host_key_fingerprint: 'other-local-trust' }),
  }
  assert.equal(summary('profile', local, onlyFingerprint)?.options_changed, false)
})

test('batch contract rejects raw credentials, unrelated fields, duplicate identities and invalid side choices', () => {
  const resolution = {
    itemType: 'profile',
    itemId: 'p',
    remoteRevision: 1,
    remoteSource: 'cloud',
    choice: 'merge',
    fields: { host: 'local' },
  }
  const input = { localRevision: 1, resolutions: [resolution] }
  assert.equal(syncResolveBatchSchema.safeParse(input).success, true)
  for (const fields of [{ password: 'cloud' }, { parent_id: 'local' }, { host: 'arbitrary' }])
    assert.equal(
      syncResolveBatchSchema.safeParse({ ...input, resolutions: [{ ...resolution, fields }] }).success,
      false,
    )
  assert.equal(
    syncResolveBatchSchema.safeParse({ ...input, resolutions: [resolution, resolution] }).success,
    false,
  )
  assert.equal(
    syncResolveBatchSchema.safeParse({ ...input, resolutions: [{ ...resolution, choice: 'keep_local' }] })
      .success,
    false,
  )
  assert.equal(
    syncResolveBatchSchema.safeParse({
      ...input,
      resolutions: [{ ...resolution, choice: 'merge', fields: undefined }],
    }).success,
    false,
  )
})
