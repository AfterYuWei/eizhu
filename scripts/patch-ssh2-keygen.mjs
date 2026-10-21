import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const before = `      let pubBin = reader.readString(Ber.BitString, true);
      {
        // Remove leading zero bytes
        let i = 0;
        for (; i < pubBin.length && pubBin[i] === 0x00; ++i);
        if (i > 0)
          pubBin = pubBin.slice(i);
      }`
const after = `      // eizhu: BIT STRING has one unused-bit-count octet; retain all 32 key octets.
      const pubBin = reader.readString(Ber.BitString, true).subarray(1);`

/** ssh2#1513: the published 1.17.0 strips valid zero octets from Ed25519 public keys. */
export function patchSsh2KeygenSource(source, version) {
  if (version !== '1.17.0') throw new Error('ssh2 版本已变化，请重新审查 Ed25519 编码补丁')
  const crlf = source.includes('\r\n')
  const normalized = source.replaceAll('\r\n', '\n')
  const start = normalized.indexOf("    case 'ed25519': {")
  const end = normalized.indexOf('      // Parse private key', start)
  if (start < 0 || end < 0) throw new Error('ssh2 Ed25519 编码位置已变化，拒绝打包')
  const block = normalized.slice(start, end)
  if (block.includes(after)) return source
  if (!block.includes(before)) throw new Error('ssh2 Ed25519 编码源码已变化，拒绝打包')
  const patched = normalized.slice(0, start) + block.replace(before, after) + normalized.slice(end)
  return crlf ? patched.replaceAll('\n', '\r\n') : patched
}

export async function patchInstalledSsh2() {
  const metadata = JSON.parse(await readFile(require.resolve('ssh2/package.json'), 'utf8'))
  const path = require.resolve('ssh2/lib/keygen.js')
  const source = await readFile(path, 'utf8')
  const patched = patchSsh2KeygenSource(source, metadata.version)
  if (patched !== source) await writeFile(path, patched)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await patchInstalledSsh2()
  console.log('ssh2 Ed25519 公钥编码补丁已校验')
}
