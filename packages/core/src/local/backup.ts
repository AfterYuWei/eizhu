import { z } from 'zod'
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import argon2 from 'argon2'
import { fail } from '@eizhu/contracts'
import type { Payload } from './model.ts'
import { payloadSchema, orderedPayload, stripCredentials, validateGraph } from './model.ts'
import { prepareCredential } from './keys.ts'

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
const envelope = z.object({
  format: z.enum(['eizhu-backup', 'xcontrol-backup']),
  version: z.int().min(0).max(1),
  exported_at: z.string().max(64).default('0001-01-01T00:00:00Z'),
  credential_mode: z.enum(['none', 'plain', 'encrypted']),
  kdf: z
    .object({
      algo: z.literal('argon2id'),
      salt: z.string().max(4096),
      time: z.int().min(1).max(100),
      memory: z
        .int()
        .min(1)
        .max(1 << 20),
      threads: z.int().min(1).max(16),
    })
    .optional(),
  payload: z.string().optional(),
  groups: z.unknown(),
  vault: z.unknown(),
  profiles: z.unknown(),
  snippets: z.unknown(),
})
type Kdf = NonNullable<z.infer<typeof envelope>['kdf']>
function base64(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) fail('INVALID_BACKUP_FORMAT', '备份 Base64 编码无效')
  return decoded
}
async function derive(password: string, kdf: Kdf): Promise<Buffer> {
  const salt = base64(kdf.salt)
  if (salt.length < 8 || kdf.memory < 8 * kdf.threads) fail('INVALID_BACKUP_FORMAT', '备份 KDF 参数无效')
  const bytes = Buffer.from(password, 'utf8')
  try {
    return await argon2.hash(bytes, {
      type: argon2.argon2id,
      version: 0x13,
      raw: true,
      salt,
      timeCost: kdf.time,
      memoryCost: kdf.memory,
      parallelism: kdf.threads,
      hashLength: 32,
    })
  } catch {
    return fail('INVALID_BACKUP_FORMAT', '备份 KDF 参数无效或计算失败')
  } finally {
    bytes.fill(0)
  }
}
export type FileIdentity = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }
export async function readBounded(
  path: string,
  maxBytes = MAX_BACKUP_BYTES,
  identity?: FileIdentity,
): Promise<Buffer> {
  const handle = await open(path, 'r')
  const chunks: Buffer[] = []
  try {
    const before = await handle.stat()
    if (
      identity &&
      Object.entries(identity).some(([key, value]) => before[key as keyof FileIdentity] !== value)
    )
      fail('SOURCE_CHANGED', '所选文件已变化，请重新选择并预览')
    if (!before.isFile() || before.size > maxBytes) fail('FILE_TOO_LARGE', '文件超过允许大小或不是普通文件')
    // Read at most limit+1 even if another process grows the selected file.
    let total = 0
    while (total <= maxBytes) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total))
      const { bytesRead } = await handle.read(chunk)
      if (!bytesRead) break
      total += bytesRead
      chunks.push(chunk.subarray(0, bytesRead))
    }
    if (total > maxBytes) fail('FILE_TOO_LARGE', '文件超过允许大小')
    const after = await handle.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      fail('SOURCE_CHANGED', '文件在读取期间发生变化，请重新选择')
    return Buffer.concat(chunks, total)
  } finally {
    for (const chunk of chunks) chunk.fill(0)
    await handle.close()
  }
}
export async function decodeBackup(raw: Uint8Array, password = '') {
  if (raw.byteLength > MAX_BACKUP_BYTES) fail('FILE_TOO_LARGE', '备份不能超过 50 MiB')
  let file: z.infer<typeof envelope>
  try {
    file = envelope.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
  } catch {
    return fail('INVALID_BACKUP_FORMAT', '备份文件格式、版本或凭据模式无效')
  }
  let decoded: unknown = file
  if (file.credential_mode === 'encrypted') {
    if (!password) fail('PASSWORD_REQUIRED', '该备份已加密，请输入导出密码')
    if (!file.kdf) fail('INVALID_BACKUP_FORMAT', '加密备份缺少 KDF 参数')
    const key = await derive(password, file.kdf)
    let plain: Buffer | undefined
    try {
      try {
        const bytes = base64(file.payload ?? '')
        if (bytes.length < 28) throw new Error()
        const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
        cipher.setAAD(Buffer.from(`${file.format}:1`))
        cipher.setAuthTag(bytes.subarray(-16))
        plain = Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()])
      } catch {
        return fail('INVALID_PASSWORD', '密码错误或备份文件已损坏')
      }
      try {
        decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain))
      } catch {
        return fail('INVALID_BACKUP_FORMAT', '备份正文无效')
      }
    } finally {
      key.fill(0)
      plain?.fill(0)
    }
  }
  let payload: Payload
  try {
    payload = payloadSchema.parse(decoded)
  } catch {
    return fail('INVALID_BACKUP_FORMAT', '备份数据字段无效')
  }
  if (file.credential_mode === 'none') payload = stripCredentials(payload)
  try {
    validateGraph(payload)
  } catch {
    return fail('IMPORT_FAILED', '备份包含无效关联')
  }
  try {
    for (const vault of payload.vault) prepareCredential(vault.credential, vault.type)
    for (const profile of payload.profiles)
      if (profile.auth_type === 'key' && profile.inline_credential)
        prepareCredential(profile.inline_credential, 'private_key')
  } catch {
    return fail('IMPORT_FAILED', '备份包含无效凭据')
  }
  return {
    payload,
    mode: file.credential_mode,
    exportedAt: file.exported_at,
    hash: createHash('sha256').update(raw).digest('hex'),
  }
}
export async function encodeBackup(payload: Payload, mode: 'none' | 'plain' | 'encrypted', password = '') {
  const ordered = orderedPayload(mode === 'none' ? stripCredentials(payload) : payload)
  const plain = Buffer.from(JSON.stringify(ordered))
  try {
    const header = {
      format: 'eizhu-backup',
      version: 1,
      exported_at: new Date().toISOString(),
      credential_mode: mode,
    }
    let file: unknown
    if (mode === 'encrypted') {
      if (!password) fail('PASSWORD_REQUIRED', '加密导出必须提供密码')
      const kdf: Kdf = {
          algo: 'argon2id',
          salt: randomBytes(16).toString('base64'),
          time: 3,
          memory: 65536,
          threads: 2,
        },
        key = await derive(password, kdf)
      try {
        const nonce = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', key, nonce)
        cipher.setAAD(Buffer.from('eizhu-backup:1'))
        file = {
          ...header,
          kdf,
          payload: Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString(
            'base64',
          ),
        }
      } finally {
        key.fill(0)
      }
    } else file = { ...header, ...Object.fromEntries(Object.entries(ordered).filter(([, v]) => v.length)) }
    const bytes = Buffer.from(JSON.stringify(file, null, 2))
    if (bytes.length > MAX_BACKUP_BYTES) fail('FILE_TOO_LARGE', '导出备份超过 50 MiB')
    return { bytes, hash: createHash('sha256').update(plain).digest('hex') }
  } finally {
    plain.fill(0)
  }
}
