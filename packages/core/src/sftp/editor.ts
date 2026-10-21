import { createHash, randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { fail } from '@eizhu/contracts'
import type { SftpFileWriteRequest } from '@eizhu/contracts/models/sftp'
import { FileEndpoint } from './endpoint.ts'
const LIMIT = 10 * 1024 * 1024
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export async function fileHash(
  endpoint: FileEndpoint,
  path: string,
  limit = Number.MAX_SAFE_INTEGER,
): Promise<string> {
  const h = await endpoint.open(path),
    digest = createHash('sha256')
  let offset = 0
  try {
    while (offset < limit) {
      const bytes = await h.read(offset, Math.min(512 * 1024, limit - offset))
      if (!bytes.length) break
      digest.update(bytes)
      offset += bytes.length
    }
    return digest.digest('hex')
  } finally {
    await h.close()
  }
}
export async function readText(endpoint: FileEndpoint, path: string) {
  await endpoint.guard(path)
  const before = await endpoint.stat(path)
  if ((before.mode & 0o170000) !== 0o100000) fail('NOT_A_FILE', '只能编辑普通文件')
  if (before.size > LIMIT) fail('FILE_TOO_LARGE', '编辑器仅支持 10 MiB 以内的文件')
  const handle = await endpoint.open(path),
    chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const b = await handle.read(size, Math.min(512 * 1024, LIMIT + 1 - size))
      if (!b.length) break
      size += b.length
      if (size > LIMIT) fail('FILE_TOO_LARGE', '文件超过 10 MiB')
      chunks.push(b)
    }
  } finally {
    await handle.close()
  }
  const after = await endpoint.stat(path)
  if (before.identity !== after.identity) fail('FILE_MODIFIED', '读取期间文件发生变化，请重新读取')
  const bytes = Buffer.concat(chunks)
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    fail('UNSUPPORTED_ENCODING', '文件不是有效的 UTF-8 文本')
  }
  if (
    Array.from(content).some((c) => {
      const n = c.charCodeAt(0)
      return n < 9 || (n > 13 && n < 32)
    })
  )
    fail('BINARY_FILE', '二进制文件不能在文本编辑器中打开')
  const ext = posix.extname(path).toLowerCase(),
    name = posix.basename(path)
  const languages: Record<string, string> = {
    '.sh': 'shell',
    '.bash': 'shell',
    '.json': 'json',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.html': 'html',
    '.css': 'css',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.xml': 'xml',
    '.sql': 'sql',
    '.toml': 'ini',
    '.ini': 'ini',
    '.conf': 'ini',
    '.rs': 'rust',
    '.go': 'go',
    '.c': 'c',
    '.cpp': 'cpp',
  }
  return {
    path,
    content,
    size,
    mod_time: new Date(after.mtime).toISOString(),
    content_hash: hash(bytes),
    language: name === 'Dockerfile' ? 'dockerfile' : (languages[ext] ?? 'plaintext'),
    line_ending: content.includes('\r\n') ? ('crlf' as const) : ('lf' as const),
    read_only: (after.mode & 0o200) === 0,
  }
}
/** SFTP has no compare-and-swap primitive: recheck the optimistic token immediately before atomic rename. */
export async function writeText(endpoint: FileEndpoint, path: string, request: SftpFileWriteRequest) {
  await endpoint.guard(path, false)
  const content = request.content.replace(/\r\n?/g, '\n'),
    bytes = Buffer.from(request.line_ending === 'crlf' ? content.replace(/\n/g, '\r\n') : content)
  if (bytes.length > LIMIT) fail('FILE_TOO_LARGE', '文件超过 10 MiB')
  const original = await endpoint.optional(path),
    create = request.create_new || request.expected_mod_time === ''
  if (original && (original.link || original.dir))
    fail('SYMLINK_UNSAFE', '目标必须是普通文件，不能是符号链接')
  if (create && original) fail('FILE_EXISTS', '目标已经存在，请选择其他名称')
  const verify = async () => {
    const current = await endpoint.optional(path)
    if (create) {
      if (current) fail('FILE_EXISTS', '目标已经存在')
      return
    }
    if (
      !current ||
      !original ||
      current.identity !== original.identity ||
      new Date(current.mtime).toISOString() !== request.expected_mod_time ||
      !request.expected_content_hash ||
      (await fileHash(endpoint, path)) !== request.expected_content_hash
    )
      fail('FILE_MODIFIED', '远端文件已变化，本地编辑内容已保留，请比较并合并')
  }
  await verify()
  const temporary = posix.join(posix.dirname(path), `.eizhu-${randomUUID()}.part`)
  let committed = false
  try {
    const handle = await endpoint.open(temporary, true, true)
    try {
      for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
        await handle.write(offset, bytes.subarray(offset, offset + 512 * 1024))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await endpoint.chmod(temporary, original?.mode ?? 0o600)
    if ((await fileHash(endpoint, temporary)) !== hash(bytes))
      fail('VERIFY_FAILED', '暂存文件校验失败，原文件已保留')
    await verify()
    await endpoint.rename(temporary, path, !create)
    committed = true
    const s = await endpoint.stat(path)
    return { path, size: s.size, mod_time: new Date(s.mtime).toISOString(), content_hash: hash(bytes) }
  } finally {
    bytes.fill(0)
    if (!committed) await endpoint.remove(temporary).catch(() => undefined)
  }
}
