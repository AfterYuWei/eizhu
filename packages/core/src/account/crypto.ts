import { createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { fail, masterKeyEnvelopeSchema, masterParametersSchema } from '@eizhu/contracts'
import type { z } from 'zod'
import { open, seal } from '../sync/crypto.ts'

type Parameters = z.infer<typeof masterParametersSchema>
export type MasterKeys = z.infer<typeof masterKeyEnvelopeSchema>
const expand = (key: Uint8Array, purpose: string, identity: string) =>
  Buffer.from(hkdfSync('sha256', key, identity, `eizhu:master:1:${purpose}`, 32))
const aad = (id: string) => Buffer.from(`eizhu:master:1:${id}:dek`)
export function recoveryCredential(key: Uint8Array, identity: string): string {
  const value = expand(key, 'device-recovery', identity)
  try {
    return value.toString('base64')
  } finally {
    value.fill(0)
  }
}
async function derive(password: string, parameters: Parameters) {
  masterParametersSchema.parse(parameters)
  const bytes = Buffer.from(password, 'utf8')
  try {
    return await argon2.hash(bytes, {
      type: argon2.argon2id,
      version: 0x13,
      raw: true,
      salt: Buffer.from(parameters.salt, 'base64'),
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 2,
      hashLength: 32,
    })
  } finally {
    bytes.fill(0)
  }
}
/** Runs exclusively in the bounded compute Worker. Only derived authentication material leaves the client. */
export async function masterCrypto(operation: string, input: unknown): Promise<unknown> {
  const d = input as { password: string; parameters?: Parameters; keys?: MasterKeys; key?: Uint8Array }
  const parameters =
    d.parameters ??
    (d.keys
      ? { cryptoId: d.keys.cryptoId, salt: d.keys.salt }
      : { cryptoId: randomUUID(), salt: randomBytes(16).toString('base64') })
  const root = await derive(d.password, parameters)
  const authentication = expand(root, 'authentication', parameters.cryptoId)
  const wrapping = expand(root, 'key-wrapping', parameters.cryptoId)
  let key: Buffer | undefined
  try {
    const credential = authentication.toString('base64')
    if (operation === 'master.credential') return { credential }
    if (operation === 'master.open') {
      const keys = masterKeyEnvelopeSchema.parse(d.keys)
      key = open(wrapping, keys.wrappedKey, aad(keys.cryptoId))
      if (key.length !== 32) fail('SYNC_CRYPTO', '加密密钥包无效')
      return { key: Buffer.from(key) }
    }
    if (operation !== 'master.create') return fail('UNKNOWN_OPERATION', '未开放的主密码计算任务')
    key = d.key ? Buffer.from(d.key) : randomBytes(32)
    if (key.length !== 32) fail('SYNC_CRYPTO', '数据密钥无效')
    const recovery = recoveryCredential(key, parameters.cryptoId)
    return {
      credential,
      recoveryHash: createHash('sha256').update(recovery).digest('hex'),
      key: Buffer.from(key),
      keys: masterKeyEnvelopeSchema.parse({
        ...parameters,
        version: 2,
        revision: d.keys?.revision ?? 0,
        wrappedKey: seal(wrapping, key, aad(parameters.cryptoId)),
      }),
    }
  } finally {
    root.fill(0)
    authentication.fill(0)
    wrapping.fill(0)
    key?.fill(0)
    d.key?.fill(0)
  }
}
