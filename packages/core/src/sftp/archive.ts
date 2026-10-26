import { Readable } from 'node:stream'
import { createGzip } from 'node:zlib'
import { posix } from 'node:path'
import { fail } from '@eizhu/contracts'
import { FileEndpoint } from './endpoint.ts'
import type { FileStat } from './endpoint.ts'
export interface ArchiveEntry {
  path: string
  name: string
  size: number
  mode: number
  mtime: number
  dir: boolean
  link: boolean
  identity: string
}
export async function collect(endpoint: FileEndpoint, paths: string[], signal?: AbortSignal, onEntry?: (row: ArchiveEntry) => void): Promise<ArchiveEntry[]> {
  const rows: ArchiveEntry[] = []
  const walk = async (path: string, name: string, depth: number, known?: FileStat) => {
    signal?.throwIfAborted()
    if (depth > 64 || rows.length >= 10000) fail('DIRECTORY_LIMIT', '目录层数或文件数超过安全限制')
    if (!known) await endpoint.guard(path)
    const s = known ?? await endpoint.stat(path)
    if (s.link) fail('SYMLINK_UNSAFE', '传输不跟随符号链接')
    if (!s.dir && (s.mode & 0o170000) !== 0o100000) fail('NOT_A_FILE', '不能传输设备、套接字或管道')
    rows.push({ ...s, path, name })
    onEntry?.(rows[rows.length - 1])
    if (s.dir) {
      if (known) await endpoint.guard(path)
      for (const row of await endpoint.listStats(path)) {
        signal?.throwIfAborted()
        await walk(row.path, posix.join(name, posix.basename(row.path)), depth + 1, row.stat)
      }
    }
  }
  const roots = [...new Set(paths)]
    .filter((path, _index, all) => !all.some((parent) => parent !== path && path.startsWith(parent.replace(/\/$/, '') + '/')))
  for (const path of roots) await walk(path, posix.basename(path), 0)
  return rows
}
export async function* fileBytes(
  endpoint: FileEndpoint,
  item: ArchiveEntry,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  if ((await endpoint.stat(item.path)).identity !== item.identity)
    fail('SOURCE_CHANGED', '源文件已变化，请重新开始')
  const h = await endpoint.open(item.path)
  let offset = 0
  try {
    while (offset < item.size) {
      signal?.throwIfAborted()
      const b = await h.read(offset, Math.min(512 * 1024, item.size - offset))
      if (!b.length) fail('SOURCE_CHANGED', '源文件大小发生变化')
      offset += b.length
      yield b
    }
    if ((await endpoint.stat(item.path)).identity !== item.identity) fail('SOURCE_CHANGED', '源文件已变化')
  } finally {
    await h.close()
  }
}
function tarHeader(name: string, size: number, mode: number, mtime: number, type = '0') {
  const b = Buffer.alloc(512)
  b.write(name, 0, 100, 'utf8')
  const oct = (n: number, p: number, l: number) =>
    b.write(
      Math.floor(n)
        .toString(8)
        .padStart(l - 1, '0') + '\0',
      p,
      l,
      'ascii',
    )
  oct(mode & 0o777, 100, 8)
  oct(0, 108, 8)
  oct(0, 116, 8)
  oct(size, 124, 12)
  oct(mtime / 1000, 136, 12)
  b.fill(32, 148, 156)
  b.write(type, 156)
  b.write('ustar\0', 257)
  b.write('00', 263)
  oct(
    b.reduce((a, v) => a + v, 0),
    148,
    8,
  )
  return b
}
function pax(value: string) {
  let n = Buffer.byteLength(value) + 3
  while (true) {
    const out = `${n} ${value}\n`,
      size = Buffer.byteLength(out)
    if (size === n) return Buffer.from(out)
    n = size
  }
}
async function* tar(endpoint: FileEndpoint, rows: ArchiveEntry[], signal?: AbortSignal) {
  for (const row of rows) {
    signal?.throwIfAborted()
    const name = row.name + (row.dir ? '/' : '')
    const extended: Buffer[] = []
    if (Buffer.byteLength(name) > 99) extended.push(pax(`path=${name}`))
    if (row.size > 0o77777777777) extended.push(pax(`size=${row.size}`))
    if (extended.length) {
      const p = Buffer.concat(extended)
      yield tarHeader('PaxHeader', p.length, 0o600, row.mtime, 'x')
      yield p
      yield Buffer.alloc((512 - (p.length % 512)) % 512)
    }
    yield tarHeader(
      Buffer.byteLength(name) > 99 ? 'entry' : name,
      row.dir || row.size > 0o77777777777 ? 0 : row.size,
      row.mode,
      row.mtime,
      row.dir ? '5' : '0',
    )
    if (!row.dir) {
      yield* fileBytes(endpoint, row, signal)
      yield Buffer.alloc((512 - (row.size % 512)) % 512)
    }
  }
  yield Buffer.alloc(1024)
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
async function* zip(endpoint: FileEndpoint, rows: ArchiveEntry[], signal?: AbortSignal) {
  if (
    rows.reduce((n, row) => n + (row.dir ? 0 : row.size) + 2 * Buffer.byteLength(row.name) + 100, 22) >
    0xffffffff
  )
    fail('ARCHIVE_LIMIT', 'ZIP 超过 4 GiB，请使用目录传输或 tar.gz')
  const central: Buffer[] = []
  let offset = 0
  for (const row of rows) {
    signal?.throwIfAborted()
    if (row.size > 0xffffffff || offset > 0xffffffff)
      fail('ARCHIVE_LIMIT', 'ZIP 超过 4 GiB，请使用目录传输或 tar.gz')
    const name = Buffer.from(row.name + (row.dir ? '/' : ''))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x808, 6)
    local.writeUInt16LE(name.length, 26)
    const start = offset
    yield local
    yield name
    offset += 30 + name.length
    let crc = 0xffffffff,
      size = 0
    if (!row.dir)
      for await (const b of fileBytes(endpoint, row, signal)) {
        for (const value of b) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8)
        size += b.length
        offset += b.length
        yield b
      }
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50)
    descriptor.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 4)
    descriptor.writeUInt32LE(size, 8)
    descriptor.writeUInt32LE(size, 12)
    yield descriptor
    offset += 16
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50)
    c.writeUInt16LE(0x314, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x808, 8)
    c.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 16)
    c.writeUInt32LE(size, 20)
    c.writeUInt32LE(size, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(((row.mode & 0xffff) << 16) >>> 0, 38)
    c.writeUInt32LE(start, 42)
    central.push(c, name)
  }
  let length = 0
  for (const b of central) {
    length += b.length
    yield b
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(rows.length, 8)
  end.writeUInt16LE(rows.length, 10)
  end.writeUInt32LE(length, 12)
  end.writeUInt32LE(offset, 16)
  yield end
}
export function archive(
  endpoint: FileEndpoint,
  rows: ArchiveEntry[],
  format: 'tar.gz' | 'zip',
  signal?: AbortSignal,
): Readable {
  if (format === 'zip') return Readable.from(zip(endpoint, rows, signal))
  const input = Readable.from(tar(endpoint, rows, signal)),
    output = createGzip()
  input.on('error', (e) => output.destroy(e))
  output.on('close', () => input.destroy())
  return input.pipe(output)
}
