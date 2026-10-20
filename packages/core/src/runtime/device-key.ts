import { randomBytes } from 'node:crypto'
import { access, chmod, lstat, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from '@eizhu/contracts'
import { z } from 'zod'

export interface KeyProtector {
  available(): boolean
  wrap(value: string): Buffer
  unwrap(value: Buffer): string
  restrict(path: string): Promise<void>
}
const keyFileSchema = z.discriminatedUnion('mode', [
  z.strictObject({ version: z.literal(1), mode: z.literal('system'), wrapped: z.string().min(1).max(8192) }),
  z.strictObject({
    version: z.literal(1),
    mode: z.literal('restricted-file'),
    key: z.string().regex(/^[0-9a-f]{64}$/),
  }),
])
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
/** Missing/locked existing keys are fatal. Fallback is only a first-initialization decision. */
export async function loadDeviceKey(
  root: string,
  protector: KeyProtector,
): Promise<{ key: Buffer; mode: 'system' | 'restricted-file' }> {
  const path = join(root, 'device-key.json')
  if (await exists(path)) {
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
        fail('KEY_LOCKED', '设备密钥文件异常，原数据已保留')
      const file = keyFileSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      const decoded =
        file.mode === 'system' ? protector.unwrap(Buffer.from(file.wrapped, 'base64')) : file.key
      if (!/^[0-9a-f]{64}$/.test(decoded)) fail('KEY_LOCKED', '设备密钥无法解锁，原数据已保留')
      await protector.restrict(path)
      return { key: Buffer.from(decoded, 'hex'), mode: file.mode }
    } catch {
      return fail('KEY_LOCKED', '设备密钥无法解锁，原数据已保留；请恢复密钥库访问后重试')
    }
  }
  if (await exists(join(root, 'global.sqlite')))
    fail('KEY_MISSING', '已有数据的设备密钥缺失，禁止创建替代密钥')
  const key = randomBytes(32)
  try {
    const file = protector.available()
      ? {
          version: 1,
          mode: 'system' as const,
          wrapped: protector.wrap(key.toString('hex')).toString('base64'),
        }
      : { version: 1, mode: 'restricted-file' as const, key: key.toString('hex') }
    await writeFile(path, JSON.stringify(file), { flag: 'wx', mode: 0o600 })
    await chmod(path, 0o600)
    await protector.restrict(path)
    return { key, mode: file.mode }
  } catch (cause) {
    key.fill(0)
    throw cause
  }
}
