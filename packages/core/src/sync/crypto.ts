import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import {
  fail,
  legacySyncKeyEnvelopeSchema as syncKeyEnvelopeSchema,
  syncWireItemSchema,
} from '@eizhu/contracts'
import type { z } from 'zod'
import { fromPortable, portable } from './model.ts'
import type { Entity, ItemType, PlainItem, WireItem } from './model.ts'
type Envelope = z.infer<typeof syncKeyEnvelopeSchema>
const error = () => fail('SYNC_CRYPTO', '主密码错误或加密数据已损坏')
function base64(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) error()
  return bytes
}
export const itemAad = (
  user: number,
  item: Pick<WireItem, 'itemType' | 'itemId' | 'revision' | 'deleted'>,
  epoch: number,
) => {
  if (
    !Number.isSafeInteger(user) ||
    user <= 0 ||
    !Number.isSafeInteger(item.revision) ||
    !Number.isSafeInteger(epoch)
  )
    error()
  return Buffer.from(
    JSON.stringify([
      'eizhu:item',
      2,
      user,
      item.itemType,
      item.itemId,
      item.revision,
      epoch,
      1,
      item.deleted,
    ]),
  )
}
export function seal(key: Uint8Array, plain: Uint8Array, aad: Uint8Array): string {
  if (key.byteLength !== 32) error()
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  return Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString('base64')
}
export function open(key: Uint8Array, encoded: string, aad: Uint8Array): Buffer {
  try {
    if (key.byteLength !== 32) error()
    const bytes = base64(encoded)
    if (bytes.length < 28) error()
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    cipher.setAAD(aad)
    cipher.setAuthTag(bytes.subarray(-16))
    return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()])
  } catch {
    return error()
  }
}
async function derive(password: string, envelope: Envelope): Promise<Buffer> {
  syncKeyEnvelopeSchema.parse(envelope)
  const salt = base64(envelope.salt)
  if (salt.length !== 16) error()
  const bytes = Buffer.from(password, 'utf8')
  try {
    return await argon2.hash(bytes, {
      type: argon2.argon2id,
      version: 0x13,
      raw: true,
      salt,
      memoryCost: envelope.memory,
      timeCost: envelope.time,
      parallelism: envelope.threads,
      hashLength: 32,
    })
  } finally {
    bytes.fill(0)
  }
}
export async function wrap(
  password: string,
  key: Uint8Array,
  user: number,
  revision: number,
): Promise<Envelope> {
  const envelope: Envelope = {
    salt: randomBytes(16).toString('base64'),
    time: 3,
    memory: 65536,
    threads: 2,
    wrappedKey: 'pending',
    version: 1,
    revision,
  }
  const derived = await derive(password, envelope)
  try {
    envelope.wrappedKey = seal(derived, key, Buffer.from(`eizhu:key:2:${user}:1`))
    return envelope
  } finally {
    derived.fill(0)
  }
}
export async function unwrap(password: string, envelope: Envelope, user: number): Promise<Buffer> {
  const derived = await derive(password, envelope)
  try {
    const key = open(derived, envelope.wrappedKey, Buffer.from(`eizhu:key:2:${user}:1`))
    if (key.length !== 32) {
      key.fill(0)
      error()
    }
    return key
  } finally {
    derived.fill(0)
  }
}
export async function executeCrypto(operation: string, input: unknown): Promise<unknown> {
  const d = input as {
    password: string
    key: Uint8Array
    user: number
    revision: number
    envelope: Envelope
    epoch: number
    items: Array<WireItem & { value: Entity | null }>
  }
  try {
    if (operation === 'sync.wrap') return await wrap(d.password, d.key, d.user, d.revision)
    if (operation === 'sync.unwrap') return await unwrap(d.password, d.envelope, d.user)
    let encryptedBytes = 0
    if (operation === 'sync.encrypt')
      return d.items.map((item) => {
        const { value, ...wire } = item,
          bytes = Buffer.from(JSON.stringify(portable(item.itemType as ItemType, value)))
        try {
          const payload = seal(d.key, bytes, itemAad(d.user, item, item.epoch ?? d.epoch))
          if (payload.length > 2097152) fail('SYNC_LIMIT', '单条密文超过服务端上限，本地修改已保留')
          encryptedBytes += payload.length
          if (encryptedBytes > 50 * 1024 * 1024)
            fail('SYNC_LIMIT', '本批密文超过 50 MiB 处理上限，本地修改已保留')
          return syncWireItemSchema.parse({ ...wire, payload })
        } finally {
          bytes.fill(0)
        }
      })
    if (operation === 'sync.decrypt')
      return d.items.map((item) => {
        const wire = syncWireItemSchema.parse(item),
          bytes = open(d.key, wire.payload, itemAad(d.user, wire, wire.epoch ?? d.epoch))
        try {
          const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          if (wire.deleted && raw !== null) fail('SYNC_CONTENT', '云端删除标记无效')
          return {
            ...wire,
            value: wire.deleted ? null : fromPortable(wire.itemType, wire.itemId, raw),
          } as PlainItem
        } finally {
          bytes.fill(0)
        }
      })
    return fail('UNKNOWN_OPERATION', '未开放的同步计算任务')
  } finally {
    d.key?.fill(0)
  }
}
