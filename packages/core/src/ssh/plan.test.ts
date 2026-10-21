import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionPlan } from './plan.ts'
import { emptyPayload } from '../local/model.ts'
const profile = (id: string, options = '{}') => ({
  id,
  name: id,
  host: 'example.invalid',
  port: 22,
  username: 'user',
  auth_type: 'password' as const,
  inline_credential: { password: 'synthetic' },
  sort_order: 0,
  tags: [],
  options,
  note: '',
  created_at: '',
  updated_at: '',
})
test('route resolves vault username and credentials, orders multiple jumps and omits unrelated records', () => {
  const p = emptyPayload()
  p.profiles = [
    profile('first'),
    profile('second', JSON.stringify({ proxy: { type: 'jump', jump_profile_id: 'first' } })),
    {
      ...profile('target', JSON.stringify({ proxy: { type: 'jump', jump_profile_id: 'second' } })),
      auth_type: 'vault',
      vault_id: 'vault',
    },
    profile('unrelated'),
  ]
  p.vault = [
    {
      id: 'vault',
      name: '密码',
      type: 'password',
      username: 'vault-user',
      remark: '',
      fingerprint: '',
      credential: { password: 'vault-password' },
      created_at: '',
      updated_at: '',
    },
  ]
  const hops = connectionPlan(p, { id: 'target' })
  assert.deepEqual(
    hops.map((h) => h.profile.id),
    ['first', 'second', 'target'],
  )
  assert.equal(hops[2].profile.username, 'vault-user')
  assert.equal(hops[2].credential.password, 'vault-password')
})
test('test connection patch cannot retain password when auth changes to key or alter the stored profile', () => {
  const p = emptyPayload()
  p.profiles = [profile('first')]
  assert.throws(() => connectionPlan(p, { id: 'first', request: { auth_type: 'key' } }), /私钥/)
  assert.equal(p.profiles[0].auth_type, 'password')
  assert.equal(p.profiles[0].inline_credential?.password, 'synthetic')
})
