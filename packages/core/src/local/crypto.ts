import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto'
import { fail } from '@eizhu/contracts'

/** Purpose/workspace separation; no device master key is stored in a database. */
export class LocalCipher {
  private key: Buffer
  constructor(deviceKey: Uint8Array, workspace: string) {
    if (deviceKey.byteLength !== 32) fail('KEY_INVALID', '设备密钥无效，原数据已保留')
    this.key = Buffer.from(hkdfSync('sha256', deviceKey, 'eizhu-desktop:v1', workspace, 32))
  }
  seal(value: unknown, purpose: string): Buffer {
    const plain = Buffer.from(JSON.stringify(value)),
      nonce = randomBytes(12)
    try {
      const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
      cipher.setAAD(Buffer.from(`eizhu:local:1:${purpose}`))
      return Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
    } finally {
      plain.fill(0)
    }
  }
  open<T>(value: Uint8Array, purpose: string): T {
    let plain: Buffer | undefined
    try {
      const bytes = Buffer.from(value)
      const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
      cipher.setAAD(Buffer.from(`eizhu:local:1:${purpose}`))
      cipher.setAuthTag(bytes.subarray(-16))
      plain = Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()])
      return JSON.parse(plain.toString('utf8')) as T
    } catch {
      return fail('DATA_DECRYPT_FAILED', '本地数据无法解密，原数据已保留')
    } finally {
      plain?.fill(0)
    }
  }
  close(): void {
    this.key.fill(0)
  }
}
