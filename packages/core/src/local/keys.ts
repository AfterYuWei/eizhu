import { createHash, createPrivateKey, randomBytes } from 'node:crypto'
import { utils } from 'ssh2'
import { fail, local } from '@eizhu/contracts'
import type { LocalInput } from '@eizhu/contracts'
import type { StoredVault } from './model.ts'

export function prepareCredential(input: StoredVault['credential'], type: StoredVault['type']) {
  if (!input) return fail('VALIDATION', '凭据内容不能为空')
  if (type === 'password') {
    if (!input.password) fail('VALIDATION', '密码不能为空')
    return { credential: { password: input.password }, fingerprint: '' }
  }
  if (!input.private_key) fail('VALIDATION', '私钥不能为空')
  const key = utils.parseKey(input.private_key, input.passphrase || undefined)
  if (key instanceof Error || !key.isPrivateKey()) fail('INVALID_PRIVATE_KEY', '私钥格式无效或口令错误')
  const publicKey = `${key.type} ${key.getPublicSSH().toString('base64')}`
  const supplied = input.public_key?.trim()
  if (supplied) {
    const parsed = utils.parseKey(supplied)
    if (parsed instanceof Error || !key.getPublicSSH().equals(parsed.getPublicSSH()))
      fail('INVALID_PRIVATE_KEY', '公钥与私钥不匹配')
  }
  return {
    credential: {
      private_key: input.private_key,
      public_key: supplied || publicKey,
      ...(input.passphrase ? { passphrase: input.passphrase } : {}),
    },
    fingerprint: createHash('sha256').update(input.private_key).digest('hex').slice(0, 16),
  }
}
export function generateKeyPair(input: LocalInput<'vault.generateKeyPair'>) {
  const { request } = local['vault.generateKeyPair'].input.parse(input)
  const options: utils.KeyPairOptions = request.passphrase
    ? { passphrase: request.passphrase, cipher: 'aes256-ctr', rounds: 16 }
    : {}
  const pair =
    request.algo === 'rsa'
      ? utils.generateKeyPairSync('rsa', { ...options, bits: request.bits ?? 4096 })
      : utils.generateKeyPairSync('ed25519', options)
  const key = utils.parseKey(pair.public)
  if (key instanceof Error) fail('KEYGEN_ERROR', '密钥生成失败')
  return {
    private_key: pair.private.trim(),
    public_key: pair.public.trim(),
    fingerprint: createHash('sha256').update(key.getPublicSSH()).digest('hex').slice(0, 16),
  }
}

/** ssh2 cannot parse its own Ed25519 PKCS8 export. Rewrap it as an unencrypted OpenSSH key in the compute Worker. */
export function unlockPrivateKey(input: { private_key: string; passphrase?: string }): string {
  const key = utils.parseKey(input.private_key, input.passphrase)
  if (key instanceof Error || !key.isPrivateKey()) fail('SSH_AUTH_FAILED', '私钥或口令无效')
  if (key.type !== 'ssh-ed25519') return key.getPrivatePEM()
  const jwk = createPrivateKey(key.getPrivatePEM()).export({ format: 'jwk' })
  const seed = Buffer.from(jwk.d!, 'base64url'),
    publicKey = Buffer.from(jwk.x!, 'base64url')
  const field = (data: Buffer | string) => {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data),
      n = Buffer.alloc(4)
    n.writeUInt32BE(b.length)
    return Buffer.concat([n, b])
  }
  const check = randomBytes(4),
    plain = Buffer.concat([
      check,
      check,
      field('ssh-ed25519'),
      field(publicKey),
      field(Buffer.concat([seed, publicKey])),
      field(''),
    ])
  const pad = Buffer.from(Array.from({ length: 8 - (plain.length % 8) }, (_, i) => i + 1))
  const count = Buffer.from([0, 0, 0, 1]),
    blob = Buffer.concat([
      Buffer.from('openssh-key-v1\0'),
      field('none'),
      field('none'),
      field(Buffer.alloc(0)),
      count,
      field(key.getPublicSSH()),
      field(Buffer.concat([plain, pad])),
    ])
  try {
    return (
      '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
      blob
        .toString('base64')
        .match(/.{1,70}/g)!
        .join('\n') +
      '\n-----END OPENSSH PRIVATE KEY-----'
    )
  } finally {
    seed.fill(0)
    plain.fill(0)
    blob.fill(0)
  }
}
