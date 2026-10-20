import { parentPort } from 'node:worker_threads'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { fail } from '@eizhu/contracts'
import { answerWorker } from './client.ts'

/** The smoke vector proves native KDF + crypto load inside the packaged utility/worker process tree. */
async function smoke(): Promise<{ kdf: boolean; crypto: boolean }> {
  const password = Buffer.from('eizhu foundation smoke 合成密码', 'utf8')
  let key: Buffer
  try {
    key = await argon2.hash(password, {
      type: argon2.argon2id,
      raw: true,
      salt: Buffer.alloc(16, 7),
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    })
  } finally {
    password.fill(0)
  }
  try {
    const nonce = randomBytes(12),
      aad = Buffer.from('eizhu:foundation:v1'),
      plain = Buffer.from('synthetic only')
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(aad)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(cipher.getAuthTag())
    const result = Buffer.concat([decipher.update(encrypted), decipher.final()])
    const valid = timingSafeEqual(plain, result)
    result.fill(0)
    // Independently derived with Node 24 crypto.argon2, not the native addon's own exporter.
    return {
      kdf: timingSafeEqual(
        key,
        Buffer.from('7c43233f587a4d236157253efe888c03211b2c18328a3ed58c97a8ddb4fdb28d', 'hex'),
      ),
      crypto: valid,
    }
  } finally {
    key.fill(0)
  }
}
parentPort!.on('message', async (message) => {
  parentPort!.postMessage(
    await answerWorker(message, (operation) => {
      if (operation === 'smoke') return smoke()
      if (operation === 'close') return
      return fail('UNKNOWN_OPERATION', '未开放的计算任务')
    }),
  )
})
