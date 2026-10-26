import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { posix, win32, resolve, dirname, join, sep } from 'node:path'
import type { SFTPWrapper, Stats, FileEntry, Attributes } from 'ssh2'
import { DesktopError, fail } from '@eizhu/contracts'
import type { SftpEntry } from '@eizhu/contracts/models/sftp'

export interface FileStat {
  size: number
  mtime: number
  mode: number
  dir: boolean
  link: boolean
  identity: string
}
export interface FileHandle {
  read(offset: number, length: number): Promise<Buffer>
  write(offset: number, bytes: Uint8Array): Promise<void>
  close(): Promise<void>
  sync(): Promise<void>
}
// SFTP supports multiple outstanding requests. Keep a bounded 512 KiB window
// with 32 KiB packets rather than waiting one network round trip per packet.
const PACKET_BYTES = 32 * 1024
async function settle<T>(requests: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(requests)
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
}
export const missing = (e: unknown) => ['ENOENT', 2].includes((e as { code?: string | number })?.code ?? '')
export function nativePath(path: string): string {
  if (process.platform !== 'win32') return path
  if (path.startsWith('/UNC/')) return '\\\\' + path.slice(5).replace(/\//g, '\\')
  if (/^\/[a-z]:\//i.test(path)) return win32.normalize(path.slice(1))
  if (/^[a-z]:[\\/]/i.test(path)) return win32.normalize(path)
  return path
}
export function displayPath(path: string): string {
  return process.platform === 'win32' ? '/' + resolve(path).replace(/\\/g, '/') : resolve(path)
}
export function cleanPath(path: string): string {
  if (path.includes('\0') || !path.startsWith('/')) fail('BAD_PATH', '请选择绝对路径')
  const clean = posix.normalize(path)
  return /^\/[a-z]:$/i.test(clean) ? clean + '/' : clean
}
function convert(s: Attributes): FileStat {
  return {
    size: s.size,
    mtime: s.mtime * 1000,
    mode: s.mode,
    dir: (s.mode & 0o170000) === 0o040000,
    link: (s.mode & 0o170000) === 0o120000,
    identity: `${s.size}:${s.mtime}:${s.mode}:${s.uid}:${s.gid}`,
  }
}
export function entry(path: string, s: FileStat): SftpEntry {
  return {
    name: posix.basename(path),
    path,
    is_dir: s.dir,
    size: s.size,
    mod_time: new Date(s.mtime).toISOString(),
    mode: (s.mode & 0o7777).toString(8),
  }
}

/** A file session is an explicit domain capability. No fs object or local path execution is exposed to React. */
export class FileEndpoint {
  private protectedRoot?: Promise<string>
  private async localPolicy(path: string, mutation = false) {
    if (!this.local || !this.protectedRoot) return
    const root = await this.protectedRoot
    let current = resolve(nativePath(path))
    const rest: string[] = []
    while (true) {
      try {
        current = join(await fs.realpath(current), ...rest)
        break
      } catch (e) {
        if (!missing(e)) throw e
        const parent = dirname(current)
        if (parent === current) throw e
        rest.unshift(posix.basename(current.replace(/\\/g, '/')))
        current = parent
      }
    }
    if (process.platform === 'win32') current = current.toLowerCase()
    if (current === root || current.startsWith(root + sep) || (mutation && root.startsWith(current + sep)))
      fail('FORBIDDEN', '应用私有数据目录不能通过文件管理器访问或修改')
  }
  private channel?: SFTPWrapper
  private closed = false
  private pending = new Set<(error: unknown) => void>()
  private handles = new Set<FileHandle>()
  private closing?: Promise<void>
  constructor(channel?: SFTPWrapper, protectedRoot?: string) {
    this.channel = channel
    if (!channel && protectedRoot)
      this.protectedRoot = fs
        .realpath(protectedRoot)
        .then((path) => (process.platform === 'win32' ? path.toLowerCase() : path))
    channel?.on('error', () => undefined)
    channel?.once('close', () => {
      this.closed = true
      for (const reject of this.pending)
        reject(new DesktopError({ code: 'CONNECTION_LOST', message: '文件连接已断开，请重新连接后手动恢复' }))
      this.pending.clear()
    })
  }
  get local() {
    return !this.channel
  }
  private call<T>(start: (done: (e: Error | undefined | null, value: T) => void) => void): Promise<T> {
    if (this.closed) return Promise.reject(new Error('File session closed'))
    return new Promise((accept, reject) => {
      const finish = (e: unknown, v?: T) => {
        clearTimeout(timer)
        this.pending.delete(abort)
        if (e) reject(e)
        else accept(v!)
      }
      const abort = (e: unknown) => finish(e)
      const timer = setTimeout(() => {
        finish(new DesktopError({ code: 'SFTP_TIMEOUT', message: '服务器 20 秒未响应，请检查连接后手动恢复' }))
        this.channel?.destroy()
      }, 20000)
      this.pending.add(abort)
      try {
        start((e, v) => finish(e, v))
      } catch (e) {
        finish(e)
      }
    })
  }
  async stat(path: string): Promise<FileStat> {
    path = cleanPath(path)
    await this.localPolicy(path)
    if (this.channel) return convert(await this.call<Stats>((cb) => this.channel!.lstat(path, cb)))
    const s = await fs.lstat(nativePath(path))
    return {
      size: s.size,
      mtime: s.mtimeMs,
      mode: s.mode,
      dir: s.isDirectory(),
      link: s.isSymbolicLink(),
      identity: `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.mode}`,
    }
  }
  async optional(path: string): Promise<FileStat | undefined> {
    try {
      return await this.stat(path)
    } catch (e) {
      if (missing(e)) return
      throw e
    }
  }
  async guard(path: string, includeLeaf = true): Promise<void> {
    path = cleanPath(path)
    await this.localPolicy(path)
    const parts = path.split('/').filter(Boolean)
    let current = ''
    for (const part of parts.slice(0, includeLeaf ? undefined : -1)) {
      current += '/' + part
      if (this.local && process.platform === 'win32' && /^\/[a-z]:$/i.test(current)) continue
      if (
        this.local &&
        process.platform === 'win32' &&
        (current === '/UNC' || /^\/UNC\/[^/]+$/.test(current))
      )
        continue
      const s = await this.stat(current)
      if (
        this.local &&
        process.platform === 'darwin' &&
        ['/var', '/tmp', '/etc'].includes(current) &&
        (await fs.realpath(current)) === '/private' + current
      )
        continue
      if (s.link) fail('SYMLINK_UNSAFE', '符号链接路径不能用于文件修改或传输')
    }
  }
  async list(path: string): Promise<SftpEntry[]> {
    return (await this.listStats(path)).map((row) => entry(row.path, row.stat))
  }
  /** Keep READDIR attributes so recursive planning does not LSTAT every child again. */
  async listStats(path: string): Promise<Array<{ path: string; stat: FileStat }>> {
    path = cleanPath(path)
    await this.localPolicy(path)
    if (this.local && process.platform === 'win32' && path === '/') {
      const roots = []
      for (const drive of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const p = `/${drive}:/`
        const s = await this.optional(p)
        if (s) roots.push({ path: p, stat: s })
      }
      return roots
    }
    if (this.channel) {
      const handle = await this.call<Buffer>((cb) => this.channel!.opendir(path, cb)),
        rows: FileEntry[] = []
      try {
        while (true) {
          const next = await this.call<FileEntry[] | false>((cb) =>
            this.channel!.readdir(handle, (e, v) => {
              if ((e as { code?: number })?.code === 1) cb(null, false)
              else cb(e, v)
            }),
          )
          if (!next) break
          rows.push(...next)
          if (rows.length > 10000) fail('DIRECTORY_LIMIT', '目录条目超过 10000 项，请缩小范围')
        }
      } finally {
        await this.call<void>((cb) => this.channel!.close(handle, (e) => cb(e, undefined)))
      }
      return rows
        .filter(
          (r) =>
            r.filename !== '.' &&
            r.filename !== '..' &&
            !r.filename.includes('/') &&
            !r.filename.includes('\0'),
        )
        .map((r) => ({ path: posix.join(path, r.filename), stat: convert(r.attrs) }))
    }
    const dir = await fs.opendir(nativePath(path)),
      rows: Array<{ path: string; stat: FileStat }> = []
    try {
      for await (const row of dir) {
        if (rows.length >= 10000) fail('DIRECTORY_LIMIT', '目录条目超过 10000 项，请缩小范围')
        const p = posix.join(path, row.name)
        try {
          rows.push({ path: p, stat: await this.stat(p) })
        } catch (e) {
          if ((e as { error?: { code?: string } }).error?.code !== 'FORBIDDEN') throw e
        }
      }
    } finally {
      await dir.close().catch(() => undefined)
    }
    return rows
  }
  async open(path: string, write = false, exclusive = false): Promise<FileHandle> {
    await this.guard(path, !exclusive)
    if (!exclusive) {
      const s = await this.stat(path)
      if ((s.mode & 0o170000) !== 0o100000) fail('NOT_A_FILE', '只能读取或写入普通文件')
    }
    const channel = this.channel
    const remote = channel
      ? await this.call<Buffer>((cb) =>
          channel.open(path, write ? (exclusive ? 'wx' : 'r+') : 'r', 0o600, cb),
        )
      : undefined
    const local = channel
      ? undefined
      : await fs.open(
          nativePath(path),
          (write
            ? exclusive
              ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
              : constants.O_RDWR
            : constants.O_RDONLY) | (constants.O_NOFOLLOW ?? 0),
          0o600,
        )
    let closed: Promise<void> | undefined
    const handle: FileHandle = {
      read: async (offset, length) => {
        const buffer = Buffer.alloc(Math.min(length, 512 * 1024))
        let n: number
        if (channel) {
          const requests: Promise<number>[] = []
          for (let start = 0; start < buffer.length; start += PACKET_BYTES) {
            const end = Math.min(start + PACKET_BYTES, buffer.length)
            requests.push((async () => {
              let position = start
              while (position < end) {
                let count: number
                try {
                  count = await this.call<number>((cb) => channel.read(
                    remote!, buffer, position, end - position, offset + position, (e, n) => cb(e, n),
                  ))
                } catch (e) {
                  if ((e as { code?: number }).code === 1) break
                  throw e
                }
                if (!count) break
                position += count
              }
              return position - start
            })())
          }
          n = 0
          for (const count of await settle(requests)) {
            n += count
            if (count < PACKET_BYTES) break
          }
        } else n = (await local!.read(buffer, 0, buffer.length, offset)).bytesRead
        return buffer.subarray(0, n)
      },
      write: async (offset, bytes) => {
        const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        if (channel) {
          for (let window = 0; window < buffer.length; window += 512 * 1024) {
            const end = Math.min(window + 512 * 1024, buffer.length)
            const requests: Promise<void>[] = []
            for (let start = window; start < end; start += PACKET_BYTES) {
              const length = Math.min(PACKET_BYTES, end - start)
              requests.push(this.call<void>((cb) => channel.write(
                remote!, buffer, start, length, offset + start, (e) => cb(e, undefined),
              )))
            }
            await settle(requests)
          }
        } else {
          let n = 0
          while (n < buffer.length) {
            const r = await local!.write(buffer, n, buffer.length - n, offset + n)
            if (!r.bytesWritten) fail('WRITE_FAILED', '文件写入未完成')
            n += r.bytesWritten
          }
        }
      },
      sync: async () => {
        if (local) await local.sync()
      },
      close: () => {
        closed ??= (async () => {
          try {
            if (channel) await this.call<void>((cb) => channel.close(remote!, (e) => cb(e, undefined)))
            else await local!.close()
          } finally {
            this.handles.delete(handle)
          }
        })()
        return closed
      },
    }
    this.handles.add(handle)
    return handle
  }
  async mkdir(path: string): Promise<void> {
    await this.guard(path, false)
    if (this.channel)
      await this.call<void>((cb) => this.channel!.mkdir(path, { mode: 0o700 }, (e) => cb(e, undefined)))
    else await fs.mkdir(nativePath(path), { mode: 0o700 })
  }
  async chmod(path: string, mode: number): Promise<void> {
    await this.guard(path)
    if (this.channel)
      await this.call<void>((cb) => this.channel!.chmod(path, mode & 0o777, (e) => cb(e, undefined)))
    else await fs.chmod(nativePath(path), mode & 0o777)
  }
  async remove(path: string, dir = false): Promise<void> {
    await this.localPolicy(path, true)
    await this.guard(path, false)
    if (this.channel)
      await this.call<void>((cb) => {
        if (dir) this.channel!.rmdir(path, (e) => cb(e, undefined))
        else this.channel!.unlink(path, (e) => cb(e, undefined))
      })
    else if (dir) await fs.rmdir(nativePath(path))
    else await fs.unlink(nativePath(path))
  }
  async rename(from: string, to: string, replace = false): Promise<void> {
    await this.localPolicy(from, true)
    await this.localPolicy(to, true)
    await this.guard(from)
    await this.guard(to, false)
    if (this.channel) {
      if (replace) {
        try {
          await this.call<void>((cb) => this.channel!.ext_openssh_rename(from, to, (e) => cb(e, undefined)))
        } catch (e) {
          if ((e as { code?: number }).code === 8 || String(e).includes('Server does not support'))
            fail('ATOMIC_REPLACE_UNSUPPORTED', '服务器不支持安全替换，请另存为新文件')
          throw e
        }
      } else {
        if (await this.optional(to)) fail('FILE_EXISTS', '目标已经存在')
        await this.call<void>((cb) => this.channel!.rename(from, to, (e) => cb(e, undefined)))
      }
    } else if (replace) await fs.rename(nativePath(from), nativePath(to))
    else {
      const s = await this.stat(from)
      if (s.dir) {
        if (await this.optional(to)) fail('FILE_EXISTS', '目标已经存在')
        await fs.rename(nativePath(from), nativePath(to))
      } else {
        await fs.link(nativePath(from), nativePath(to))
        await fs.unlink(nativePath(from))
      }
    }
  }
  async close(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.allSettled([...this.handles].map((h) => h.close()))
      if (this.channel && !this.closed) {
        const ended = new Promise<void>((resolve) => this.channel!.once('close', resolve))
        this.channel.destroy()
        await ended
      }
      this.closed = true
    })()
    return this.closing
  }
}
