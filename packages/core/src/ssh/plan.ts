import { fail, local } from '@eizhu/contracts'
import type { Payload, StoredProfile } from '../local/model.ts'
import { proxyOf, optionsOf, validateGraph } from '../local/model.ts'
export interface ConnectionHop {
  profile: StoredProfile
  credential: { password?: string; private_key?: string; passphrase?: string }
  proxy: ReturnType<typeof proxyOf>
  timeout: number
  keepalive: number
}
/** Only the selected route and its credentials leave the database Worker. */
export function connectionPlan(payload: Payload, input: { id?: string; request?: unknown }): ConnectionHop[] {
  let profile: StoredProfile | undefined
  if (input.id) profile = payload.profiles.find((p) => p.id === input.id)
  if (input.id && !profile) fail('NOT_FOUND', '服务器不存在')
  if (input.request) {
    const request = input.id
      ? local['profile.update'].input.parse({ id: input.id, request: input.request }).request
      : local['profile.create'].input.parse({ request: input.request }).request
    const { password, private_key, passphrase, proxy, ...metadata } = request
    const previousAuth = profile?.auth_type
    profile = {
      id: 'test',
      name: '',
      host: '',
      port: 22,
      username: '',
      auth_type: 'password',
      sort_order: 0,
      tags: [],
      options: '{}',
      note: '',
      created_at: '',
      updated_at: '',
      ...profile,
      ...metadata,
    }
    if (previousAuth && request.auth_type && request.auth_type !== previousAuth)
      delete profile.inline_credential
    if (password) profile.inline_credential = { password }
    if (private_key) profile.inline_credential = { private_key, passphrase }
    if (proxy) {
      const { password: proxyPassword, ...value } = proxy
      profile.options = JSON.stringify({ ...optionsOf(profile.options), proxy: value })
      profile.proxy_password = proxyPassword || profile.proxy_password
    }
    payload = { ...payload, profiles: [...payload.profiles.filter((p) => p.id !== profile!.id), profile] }
    validateGraph(payload)
  }
  if (!profile) fail('NOT_FOUND', '服务器不存在')
  const result: ConnectionHop[] = [],
    visited = new Set<string>()
  while (profile) {
    if (visited.has(profile.id) || result.length >= 6) fail('INVALID_PROXY_CHAIN', '跳板链无效')
    visited.add(profile.id)
    const options = optionsOf(profile.options),
      proxy = proxyOf(profile)
    let credential = profile.inline_credential ?? {}
    if (profile.auth_type === 'vault') {
      const vault = payload.vault.find((v) => v.id === profile!.vault_id)
      if (!vault?.credential) fail('CREDENTIAL_MISSING', '凭据不存在或为空')
      credential = vault.credential
      if (vault.type === 'password') profile = { ...profile, username: vault.username }
    }
    if (profile.auth_type === 'agent' || profile.auth_type === 'none') credential = {}
    if (profile.auth_type === 'key') {
      if (!credential.private_key) fail('CREDENTIAL_MISSING', '请提供私钥')
      credential = { private_key: credential.private_key, passphrase: credential.passphrase }
    }
    if (profile.auth_type === 'password') credential = { password: credential.password }
    const seconds = typeof options.connect_timeout === 'number' ? options.connect_timeout : 20
    const interval = typeof options.keepalive_interval === 'number' ? options.keepalive_interval : 15
    result.unshift({
      profile,
      credential,
      proxy,
      timeout: Math.min(25000, Math.max(1000, seconds * 1000)),
      keepalive: Math.min(120000, Math.max(1000, interval * 1000)),
    })
    profile = proxy.type === 'jump' ? payload.profiles.find((p) => p.id === proxy.jump_profile_id) : undefined
    if (proxy.type === 'jump' && !profile) fail('INVALID_PROXY_CHAIN', '跳板不存在')
  }
  return result
}
