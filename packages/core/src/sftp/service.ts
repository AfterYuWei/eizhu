import { randomUUID, createHash } from 'node:crypto'
import type { Hash } from 'node:crypto'
import { posix, join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { fail, failureOf, sftp } from '@eizhu/contracts'
import type { RuntimeContext } from '@eizhu/contracts'
import type { SftpSessionInfo } from '@eizhu/contracts/models/api'
import type { TransferTask, SftpTreeNode, SftpConflictInfo } from '@eizhu/contracts/models/sftp'
import type { WorkerClient } from '../workers/client.ts'
import { SshService } from '../ssh/service.ts'
import { SshConnection } from '../ssh/connection.ts'
import { FileEndpoint, cleanPath, displayPath, entry } from './endpoint.ts'
import type { FileStat, FileHandle } from './endpoint.ts'
import { fileHash, readText, writeText, hash } from './editor.ts'
import { archive, collect } from './archive.ts'
import type { ArchiveEntry } from './archive.ts'

interface FileSession {
  borrowed?: boolean
  meta: SftpSessionInfo
  binding?: string
  connection?: SshConnection
  endpoint?: FileEndpoint
  task?: Promise<void>
  closing?: Promise<void>
}
interface CopyFile {
  source: string
  dest: string
  stat: FileStat
  target?: FileStat
  temporary: string
  offset: number
  prefixHash?: string
  complete: boolean
  dir: boolean
}
interface Checkpoint {
  task: TransferTask
  sourceProfile: string
  targetProfile: string
  sourceSession: string
  targetSession: string
  sourceBinding?: string
  targetBinding?: string
  files: CopyFile[]
  index: number
  upload?: { size: number; lastModified: number; sequence: number; prefixHash?: string; prefixBytes?: number }
  download?: boolean
  dragRoot?: string
  archive?: { paths: string[]; rows: ArchiveEntry[]; format: 'tar.gz' | 'zip'; spool: string; ready: boolean }
}
interface Job {
  checkpoint: Checkpoint
  run?: Promise<void>
  controller: AbortController
  handle?: FileHandle
  uploadId?: string
  digest?: Hash
  started?: number
  initial?: number
  busy: boolean
  lastEvent: number
  chain: Promise<unknown>
}
type Emit = (name: 'eizhu-sftp-message', payload: unknown) => void
const activeStatuses = ['queued', 'transferring']
function transferFailure(cause: unknown) {
  const code = (cause as { code?: string | number } | null)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT')
    return { code: 'DISK_FULL', message: '目标磁盘空间或配额不足，请清理空间后重新开始' }
  if (code === 'EACCES' || code === 'EPERM' || code === 3)
    return { code: 'PERMISSION_DENIED', message: '没有文件读写权限，请检查目录和文件权限' }
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ENOTCONN' || code === 7)
    return { code: 'CONNECTION_LOST', message: '文件连接已断开，请重新连接后手动恢复' }
  return failureOf(cause)
}

/** Five active streams, durable encrypted checkpoints, and explicit session ownership. */
export class SftpService {
  private sessions = new Map<string, FileSession>()
  private jobs = new Map<string, Job>()
  private uploads = new Map<string, Job>()
  private active = 0
  private closed = false
  private closing?: Promise<void>
  private ready: Promise<void>
  private directory: string
  private spoolEndpoint = new FileEndpoint()
  private queries = 0
  private mutations = new Map<string, Promise<unknown>>()
  private async mutate<T>(profile: string, work: () => Promise<T>): Promise<T> {
    const prior = this.mutations.get(profile) ?? Promise.resolve(),
      task = prior.catch(() => undefined).then(work)
    this.mutations.set(profile, task)
    try {
      return await task
    } finally {
      if (this.mutations.get(profile) === task) this.mutations.delete(profile)
    }
  }
  private associate(c: Checkpoint) {
    for (const side of ['source', 'target'] as const) {
      const profile = c[`${side}Profile`]
      if (profile === '__staging__' || (side === 'source' && c.upload)) continue
      const s = [...this.sessions.values()].find(
        (s) =>
          s.meta.profile_id === profile && s.meta.status === 'connected' && s.binding === c[`${side}Binding`],
      )
      if (!s) fail('ENDPOINT_CHANGED', '请连接原服务器、用户及主机密钥后恢复任务')
      c[`${side}Session`] = s.meta.id
    }
  }
  private ssh: SshService
  private database: WorkerClient
  private context: RuntimeContext
  private emit: Emit
  private localHome: string
  private protectedRoot?:string
  constructor(
    ssh: SshService,
    database: WorkerClient,
    context: RuntimeContext,
    root: string,
    emit: Emit,
    localHome?:string,
  ) {
    this.ssh = ssh
    this.database = database
    this.context = context
    this.emit = emit
    this.localHome = localHome??homedir()
    this.protectedRoot=localHome?undefined:root
    this.directory = join(root, 'transfers', context.workspaceId)
    this.ready = this.restore()
  }
  private async restore() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const saved = await this.database.call<Checkpoint[]>('sftp.storage.list')
    for (const c of saved) {
      if (activeStatuses.includes(c.task.status) || c.task.status === 'paused') {
        c.task.status = 'recoverable'
        c.task.speed = 0
      }
      this.jobs.set(c.task.id, {
        checkpoint: c,
        controller: new AbortController(),
        busy: false,
        lastEvent: 0,
        chain: Promise.resolve(),
      })
    }
  }
  private async save(job: Job, event = true, force = false) {
    const c = job.checkpoint
    c.task.confirmed_offset = c.task.transferred
    await this.database.call('sftp.storage.save', { id: c.task.id, value: c })
    if (event && (force || Date.now() - job.lastEvent > 100 || !activeStatuses.includes(c.task.status))) {
      job.lastEvent = Date.now()
      this.emit('eizhu-sftp-message', {
        type:
          c.task.status === 'completed'
            ? 'transfer_complete'
            : c.task.status === 'failed'
              ? 'transfer_failed'
              : 'transfer_progress',
        workspaceGeneration: this.context.generation,
        payload: { ...c.task, task_id: c.task.id },
      })
    }
  }
  private async phase(job: Job, phase: NonNullable<TransferTask['phase']>) {
    job.checkpoint.task.phase = phase
    job.checkpoint.task.speed = 0
    await this.save(job, true, true)
    job.controller.signal.throwIfAborted()
  }
  private sessionEvent(s: FileSession) {
    this.emit('eizhu-sftp-message', {
      type: 'sftp_session_status',
      workspaceGeneration: this.context.generation,
      payload: { session_id: s.meta.id, status: s.meta.status },
    })
  }
  private getSession(id: string) {
    return this.sessions.get(id) ?? fail('NOT_FOUND', '文件会话已关闭，请重新连接')
  }
  private endpoint(id: string) {
    const s = this.getSession(id)
    if (s.meta.status !== 'connected' || !s.endpoint)
      fail('SFTP_NOT_CONNECTED', '文件会话未连接，请先连接服务器')
    return s.endpoint
  }
  private forProfile(profile: string, binding?: string, sessionId?: string): FileEndpoint {
    if (profile === '__staging__') return this.spoolEndpoint
    const candidates = sessionId
      ? [this.sessions.get(sessionId)].filter((s): s is FileSession => Boolean(s))
      : [...this.sessions.values()]
    const s = candidates.find(
      (s) =>
        s.meta.profile_id === profile && s.meta.status === 'connected' && (!binding || s.binding === binding),
    )
    return s?.endpoint ?? fail('SFTP_NOT_CONNECTED', '请先连接传输所需的本机或服务器标签页，再手动恢复任务')
  }
  private async connect(s: FileSession) {
    const connection = (s.connection = new SshConnection())
    try {
      const { client, binding } = await this.ssh.connectFiles(
        s.meta.id,
        s.meta.profile_id,
        connection,
        (type, payload) => {
          const p = payload as { request_id?: string; fingerprint?: string; known_fingerprint?: string }
          if (type === 'host_key')
            Object.assign(s.meta, {
              status: 'hostkey_confirm',
              host_key_request_id: p.request_id,
              host_key_fingerprint: p.fingerprint,
              known_host_key_fingerprint: p.known_fingerprint,
            })
          if (type === 'auth_request') Object.assign(s.meta, { status: 'connecting', auth_request: payload })
          if (type === 'auth_closed') {
            delete (s.meta as SftpSessionInfo & { auth_request?: unknown }).auth_request
            delete s.meta.host_key_request_id
            delete s.meta.host_key_fingerprint
            delete s.meta.known_host_key_fingerprint
            if (s.meta.status === 'hostkey_confirm') s.meta.status = 'connecting'
          }
          this.sessionEvent(s)
        },
        () => {
          if (s.closing) return
          s.meta.status = 'disconnected'
          this.sessionEvent(s)
          void this.pauseSession(s.meta.id)
            .then(() => s.endpoint?.close())
            .then(() => connection.close())
            .catch(() => undefined)
        },
      )
      if (s.closing || connection.controller.signal.aborted) return
      s.binding = binding
      const channel = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) =>
        client.sftp((e, c) => (e ? reject(e) : resolve(c))),
      )
      if (s.closing) {
        channel.destroy()
        return
      }
      s.endpoint = new FileEndpoint(channel)
      s.meta.home_dir = await new Promise<string>((resolve, reject) =>
        channel.realpath('.', (e, p) => (e ? reject(e) : resolve(p))),
      )
      s.meta.status = 'connected'
      s.meta.error = undefined
      this.sessionEvent(s)
    } catch (e) {
      if (!s.closing) {
        s.meta.status = 'error'
        s.meta.error = failureOf(e).message
        this.sessionEvent(s)
      }
      await connection.close()
    }
  }
  private async create(profileId: string) {
    if (this.sessions.size >= 128) fail('QUEUE_FULL', '文件会话过多')
    if (profileId !== 'local') await this.database.call('profile.get', { id: profileId })
    const id = randomUUID(),
      s: FileSession = {
        meta: {
          id,
          profile_id: profileId,
          status: profileId === 'local' ? 'connected' : 'connecting',
          created_at: new Date().toISOString(),
        },
      }
    this.sessions.set(id, s)
    if (profileId === 'local') {
      s.endpoint = new FileEndpoint(undefined,this.protectedRoot)
      s.binding = 'local'
      s.meta.home_dir = displayPath(this.localHome)
    } else s.task = this.connect(s)
    return { session_id: id, status: s.meta.status, home_dir: s.meta.home_dir }
  }
  private async pauseSession(id: string) {
    await Promise.all(
      [...this.jobs.values()]
        .filter((j) => j.checkpoint.sourceSession === id || j.checkpoint.targetSession === id)
        .filter((j) => activeStatuses.includes(j.checkpoint.task.status))
        .map((j) => this.stop(j, 'paused')),
    )
  }
  private closeSession(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return Promise.resolve()
    s.closing ??= (async () => {
      this.ssh.releaseFiles(id)
      await this.pauseSession(id)
      await s.endpoint?.close()
      await s.connection?.close()
      await s.task
      this.sessions.delete(id)
    })()
    return s.closing
  }
  private job(id: string) {
    return this.jobs.get(id) ?? fail('NOT_FOUND', '传输记录不存在')
  }
  private serial<T>(job: Job, work: () => Promise<T>): Promise<T> {
    const next = job.chain.catch(() => undefined).then(work)
    job.chain = next
    return next
  }
  private task(
    c: Omit<Checkpoint, 'task'>,
    name: string,
    size: number,
    direction: TransferTask['direction'],
  ): Job {
    if (this.jobs.size >= 1000) fail('QUEUE_FULL', '传输记录达到上限，请先清理已完成任务')
    const job: Job = {
      checkpoint: {
        ...c,
        sourceBinding: this.sessions.get(c.sourceSession)?.binding,
        targetBinding: this.sessions.get(c.targetSession)?.binding,
        task: {
          id: randomUUID(),
          file_name: name,
          direction,
          size,
          transferred: 0,
          status: 'queued',
          speed: 0,
          started_at: Date.now(),
          execution_generation: 0,
          source_profile: c.sourceProfile,
          target_profile: c.targetProfile,
        },
      },
      controller: new AbortController(),
      busy: false,
      lastEvent: 0,
      chain: Promise.resolve(),
    }
    this.jobs.set(job.checkpoint.task.id, job)
    return job
  }
  private async target(endpoint: FileEndpoint, path: string) {
    const stat = await endpoint.optional(path)
    if (stat?.link) fail('SYMLINK_UNSAFE', '目标是符号链接，不能覆盖')
    return { stat }
  }
  private async checkTarget(endpoint: FileEndpoint, file: CopyFile, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const now = await endpoint.optional(file.dest)
    signal?.throwIfAborted()
    if (
      now?.identity !== file.target?.identity ||
      now?.link
    )
      fail('TARGET_CHANGED', '目标文件已变化，原目标已保留，请重新选择冲突处理')
  }
  private async conflict(
    source: FileEndpoint,
    target: FileEndpoint,
    paths: string[],
    destDir: string,
    mode: 'preserve' | 'archive',
    resolution: string,
  ) {
    const rows = await collect(source, paths),
      result: CopyFile[] = [],
      conflicts: SftpConflictInfo[] = []
    const renamed = new Map<string, string>(),
      skipped: string[] = [],
      planned = new Set<string>()
    for (const row of rows) {
      if (skipped.some((path) => row.path.startsWith(path + '/'))) continue
      if (mode === 'archive' && paths.some((p) => row.path !== p && row.path.startsWith(p + '/'))) continue
      let dest = posix.join(destDir, row.name + (mode === 'archive' && row.dir ? '.tar.gz' : ''))
      for (const [from, to] of renamed)
        if (row.path.startsWith(from + '/')) dest = posix.join(to, posix.relative(from, row.path))
      let existing = await this.target(target, dest)
      if (
        existing.stat &&
        (!(row.dir && mode === 'preserve' && existing.stat.dir) || resolution === 'rename')
      ) {
        conflicts.push({
          source_path: row.path,
          dest_path: dest,
          source_size: row.size,
          dest_size: existing.stat.size,
          source_is_dir: row.dir,
          dest_is_dir: existing.stat.dir,
        })
        if (resolution === 'skip') {
          if (row.dir) skipped.push(row.path)
          continue
        }
        if (resolution === 'rename') {
          let i = 1
          const ext = row.dir && mode === 'preserve' ? '' : posix.extname(dest),
            base = dest.slice(0, dest.length - ext.length)
          while ((await target.optional(dest)) || planned.has(dest)) dest = `${base} (${i++})${ext}`
          if (row.dir && mode === 'preserve') renamed.set(row.path, dest)
          existing = { stat: undefined }
        } else if (resolution === 'overwrite' && existing.stat.dir !== (row.dir && mode === 'preserve'))
          fail('TYPE_CONFLICT', '文件与目录类型冲突，不能覆盖')
      }
      const key = target.local && ['darwin', 'win32'].includes(process.platform) ? dest.toLowerCase() : dest
      if (planned.has(key)) fail('DUPLICATE_DESTINATION', '所选文件的目标名称重复，请分开传输或先重命名')
      planned.add(key)
      result.push({
        source: row.path,
        dest,
        stat: row,
        target: existing.stat,
        temporary: posix.join(posix.dirname(dest), `.eizhu-${randomUUID()}.part`),
        offset: 0,
        complete: false,
        dir: row.dir && mode === 'preserve',
      })
    }
    return { files: result, conflicts, rows }
  }
  private schedule() {
    if (this.closed) return
    for (const job of this.jobs.values()) {
      if (this.active >= 5) break
      if (job.busy || job.checkpoint.upload || job.checkpoint.task.status !== 'queued') continue
      job.busy = true
      this.active++
      job.run = this.run(job)
        .catch(async (e) => {
          if (job.controller.signal.aborted) return
          const f = transferFailure(e)
          Object.assign(job.checkpoint.task, {
            status: 'failed',
            speed: 0,
            error_code: f.code,
            error_message: f.message,
            retryable: true,
          })
          await this.save(job)
        })
        .finally(() => {
          job.busy = false
          this.active--
          this.schedule()
        })
    }
  }
  private async materialize(job: Job) {
    const c = job.checkpoint,
      a = c.archive!
    if (a.ready) return
    const source = this.forProfile(c.sourceProfile, c.sourceBinding, c.sourceSession),
      local = this.spoolEndpoint
    if (await local.optional(a.spool)) await local.remove(a.spool)
    const output = await local.open(a.spool, true, true),
      stream = archive(source, a.rows, a.format, job.controller.signal)
    let offset = 0
    try {
      for await (const bytes of stream) {
        job.controller.signal.throwIfAborted()
        await output.write(offset, bytes)
        offset += bytes.length
      }
      await output.sync()
    } finally {
      stream.destroy()
      await output.close()
    }
    a.ready = true
    const f = c.files[0]
    f.source = a.spool
    f.stat = await local.stat(a.spool)
    c.task.size = f.stat.size
    await this.save(job)
  }
  private async run(job: Job) {
    const c = job.checkpoint,
      t = c.task,
      start = Date.now(),
      initial = t.transferred
    t.status = 'transferring'
    t.phase = 'preparing'
    delete t.error_code
    delete t.error_message
    await this.save(job)
    if (c.archive) await this.materialize(job)
    const source = c.archive
        ? this.spoolEndpoint
        : this.forProfile(c.sourceProfile, c.sourceBinding, c.sourceSession),
      target = this.forProfile(c.targetProfile, c.targetBinding, c.targetSession)
    for (; c.index < c.files.length; c.index++) {
      job.controller.signal.throwIfAborted()
      const f = c.files[c.index]
      if (f.complete) continue
      if (f.dir) {
        await target.guard(f.dest, false)
        const existing = await target.optional(f.dest)
        if (!existing) await target.mkdir(f.dest)
        else if (!existing.dir || existing.link) fail('TARGET_CHANGED', '目录目标已变化')
        f.complete = true
        await this.save(job)
        continue
      }
      await source.guard(f.source)
      if ((await source.stat(f.source)).identity !== f.stat.identity)
        fail('SOURCE_CHANGED', '源文件已变化，请重新开始')
      await this.phase(job, 'verifying')
      await this.checkTarget(target, f, job.controller.signal)
      const stage = await target.optional(f.temporary)
      if (f.offset) {
        if (
          !stage ||
          stage.size !== f.offset ||
          (await fileHash(target, f.temporary, undefined, job.controller.signal)) !== f.prefixHash
        )
          fail('CHECKPOINT_CHANGED', '源文件或暂存文件与检查点不一致，请重新开始')
      } else if (stage) fail('CHECKPOINT_CHANGED', '暂存文件状态与检查点不一致')
      const input = await source.open(f.source)
      let output: FileHandle | undefined
      const digest = createHash('sha256')
      try {
        output = await target.open(f.temporary, true, !f.offset)
        if (f.offset) {
          let p = 0
          while (p < f.offset) {
            job.controller.signal.throwIfAborted()
            const b = await input.read(p, Math.min(512 * 1024, f.offset - p))
            if (!b.length) fail('SOURCE_CHANGED', '源文件发生变化')
            digest.update(b)
            p += b.length
          }
          if (digest.copy().digest('hex') !== f.prefixHash)
            fail('CHECKPOINT_CHANGED', '源文件与检查点不一致，请重新开始')
        }
        await this.phase(job, 'transferring')
        while (f.offset < f.stat.size) {
          job.controller.signal.throwIfAborted()
          const b = await input.read(f.offset, Math.min(512 * 1024, f.stat.size - f.offset))
          if (!b.length) fail('SOURCE_CHANGED', '源文件已截断')
          await output.write(f.offset, b)
          await output.sync()
          digest.update(b)
          f.offset += b.length
          f.prefixHash = digest.copy().digest('hex')
          t.transferred += b.length
          t.speed = Math.max(0, ((t.transferred - initial) * 1000) / Math.max(1, Date.now() - start))
          await this.save(job)
        }
        await this.phase(job, 'verifying')
      } finally {
        await Promise.allSettled([input.close(), output?.close()]).then((closed) => {
          for (const result of closed) if (result.status === 'rejected') throw result.reason
        })
      }
      job.controller.signal.throwIfAborted()
      const written = await target.stat(f.temporary)
      if (
        (await source.stat(f.source)).identity !== f.stat.identity ||
        (written.mode & 0o170000) !== 0o100000 || written.size !== f.stat.size
      )
        fail('VERIFY_FAILED', '文件校验失败，原目标已保留')
      await target.chmod(f.temporary, f.stat.mode)
      await this.phase(job, 'committing')
      await this.mutate(c.targetProfile, async () => {
        await this.checkTarget(target, f, job.controller.signal)
        job.controller.signal.throwIfAborted()
        await target.rename(f.temporary, f.dest, !!f.target)
      })
      f.complete = true
      await this.save(job)
    }
    Object.assign(t, { status: 'completed', transferred: t.size, speed: 0, finished_at: Date.now() })
    await this.save(job)
  }
  private async stop(job: Job, status: 'paused' | 'cancelled') {
    if (job.checkpoint.task.status === 'cancelled') {
      await this.cleanup(job)
      return job.checkpoint.task
    }
    if (job.checkpoint.task.status === 'completed') return job.checkpoint.task
    job.controller.abort()
    await job.run
    await this.serial(job, async () => {
      // A successful rename can win a concurrent pause/cancel. Preserve that outcome.
      if (job.checkpoint.task.status === 'completed') return
      await job.handle?.close()
      job.handle = undefined
      if (job.uploadId) {
        this.uploads.delete(job.uploadId)
        job.uploadId = undefined
        if (job.busy) {
          job.busy = false
          this.active--
        }
      }
      job.checkpoint.task.status = status
      job.checkpoint.task.speed = 0
      await this.save(job)
      if (status === 'cancelled') await this.cleanup(job)
    })
    this.schedule()
    return job.checkpoint.task
  }
  private async cleanup(job: Job) {
    const c = job.checkpoint
    for (const f of c.files)
      if (!f.complete)
        await this.forProfile(c.targetProfile, c.targetBinding)
          .remove(f.temporary)
          .catch(() => undefined)
    if (c.archive) await this.spoolEndpoint.remove(c.archive.spool).catch(() => undefined)
    if (c.download)
      for (const f of [...c.files].reverse())
        await this.spoolEndpoint.remove(f.dest, f.dir).catch(() => undefined)
    if (c.dragRoot) await this.spoolEndpoint.remove(c.dragRoot, true).catch(() => undefined)
  }
  private async resume(job: Job, restart = false) {
    if (job.busy) fail('TRANSFER_BUSY', '传输正在进行')
    const c = job.checkpoint
    if (c.upload) fail('UPLOAD_FILE_REQUIRED', '请重新选择原上传文件')
    if (c.task.status === 'completed' || c.task.status === 'cancelled')
      fail('TRANSFER_FINISHED', '任务已结束')
    this.associate(c)
    if (restart) {
      await this.cleanup(job)
      c.index = 0
      c.task.transferred = 0
      for (const f of c.files) {
        f.offset = 0
        f.complete = false
        f.prefixHash = undefined
        f.temporary = posix.join(posix.dirname(f.dest), `.eizhu-${randomUUID()}.part`)
        if (!c.archive)
          f.stat = await this.forProfile(c.sourceProfile, c.sourceBinding, c.sourceSession).stat(f.source)
      }
      if (c.archive) {
        c.archive.ready = false
        c.archive.rows = await collect(
          this.forProfile(c.sourceProfile, c.sourceBinding, c.sourceSession),
          c.archive.paths,
        )
      } else c.task.size = c.files.reduce((size, file) => size + (file.dir ? 0 : file.stat.size), 0)
    }
    job.controller = new AbortController()
    c.task.status = 'queued'
    c.task.execution_generation = (c.task.execution_generation ?? 0) + 1
    await this.save(job)
    this.schedule()
    return c.task
  }
  async execute(operation: keyof typeof sftp, raw: unknown): Promise<unknown> {
    await this.ready
    if (this.closed) fail('RUNTIME_CLOSED', '文件服务已关闭')
    const d = sftp[operation].input.parse(raw)
    switch (operation) {
      case 'sftp.createSession':
        return this.create((d as { profileId: string }).profileId)
      case 'sftp.getSession':
        return this.getSession((d as { id: string }).id).meta
      case 'sftp.listSessions':
        return [...this.sessions.values()].map((s) => s.meta)
      case 'sftp.closeSession':
        return this.closeSession((d as { id: string }).id)
      case 'sftp.reconnectSession': {
        const { id } = d as { id: string }
        const old = this.getSession(id),
          profile = old.meta.profile_id
        await this.closeSession(id)
        return this.create(profile)
      }
      case 'sftp.hostKeyDecide': {
        const p = sftp[operation].input.parse(d)
        const session = [...this.sessions.values()].find(
          (s) => s.meta.host_key_request_id === p.requestId || s.meta.id === p.requestId,
        )
        if (!session?.meta.host_key_request_id) fail('STALE_CONFIRMATION', '主机指纹确认已过期')
        return this.ssh.decideFiles(session.meta.host_key_request_id, p.fingerprint, p.decision)
      }
      case 'sftp.listTransfers': {
        const p = sftp[operation].input.parse(d)
        return [...this.jobs.values()]
          .filter(
            (j) =>
              (!p.sessionId ||
                [j.checkpoint.sourceSession, j.checkpoint.targetSession].includes(p.sessionId)) &&
              (!p.status || j.checkpoint.task.status === p.status),
          )
          .map((j) => j.checkpoint.task)
      }
      case 'sftp.pauseTransfer':
        return this.stop(this.job((d as { taskId: string }).taskId), 'paused')
      case 'sftp.cancelTransfer':
        return this.stop(this.job((d as { taskId: string }).taskId), 'cancelled')
      case 'sftp.resumeTransfer':
        return this.resume(this.job((d as { taskId: string }).taskId))
      case 'sftp.retryTransfer': {
        const p = sftp[operation].input.parse(d)
        return this.resume(this.job(p.taskId), p.restart)
      }
      case 'sftp.clearCompletedTransfers': {
        for (const [id, j] of this.jobs)
          if (['completed', 'cancelled'].includes(j.checkpoint.task.status)) {
            await this.cleanup(j)
            await this.database.call('sftp.storage.delete', { id })
            this.jobs.delete(id)
          }
        return
      }
      case 'sftp.uploadCheckpoint': {
        const c = this.job((d as { taskId: string }).taskId).checkpoint
        if (!c.upload) fail('BAD_REQUEST', '该任务不是上传')
        return {
          size: c.upload.size,
          last_modified: c.upload.lastModified,
          prefix_hash: c.upload.prefixHash,
          prefix_bytes: c.upload.prefixBytes,
        }
      }
      case 'sftp.uploadBegin':
        return this.uploadBegin(sftp[operation].input.parse(d))
      case 'sftp.resumeUpload':
        return this.resumeUpload(sftp[operation].input.parse(d))
      case 'sftp.uploadChunk': {
        const p = sftp[operation].input.parse(d),
          j = this.uploads.get(p.uploadId) ?? fail('NOT_FOUND', '上传通道已关闭')
        return this.serial(j, () => this.uploadChunk(j, p.data, p.sequence))
      }
      case 'sftp.uploadFinish': {
        const p = sftp[operation].input.parse(d),
          j = this.uploads.get(p.uploadId) ?? fail('NOT_FOUND', '上传通道已关闭')
        return this.serial(j, async () => {
          j.controller.signal.throwIfAborted()
          if (!j.handle || !j.uploadId) fail('NOT_FOUND', '上传通道已关闭')
          if (j.run) fail('TRANSFER_BUSY', '正在提交上传，请等待任务结果')
          if (j.checkpoint.files[0].offset !== j.checkpoint.task.size)
            fail('UPLOAD_INCOMPLETE', '上传尚未完成')
          // Completion may include checking a large existing target. It is a job,
          // not a 30-second RPC; errors and completion are delivered through task events.
          j.run = this.uploadFinish(j)
            .catch((e) => this.uploadFailed(j, e))
            .finally(() => {
              this.releaseUpload(j)
              this.schedule()
            })
          return { tasks: [{ ...j.checkpoint.task }] }
        })
      }
      case 'sftp.download':
        return this.download(sftp[operation].input.parse(d))
      case 'sftp.prepareDrag':
        return this.prepareDrag(sftp[operation].input.parse(d))
      case 'sftp.releaseDrag': {
        const { taskIds } = sftp[operation].input.parse(d)
        for (const id of taskIds) {
          const j = this.job(id)
          if (!j.checkpoint.dragRoot) fail('FORBIDDEN', '该任务不是系统拖出任务')
          if (j.checkpoint.task.status !== 'completed') await this.stop(j, 'cancelled')
          await this.cleanup(j)
          await this.database.call('sftp.storage.delete', { id })
          this.jobs.delete(id)
        }
        return
      }
      case 'sftp.downloadChunk': {
        const p = sftp[operation].input.parse(d),
          c = this.job(p.taskId).checkpoint
        if (!c.download || c.task.status !== 'completed') fail('DOWNLOAD_NOT_READY', '下载尚未完成')
        const h = await this.spoolEndpoint.open(c.files[0].dest)
        try {
          return await h.read(p.offset, p.maxBytes)
        } finally {
          await h.close()
        }
      }
      case 'sftp.downloadClose':
        return
      case 'sftp.transfer':
        return this.transfer(sftp[operation].input.parse(d))
      case 'sftp.move':
        return this.mutate(this.getSession((d as { sessionId: string }).sessionId).meta.profile_id, () =>
          this.move(sftp[operation].input.parse(d)),
        )
      case 'sftp.exportDownload':
      case 'sftp.startDrag':
        return fail('FORBIDDEN', '系统文件操作需要主进程授权')
      default:
        return ['sftp.writeFile', 'sftp.mkdir', 'sftp.rename', 'sftp.delete'].includes(operation)
          ? this.mutate(this.getSession((d as { sessionId: string }).sessionId).meta.profile_id, () =>
              this.files(operation, d),
            )
          : this.files(operation, d)
    }
  }
  private async files(operation: keyof typeof sftp, raw: unknown) {
    if (this.queries >= 16) fail('QUEUE_FULL', '文件操作过多，请稍后重试')
    this.queries++
    try {
      const d = raw as { sessionId: string; path: string },
        endpoint = this.endpoint(d.sessionId),
        path = d.path ? cleanPath(d.path) : ''
      switch (operation) {
        case 'sftp.list':
          return {
            path,
            entries: (await endpoint.list(path)).filter(
              (e) => (raw as { showHidden: boolean }).showHidden || !e.name.startsWith('.'),
            ),
          }
        case 'sftp.stat':
          return entry(path, await endpoint.stat(path))
        case 'sftp.mkdir':
          await endpoint.mkdir(path)
          return entry(path, await endpoint.stat(path))
        case 'sftp.rename': {
          const p = raw as { oldPath: string; newPath: string }
          await endpoint.rename(cleanPath(p.oldPath), cleanPath(p.newPath))
          return entry(cleanPath(p.newPath), await endpoint.stat(p.newPath))
        }
        case 'sftp.tree': {
          let count = 0
          const walk = async (p: string, depth: number): Promise<SftpTreeNode[]> => {
            const rows = await endpoint.list(p)
            count += rows.length
            if (count > 10000) fail('DIRECTORY_LIMIT', '目录条目超过 10000 项')
            const out: SftpTreeNode[] = []
            for (const r of rows) {
              const s = await endpoint.stat(r.path)
              out.push({
                ...r,
                ...(depth > 0 && s.dir && !s.link ? { children: await walk(r.path, depth - 1) } : {}),
              })
            }
            return out
          }
          return { path, entries: await walk(path, (raw as { depth: number }).depth) }
        }
        case 'sftp.delete': {
          const paths = (raw as { paths: string[] }).paths
          let deleted = 0,
            failed = 0
          for (const p of paths) {
            try {
              const path = cleanPath(p)
              if (path === '/' || /^\/[a-z]:\/$/i.test(path)) fail('BAD_PATH', '不能删除文件系统根目录')
              const rows = await collect(endpoint, [path])
              for (const r of rows.reverse()) await endpoint.remove(r.path, r.dir)
              deleted++
            } catch {
              failed++
            }
          }
          return { deleted, failed }
        }
        case 'sftp.readFile':
          return readText(endpoint, path)
        case 'sftp.writeFile':
          return writeText(
            endpoint,
            path,
            (raw as Parameters<typeof writeText>[2] & { request: Parameters<typeof writeText>[2] }).request,
          )
        default:
          return fail('UNKNOWN_OPERATION', '未开放的文件操作')
      }
    } finally {
      this.queries--
    }
  }
  private async transfer(p: import('zod').infer<(typeof sftp)['sftp.transfer']['input']>) {
    const source = this.endpoint(p.sourceSessionId),
      target = this.endpoint(p.targetSessionId),
      paths = p.paths.map(cleanPath),
      destDir = cleanPath(p.destDir)
    const sourceOwner = this.getSession(p.sourceSessionId),
      targetOwner = this.getSession(p.targetSessionId),
      sameEndpoint = source === target || sourceOwner.binding === targetOwner.binding
    if (
      sameEndpoint &&
      paths.some(
        (path) =>
          destDir === path ||
          destDir.startsWith(path + '/') ||
          (p.directoryMode === 'preserve' && posix.join(destDir, posix.basename(path)) === path),
      )
    )
      fail('BAD_PATH', '不能复制到自身或子目录')
    const result = await this.conflict(source, target, paths, destDir, p.directoryMode, p.conflictResolution)
    if (p.conflictResolution === 'ask' && result.conflicts.length) return { conflicts: result.conflicts }
    const created: Job[] = []
    if (p.directoryMode === 'archive')
      for (const f of result.files) {
        const dir = f.stat.dir
        const rows = result.rows.filter((row) => row.path === f.source || row.path.startsWith(f.source + '/'))
        const job = this.task(
          {
            sourceProfile: this.getSession(p.sourceSessionId).meta.profile_id,
            targetProfile: this.getSession(p.targetSessionId).meta.profile_id,
            sourceSession: p.sourceSessionId,
            targetSession: p.targetSessionId,
            files: [f],
            index: 0,
            ...(dir
              ? {
                  archive: {
                    paths: [f.source],
                    rows,
                    format: 'tar.gz' as const,
                    spool: displayPath(join(this.directory, randomUUID() + '.tar.gz')),
                    ready: false,
                  },
                }
              : {}),
          },
          posix.basename(f.dest),
          dir ? 0 : f.stat.size,
          'transfer',
        )
        created.push(job)
      }
    else {
      const job = this.task(
        {
          sourceProfile: this.getSession(p.sourceSessionId).meta.profile_id,
          targetProfile: this.getSession(p.targetSessionId).meta.profile_id,
          sourceSession: p.sourceSessionId,
          targetSession: p.targetSessionId,
          files: result.files,
          index: 0,
        },
        paths.length === 1 ? posix.basename(paths[0]) : `${paths.length} 项`,
        result.files.filter((f) => !f.dir).reduce((n, f) => n + f.stat.size, 0),
        'transfer',
      )
      created.push(job)
    }
    for (const j of created) await this.save(j)
    this.schedule()
    return { tasks: created.map((j) => j.checkpoint.task), method: 'relay' }
  }
  private async move(p: import('zod').infer<(typeof sftp)['sftp.move']['input']>) {
    const endpoint = this.endpoint(p.sessionId),
      paths = p.paths.map(cleanPath),
      dest = cleanPath(p.destDir)
    if (paths.some((path) => path === '/' || dest === path || dest.startsWith(path + '/')))
      fail('BAD_PATH', '不能移动到自身或子目录')
    const result = await this.conflict(endpoint, endpoint, paths, dest, 'preserve', p.conflictResolution)
    if (p.conflictResolution === 'ask' && result.conflicts.length)
      return { moved: [], skipped: [], failures: [], conflicts: result.conflicts }
    const moved: string[] = [],
      skipped: string[] = [],
      failures: Array<{ path: string; message: string }> = []
    for (const path of paths) {
      const f = result.files.find((f) => f.source === path)
      if (!f) {
        skipped.push(path)
        continue
      }
      try {
        if (f.target?.dir) fail('DIRECTORY_CONFLICT', '不能直接覆盖已有目录，请使用复制并合并')
        await this.checkTarget(endpoint, f)
        await endpoint.rename(path, f.dest, !!f.target)
        moved.push(path)
      } catch (e) {
        failures.push({ path, message: failureOf(e).message })
      }
    }
    return { moved, skipped, failures }
  }
  private async uploadBegin(p: import('zod').infer<(typeof sftp)['sftp.uploadBegin']['input']>) {
    if (this.active >= 5) fail('QUEUE_FULL', '最多同时传输五路，请稍后重试')
    const endpoint = this.endpoint(p.sessionId),
      dest = posix.join(cleanPath(p.destDir), p.name),
      target = await this.target(endpoint, dest)
    if (target.stat && !p.overwrite) fail('FILE_EXISTS', '目标文件已经存在')
    if (target.stat?.dir) fail('TYPE_CONFLICT', '不能覆盖目录')
    const f: CopyFile = {
      source: '',
      dest,
      stat: {
        size: p.size,
        mtime: p.lastModified,
        mode: target.stat?.mode ?? 0o600,
        dir: false,
        link: false,
        identity: '',
      },
      target: target.stat,
      temporary: posix.join(p.destDir, `.eizhu-${randomUUID()}.part`),
      offset: 0,
      complete: false,
      dir: false,
    }
    const j = this.task(
      {
        sourceProfile: 'local',
        targetProfile: this.getSession(p.sessionId).meta.profile_id,
        sourceSession: 'browser',
        targetSession: p.sessionId,
        files: [f],
        index: 0,
        upload: { size: p.size, lastModified: p.lastModified, sequence: 0 },
      },
      p.name,
      p.size,
      'upload',
    )
    await this.save(j)
    return this.serial(j, () => this.openUpload(j))
  }
  private async openUpload(j: Job) {
    if (j.busy || this.active >= 5) fail('QUEUE_FULL', '最多同时传输五路，请稍后重试')
    this.active++
    try {
      const c = j.checkpoint,
        f = c.files[0]
      this.associate(c)
      const endpoint = this.forProfile(c.targetProfile, c.targetBinding, c.targetSession)
      await this.checkTarget(endpoint, f)
      const stage = await endpoint.optional(f.temporary)
      if (f.offset && (!stage || stage.size !== f.offset))
        fail('CHECKPOINT_CHANGED', '上传暂存文件已变化，请重新开始')
      if (!f.offset && stage) fail('CHECKPOINT_CHANGED', '上传暂存文件已存在')
      j.digest = createHash('sha256')
      if (f.offset) {
        const h = await endpoint.open(f.temporary)
        try {
          let offset = 0
          while (offset < f.offset) {
            const b = await h.read(offset, Math.min(512 * 1024, f.offset - offset))
            if (!b.length) fail('CHECKPOINT_CHANGED', '暂存文件已截断')
            j.digest.update(b)
            offset += b.length
          }
        } finally {
          await h.close()
        }
        if (j.digest.copy().digest('hex') !== f.prefixHash)
          fail('CHECKPOINT_CHANGED', '上传暂存文件已变化，请重新开始')
      }
      j.handle = await endpoint.open(f.temporary, true, !f.offset)
      j.controller = new AbortController()
      j.run = undefined
      j.started = Date.now()
      j.initial = f.offset
      j.uploadId = randomUUID()
      j.busy = true
      this.uploads.set(j.uploadId, j)
      c.task.status = 'transferring'
      c.task.phase = 'transferring'
      delete c.task.error_code
      delete c.task.error_message
      c.task.execution_generation = (c.task.execution_generation ?? 0) + 1
      await this.save(j)
      return { upload_id: j.uploadId, tasks: [c.task], received: f.offset, sequence: c.upload!.sequence }
    } catch (e) {
      await j.handle?.close().catch(() => undefined)
      j.handle = undefined
      if (j.uploadId) this.uploads.delete(j.uploadId)
      j.uploadId = undefined
      j.busy = false
      this.active--
      const f = transferFailure(e)
      Object.assign(j.checkpoint.task, {
        status: 'failed',
        error_code: f.code,
        error_message: f.message,
        retryable: true,
      })
      await this.save(j)
      throw e
    }
  }
  private async resumeUpload(p: import('zod').infer<(typeof sftp)['sftp.resumeUpload']['input']>) {
    const j = this.job(p.taskId),
      c = j.checkpoint
    if (!c.upload) fail('BAD_REQUEST', '该任务不是上传')
    if (j.busy || this.active >= 5) fail('QUEUE_FULL', '传输通道正在使用')
    if (['completed', 'cancelled'].includes(c.task.status)) fail('TRANSFER_FINISHED', '任务已结束')
    if (
      !p.restart &&
      (p.size !== c.upload.size ||
        p.lastModified !== c.upload.lastModified ||
        (c.upload.prefixHash && p.prefixHash !== c.upload.prefixHash))
    )
      fail('SOURCE_CHANGED', '所选上传文件已变化，请选择原文件或重新开始')
    if (p.restart) {
      await this.cleanup(j)
      c.upload = { size: p.size, lastModified: p.lastModified, sequence: 0 }
      c.task.size = p.size
      c.task.transferred = 0
      Object.assign(c.files[0], {
        offset: 0,
        prefixHash: undefined,
        complete: false,
        stat: { ...c.files[0].stat, size: p.size },
      })
    }
    return this.serial(j, () => this.openUpload(j))
  }
  private async uploadChunk(j: Job, data: Uint8Array, sequence: number) {
    const c = j.checkpoint,
      f = c.files[0]
    j.controller.signal.throwIfAborted()
    if (!j.handle || !j.uploadId) fail('NOT_FOUND', '上传通道已关闭')
    if (j.run) fail('TRANSFER_BUSY', '正在提交上传，请等待任务结果')
    if (sequence !== c.upload!.sequence || f.offset + data.byteLength > c.task.size)
      fail('BAD_SEQUENCE', '上传分块序号或长度不匹配')
    try {
      await j.handle.write(f.offset, data)
      await j.handle.sync()
    } catch (e) {
      await this.uploadFailed(j, e)
      throw e
    }
    f.offset += data.byteLength
    c.upload!.sequence++
    c.task.transferred = f.offset
    c.task.speed = Math.max(0, ((f.offset - j.initial!) * 1000) / Math.max(1, Date.now() - j.started!))
    // Persist a hash of the acknowledged bytes; a resumed stream revalidates staging before appending.
    j.digest!.update(data)
    f.prefixHash = j.digest!.copy().digest('hex')
    if (sequence === 0) {
      c.upload!.prefixHash = hash(data)
      c.upload!.prefixBytes = data.byteLength
    }
    await this.save(j)
  }
  private async uploadFinish(j: Job) {
    const c = j.checkpoint,
      f = c.files[0],
      endpoint = this.forProfile(c.targetProfile, c.targetBinding, c.targetSession)
    await this.phase(j, 'verifying')
    await j.handle!.close()
    j.handle = undefined
    // WRITE callbacks acknowledge all bytes; CLOSE is also acknowledged. Avoid
    // downloading the entire upload again just to finish it. Recovery still
    // validates the saved SHA-256 prefix before allowing any append.
    const written = await endpoint.stat(f.temporary)
    if ((written.mode & 0o170000) !== 0o100000 || written.size !== c.task.size)
      fail('VERIFY_FAILED', '上传暂存文件长度不匹配')
    await endpoint.chmod(f.temporary, f.stat.mode)
    await this.phase(j, 'committing')
    await this.mutate(c.targetProfile, async () => {
      await this.checkTarget(endpoint, f, j.controller.signal)
      j.controller.signal.throwIfAborted()
      await endpoint.rename(f.temporary, f.dest, !!f.target)
    })
    f.complete = true
    Object.assign(c.task, {
      status: 'completed',
      transferred: c.task.size,
      speed: 0,
      finished_at: Date.now(),
    })
    await this.save(j)
  }
  private releaseUpload(j: Job) {
    if (!j.uploadId) return
    this.uploads.delete(j.uploadId)
    j.uploadId = undefined
    j.digest = undefined
    if (j.busy) {
      j.busy = false
      this.active--
    }
  }
  private async uploadFailed(j: Job, cause: unknown) {
    await j.handle?.close().catch(() => undefined)
    j.handle = undefined
    this.releaseUpload(j)
    if (!j.controller.signal.aborted) {
      const error = transferFailure(cause)
      Object.assign(j.checkpoint.task, {
        status: 'failed', speed: 0, error_code: error.code,
        error_message: error.message, retryable: true,
      })
      await this.save(j)
    }
    this.schedule()
  }
  private async download(p: import('zod').infer<(typeof sftp)['sftp.download']['input']>) {
    const source = this.endpoint(p.sessionId),
      paths = p.paths.map(cleanPath),
      rows = await collect(source, paths),
      single = rows.length === 1 && !rows[0].dir
    const name = single
        ? posix.basename(paths[0])
        : paths.length === 1
          ? posix.basename(paths[0]) + '.zip'
          : '下载.zip',
      dest = displayPath(join(this.directory, randomUUID() + '-' + name))
    const f: CopyFile = {
      source: paths[0],
      dest,
      stat: await source.stat(paths[0]),
      temporary: displayPath(join(this.directory, randomUUID() + '.part')),
      offset: 0,
      complete: false,
      dir: false,
    }
    const j = this.task(
      {
        sourceProfile: this.getSession(p.sessionId).meta.profile_id,
        targetProfile: '__staging__',
        sourceSession: p.sessionId,
        targetSession: 'staging',
        files: [f],
        index: 0,
        download: true,
        ...(!single
          ? {
              archive: {
                paths,
                rows,
                format: 'zip' as const,
                spool: displayPath(join(this.directory, randomUUID() + '.zip')),
                ready: false,
              },
            }
          : {}),
      },
      name,
      single ? f.stat.size : 0,
      'download',
    )
    await this.save(j)
    this.schedule()
    return { tasks: [j.checkpoint.task], download_url: '' }
  }
  async downloadPath(taskId: string) {
    await this.ready
    const c = this.job(taskId).checkpoint
    if (!c.download || c.task.status !== 'completed') fail('DOWNLOAD_NOT_READY', '下载文件尚未完成')
    await this.spoolEndpoint.guard(c.files[0].dest)
    return { path: c.files[0].dest, name: c.task.file_name }
  }
  private async prepareDrag(p: { sessionId: string; paths: string[] }) {
    const source = this.endpoint(p.sessionId),
      jobs: Job[] = []
    try {
      for (const path of p.paths.map(cleanPath)) {
        const rows = await collect(source, [path]),
          base = displayPath(join(this.directory, randomUUID()))
        await this.spoolEndpoint.mkdir(base)
        const files: CopyFile[] = rows.map((row) => {
          const dest = posix.join(base, row.name)
          return {
            source: row.path,
            dest,
            stat: row,
            temporary: posix.join(posix.dirname(dest), `.eizhu-${randomUUID()}.part`),
            offset: 0,
            complete: false,
            dir: row.dir,
          }
        })
        const job = this.task(
          {
            sourceProfile: this.getSession(p.sessionId).meta.profile_id,
            targetProfile: '__staging__',
            sourceSession: p.sessionId,
            targetSession: 'staging',
            files,
            index: 0,
            download: true,
            dragRoot: base,
          },
          posix.basename(path),
          rows.filter((r) => !r.dir).reduce((n, r) => n + r.size, 0),
          'download',
        )
        jobs.push(job)
        await this.save(job)
      }
    } catch (e) {
      for (const job of jobs) await this.stop(job, 'cancelled')
      throw e
    }
    this.schedule()
    return { tasks: jobs.map((j) => j.checkpoint.task) }
  }
  async authorizeEditor(id: string, path: string) {
    return this.mutate('editor:' + id, () => this.authorizeEditorUnlocked(id, path))
  }
  private async authorizeEditorUnlocked(id: string, path: string) {
    await this.ready
    let s = this.sessions.get(id)
    let created = false
    if (!s) {
      if (this.sessions.size >= 128) fail('QUEUE_FULL', '文件会话过多')
      const existing = this.ssh.fileClient(id)
      const channel = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) =>
        existing.client.sftp((e, c) => (e ? reject(e) : resolve(c))),
      )
      s = {
        borrowed: true,
        meta: {
          id,
          profile_id: existing.profileId,
          status: 'connected',
          created_at: new Date().toISOString(),
        },
        endpoint: new FileEndpoint(channel),
      }
      this.sessions.set(id, s)
      created = true
    }
    try {
      await this.endpoint(id).guard(cleanPath(path))
      await this.endpoint(id).stat(cleanPath(path))
      return { sessionId: id, path: cleanPath(path), borrowed: !!s.borrowed }
    } catch (e) {
      if (created) await this.closeSession(id)
      throw e
    }
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true
      await this.ready
      await Promise.all(
        [...this.jobs.values()]
          .filter((j) => activeStatuses.includes(j.checkpoint.task.status))
          .map((j) => this.stop(j, 'paused')),
      )
      await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)))
      await this.spoolEndpoint.close()
    })()
    return this.closing
  }
}
