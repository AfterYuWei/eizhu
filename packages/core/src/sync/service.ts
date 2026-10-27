import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  DesktopError,
  fail,
  sync,
  syncBatchSchema,
  syncCapabilitiesSchema,
  syncChangesSchema,
  syncKeyEnvelopeSchema,
  syncSnapshotSchema,
  syncSnapshotPageSchema,
} from '@eizhu/contracts'
import type { RuntimeContext, SyncOperation, SyncStatus, WorkspaceIdentity } from '@eizhu/contracts'
import type { AccountService } from '../account/service.ts'
import type { AccountSession } from '../account/repository.ts'
import type { WorkerClient } from '../workers/client.ts'
import type { Draft, Frozen } from './repository.ts'
import type { PlainItem, Remote, WireItem } from './model.ts'
export type EventStream = (
  authorization: string,
  signal: AbortSignal,
  consume: (bytes: Uint8Array) => Promise<void>,
) => Promise<void>
type State = { deviceId: string; cursor: number; epoch: number; initialized: boolean; lastErrorCode: string }
const codeOf = (error: unknown) => (error instanceof DesktopError ? error.error.code : '')
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      },
      timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
const toRemote = (item: PlainItem, epoch: number): Remote => ({
  itemType: item.itemType,
  itemId: item.itemId,
  revision: item.revision,
  epoch: item.epoch ?? epoch,
  value: item.value,
})
/** Exactly one owner and serial sync loop per account/runtime. Only frozen writes are recoverable. */
export class SyncService {
  private key?: Buffer
  private controller = new AbortController()
  private queue: Promise<unknown> = Promise.resolve()
  private queued = 0
  private timer?: ReturnType<typeof setTimeout>
  private periodic?: ReturnType<typeof setInterval>
  private watcher?: Promise<void>
  private watchController?: AbortController
  private started = false
  private closed = false
  private blocked = false
  private enabled = false
  private ready: Promise<void>
  private database: WorkerClient
  private compute: WorkerClient
  private account: AccountService
  private workspace: WorkspaceIdentity
  private context: RuntimeContext
  private emit: (status: SyncStatus, refresh: boolean) => void
  private stream?: EventStream
  constructor(
    database: WorkerClient,
    compute: WorkerClient,
    account: AccountService,
    workspace: WorkspaceIdentity,
    context: RuntimeContext,
    emit: (status: SyncStatus, refresh: boolean) => void,
    stream?: EventStream,
  ) {
    this.database = database
    this.compute = compute
    this.account = account
    this.workspace = workspace
    this.context = context
    this.emit = emit
    this.stream = stream
    this.ready = this.restore()
  }
  private db<T>(operation: string, input?: unknown): Promise<T> {
    return this.database.call<T>(`sync.storage.${operation}`, input, { signal: this.controller.signal })
  }
  private async restore(): Promise<void> {
    if (this.workspace.id === 'offline') return
    const session = await this.database.call<AccountSession | null>('account.storage.session', this.workspace)
    this.enabled = session?.syncEnabled ?? false
    if (session?.cachedSyncKey) this.key = Buffer.from(session.cachedSyncKey.key, 'hex')
    const state = await this.db<State>('state')
    this.blocked =
      Boolean(state.lastErrorCode) && !['ACCOUNT_UNAVAILABLE', 'RATE_LIMITED'].includes(state.lastErrorCode)
  }
  start(): void {
    this.started = true
    void this.ready
      .then(() => {
        if (!this.closed) {
          this.periodic = setInterval(() => this.wake(), 60000)
          this.periodic.unref()
          this.wake()
        }
      })
      .catch(() => undefined)
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new DesktopError({ code: 'RUNTIME_CLOSED', message: '同步服务已关闭' }))
    if (this.queued >= 16)
      return Promise.reject(new DesktopError({ code: 'SYNC_BUSY', message: '同步操作过多，请稍后重试' }))
    this.queued++
    const task = this.queue.then(async () => {
      await this.ready
      if (this.closed) fail('RUNTIME_CLOSED', '同步服务已关闭')
      return work()
    })
    this.queue = task
      .catch(() => undefined)
      .finally(() => {
        this.queued--
      })
    return task
  }
  private async publish(refresh = false): Promise<void> {
    if (!this.closed) this.emit(await this.status(), refresh)
  }
  async status(): Promise<SyncStatus> {
    await this.ready
    if (this.workspace.id === 'offline')
      return {
        status: 'pending_setup',
        pendingCount: 0,
        conflictCount: 0,
        cursor: 0,
        initialized: false,
        unlocked: false,
        lastConfirmed: null,
        lastError: '',
        items: [],
      }
    return this.db<SyncStatus>('status', { unlocked: Boolean(this.key), enabled: this.enabled })
  }
  credentialsChanged(): void {
    void this.ready
      .then(async () => {
        const state = await this.db<State>('state')
        if (['ACCOUNT_NOT_LOGGED_IN', 'ACCOUNT_DISABLED'].includes(state.lastErrorCode)) this.blocked = false
        this.wake()
      })
      .catch(() => undefined)
  }
  wake(): void {
    if (!this.started || this.closed || this.blocked || this.timer || this.workspace.id === 'offline') return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.serial(() => this.cycle()).catch((error) => this.handle(error))
    }, 200)
    this.timer.unref()
  }
  private async handle(error: unknown): Promise<void> {
    if (this.closed) return
    const e =
      error instanceof DesktopError
        ? { ...error.error, details: error.details }
        : { code: 'SYNC_PROTOCOL', message: '同步处理失败，已保留本地修改' }
    if (
      [
        'PREVIEW_CHANGED',
        'PREVIEW_EXPIRED',
        'CONFLICT_CHANGED',
        'SYNC_CRYPTO',
        'CANCELLED',
        'SYNC_PAUSED',
        'SYNC_SETUP_REQUIRED',
      ].includes(e.code)
    )
      return
    const retry = e.code === 'ACCOUNT_UNAVAILABLE' || e.code === 'RATE_LIMITED'
    this.blocked = !retry
    await this.db('note', {
      phase: e.code === 'ACCOUNT_UNAVAILABLE' ? 'offline' : 'error',
      message: e.message,
      code: e.code,
    }).catch(() => undefined)
    await this.publish().catch(() => undefined)
    if (retry && !this.closed) {
      const retryAfter = Number(
        (e as { details?: { retryAfterSeconds?: number } }).details?.retryAfterSeconds,
      )
      const wait =
        e.code === 'RATE_LIMITED' ? Math.max(1000, Math.min(3600000, (retryAfter || 60) * 1000)) : 5000
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.wake()
      }, wait)
      this.timer.unref()
    }
  }
  private async crypto<T>(operation: string, input: Record<string, unknown>, key = this.key): Promise<T> {
    const copy = key ? Buffer.from(key) : undefined
    try {
      return await this.compute.call<T>(
        `sync.${operation}`,
        { ...input, user: this.workspace.userId, ...(copy ? { key: copy } : {}) },
        { signal: this.controller.signal },
      )
    } finally {
      copy?.fill(0)
    }
  }
  private request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    schema?: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    return this.account.syncRequest(path, method, schema, body, this.controller.signal)
  }
  private async unwrapKey(
    password: string,
    envelope: z.infer<typeof syncKeyEnvelopeSchema>,
  ): Promise<Buffer> {
    const bytes = await this.crypto<Uint8Array>('unwrap', { password, envelope })
    try {
      return Buffer.from(bytes)
    } finally {
      bytes.fill(0)
    }
  }
  private async capabilities() {
    return this.request('capabilities', 'GET', syncCapabilitiesSchema)
  }
  private async enroll(): Promise<State> {
    const state = await this.db<State>('state')
    await this.request('devices', 'POST', z.strictObject({ deviceId: z.uuid() }), {
      deviceId: state.deviceId,
    })
    return state
  }
  private async unlock(password: string): Promise<void> {
    await this.capabilities()
    await this.enroll()
    let envelope: z.infer<typeof syncKeyEnvelopeSchema>, key: Buffer | undefined
    try {
      try {
        envelope = await this.request('keys', 'GET', syncKeyEnvelopeSchema)
        key = await this.unwrapKey(password, envelope)
      } catch (error) {
        if (codeOf(error) !== 'KEY_NOT_FOUND') throw error
        key = randomBytes(32)
        const proposed = await this.crypto('wrap', { password, revision: 0 }, key)
        try {
          envelope = await this.request('keys', 'PUT', syncKeyEnvelopeSchema, proposed)
        } catch (error) {
          if (codeOf(error) !== 'KEY_CONFLICT') throw error
          key.fill(0)
          envelope = await this.request('keys', 'GET', syncKeyEnvelopeSchema)
          key = await this.unwrapKey(password, envelope)
        }
      }
      await this.database.call('account.storage.syncSettings', {
        cachedSyncKey: { key: key.toString('hex'), revision: envelope.revision },
      })
      this.key?.fill(0)
      this.key = Buffer.from(key)
      this.blocked = false
      await this.db('note', { phase: 'pending' })
    } finally {
      key?.fill(0)
    }
    this.wake()
    await this.publish()
  }
  private async changePassword(password: string): Promise<void> {
    if (!this.key) fail('SYNC_LOCKED', '请先解锁同步数据')
    const current = await this.request('keys', 'GET', syncKeyEnvelopeSchema)
    const proposed = await this.crypto('wrap', { password, revision: current.revision })
    const saved = await this.request('keys', 'PUT', syncKeyEnvelopeSchema, proposed)
    await this.database.call('account.storage.syncSettings', {
      cachedSyncKey: { key: this.key.toString('hex'), revision: saved.revision },
    })
  }
  private async snapshot(): Promise<{ seq: number; epoch: number; remote: Remote[] }> {
    if (!this.key) fail('SYNC_LOCKED', '请先解锁同步数据')
    const head = await this.request('snapshots', 'POST', syncSnapshotSchema, {})
    if (head.count > 200000) fail('SYNC_LIMIT', '云端条目过多，无法安全处理')
    let offset = 0,
      total = 0
    const remote: Remote[] = [],
      seen = new Set<string>()
    do {
      const page = await this.request(
        `snapshots/${head.snapshotId}?offset=${offset}`,
        'GET',
        syncSnapshotPageSchema,
      )
      if (
        page.offset !== offset + page.items.length ||
        page.offset > head.count ||
        (page.hasMore && page.items.length === 0)
      )
        fail('SYNC_PROTOCOL', '云端快照分页无效')
      total += page.items.reduce((n, item) => n + item.payload.length, 0)
      if (total > 50 * 1024 * 1024) fail('SYNC_LIMIT', '云端快照超过 50 MiB 安全处理上限')
      const plain = await this.crypto<PlainItem[]>('decrypt', { epoch: head.epoch, items: page.items })
      for (const item of plain) {
        const id = `${item.itemType}:${item.itemId}`
        if (seen.has(id) || (item.epoch ?? head.epoch) > head.epoch)
          fail('SYNC_PROTOCOL', '云端快照条目重复或代次无效')
        seen.add(id)
        remote.push(toRemote(item, head.epoch))
      }
      offset = page.offset
      if (!page.hasMore) break
    } while (offset < head.count)
    if (offset !== head.count) fail('SYNC_PROTOCOL', '云端快照数量不一致')
    return { ...head, remote }
  }
  private async pull(): Promise<boolean> {
    let state = await this.db<State>('state'),
      after = state.cursor,
      until = 0,
      changed = false
    for (let pages = 0; pages < 10000; pages++) {
      let changes: z.infer<typeof syncChangesSchema>
      try {
        changes = await this.request(`changes?after=${after}&until=${until}`, 'GET', syncChangesSchema)
      } catch (error) {
        if (codeOf(error) !== 'CURSOR_EXPIRED') throw error
        const snapshot = await this.snapshot()
        await this.db('apply', { ...snapshot, cursor: snapshot.seq, snapshot: true })
        return true
      }
      if (
        changes.until < after ||
        (until !== 0 && changes.until !== until) ||
        changes.cursor < after ||
        changes.cursor > changes.until ||
        (changes.hasMore && changes.cursor === after)
      )
        fail('SYNC_PROTOCOL', '云端增量分页无效')
      until = changes.until
      let cursor = after
      for (const batch of changes.batches) {
        if (batch.seq !== cursor + 1 || batch.seq > until) fail('SYNC_PROTOCOL', '云端增量顺序无效')
        if (batch.epoch !== state.epoch) {
          const snapshot = await this.snapshot()
          await this.db('apply', { ...snapshot, cursor: snapshot.seq, snapshot: true })
          return true
        }
        const plain = await this.crypto<PlainItem[]>('decrypt', { epoch: batch.epoch, items: batch.items })
        await this.db('apply', {
          remote: plain.map((item) => toRemote(item, batch.epoch)),
          cursor: batch.seq,
          epoch: batch.epoch,
        })
        cursor = batch.seq
        changed = true
      }
      if (changes.cursor !== cursor) fail('SYNC_PROTOCOL', '云端水位未对应完整批次')
      after = changes.cursor
      if (!changes.hasMore) return changed
      state = await this.db<State>('state')
    }
    return fail('SYNC_LIMIT', '云端增量分页超过处理上限，请稍后重试')
  }
  private validateAck(frozen: Frozen, batch: z.infer<typeof syncBatchSchema>): void {
    if (
      batch.requestId !== frozen.push.requestId ||
      (batch.deviceId && batch.deviceId !== frozen.push.deviceId) ||
      batch.items.length !== frozen.push.items.length
    )
      fail('SYNC_PROTOCOL', '云端提交确认不匹配')
    const expected = new Map(frozen.push.items.map((item) => [`${item.itemType}:${item.itemId}`, item]))
    for (const item of batch.items) {
      const old = expected.get(`${item.itemType}:${item.itemId}`)
      if (
        !old ||
        ['baseRevision', 'revision', 'generation', 'deleted', 'payload', 'keyVersion'].some(
          (key) => item[key as keyof WireItem] !== old[key as keyof WireItem],
        )
      )
        fail('SYNC_PROTOCOL', '云端确认内容与冻结请求不一致')
      expected.delete(`${item.itemType}:${item.itemId}`)
    }
    if (expected.size) fail('SYNC_PROTOCOL', '云端确认遗漏条目')
  }
  private async sendFrozen(frozen: Frozen, recover: boolean): Promise<void> {
    let batch: z.infer<typeof syncBatchSchema> | undefined
    if (recover) {
      try {
        batch = await this.request(`requests/${frozen.push.requestId}`, 'GET', syncBatchSchema)
      } catch (error) {
        if (codeOf(error) !== 'REQUEST_NOT_FOUND') throw error
      }
    }
    if (!batch) batch = await this.request('push', 'POST', syncBatchSchema, frozen.body)
    this.validateAck(frozen, batch)
    await this.db('ack', { requestId: batch.requestId, seq: batch.seq, epoch: batch.epoch })
  }
  private async cycle(): Promise<void> {
    if (!this.enabled || !this.key || this.workspace.id === 'offline') return
    const state = await this.db<State>('state')
    if (!state.initialized) return
    await this.db('note', { phase: 'syncing' })
    await this.publish()
    let refresh = false
    try {
      await this.capabilities()
      await this.enroll()
      const frozen = await this.db<Frozen | null>('frozen')
      if (frozen) await this.sendFrozen(frozen, true)
      refresh = await this.pull()
      const draft = await this.db<Draft | null>('draft')
      if (draft) {
        const items = await this.crypto<WireItem[]>('encrypt', { epoch: draft.epoch, items: draft.items })
        const push = {
          requestId: randomUUID(),
          deviceId: state.deviceId,
          epoch: draft.epoch,
          replace: false,
          expectedSeq: draft.cursor,
          items,
        }
        await this.db('freeze', { draft, push })
        await this.sendFrozen(await this.db<Frozen>('frozen'), false)
        refresh = (await this.pull()) || refresh
        this.wake()
      }
      await this.db('note', { phase: 'pending' })
      this.ensureWatcher()
    } catch (error) {
      if (['ITEM_CONFLICT', 'WATERMARK_CHANGED', 'EPOCH_CHANGED'].includes(codeOf(error))) {
        const frozen = await this.db<Frozen | null>('frozen')
        if (frozen) await this.db('thaw', { requestId: frozen.push.requestId })
        refresh = (await this.pull()) || refresh
        this.wake()
      } else throw error
    } finally {
      await this.publish(refresh)
    }
  }
  private ensureWatcher(): void {
    if (this.watcher || !this.stream || !this.enabled || !this.key || this.closed) return
    this.watchController = new AbortController()
    const controller = this.watchController
    const onClose = () => controller.abort()
    this.controller.signal.addEventListener('abort', onClose, { once: true })
    this.watcher = (async () => {
      let backoff = 1000
      while (!controller.signal.aborted && this.enabled) {
        try {
          const { token, expiresAt } = await this.account.syncToken()
          const attempt = new AbortController(),
            cancel = () => attempt.abort()
          controller.signal.addEventListener('abort', cancel, { once: true })
          const expiry = setTimeout(cancel, Math.max(1000, expiresAt - Date.now() - 15000))
          expiry.unref()
          const { SseHints } = await import('./sse.ts'),
            parser = new SseHints(() => {
              backoff = 1000
              this.wake()
            })
          try {
            await this.stream!(`Bearer ${token}`, attempt.signal, async (bytes) => parser.feed(bytes))
          } finally {
            clearTimeout(expiry)
            controller.signal.removeEventListener('abort', cancel)
          }
        } catch (error) {
          if (controller.signal.aborted) break
          if (
            [
              'ACCOUNT_NOT_LOGGED_IN',
              'ACCOUNT_DISABLED',
              'EMAIL_NOT_VERIFIED',
              'ACCOUNT_ACCESS_DENIED',
              'SYNC_PROTOCOL',
            ].includes(codeOf(error))
          ) {
            await this.handle(error)
            break
          }
        }
        await delay(backoff, controller.signal)
        backoff = Math.min(60000, backoff * 2)
      }
    })().finally(() => {
      this.controller.signal.removeEventListener('abort', onClose)
      this.watcher = undefined
    })
    void this.watcher.catch(() => undefined)
  }
  async setEnabled(enabled: boolean): Promise<import('@eizhu/contracts').AccountStatus> {
    return this.serial(async () => {
      if (this.workspace.id === 'offline') fail('ACCOUNT_NOT_LOGGED_IN', '请先登录账号')
      await this.database.call('account.storage.syncSettings', { syncEnabled: enabled })
      this.enabled = enabled
      this.blocked = false
      if (!enabled) {
        this.watchController?.abort()
        await this.watcher
      }
      await this.db('note', { phase: 'pending' })
      await this.publish()
      this.wake()
      return this.database.call('account.storage.status')
    })
  }
  execute(operation: SyncOperation, raw: unknown): Promise<unknown> {
    return this.serial(async () => {
      const input = sync[operation].input.parse(raw)
      if (operation === 'sync.status') return this.status()
      if (operation === 'sync.conflicts') return this.workspace.id === 'offline' ? [] : this.db('conflicts')
      if (this.workspace.id === 'offline') fail('ACCOUNT_NOT_LOGGED_IN', '请先登录账号')
      try {
        if (operation === 'sync.unlock') return await this.unlock(sync[operation].input.parse(input).password)
        if (operation === 'sync.changePassword')
          return await this.changePassword(sync[operation].input.parse(input).password)
        if (!this.key) fail('SYNC_LOCKED', '请先解锁同步数据')
        if (operation === 'sync.preview') {
          const snapshot = await this.snapshot()
          return await this.db('preview', {
            ...snapshot,
            runtimeId: this.context.runtimeId,
            includeOffline: sync[operation].input.parse(input).includeOffline,
          })
        }
        if (operation === 'sync.bootstrap') {
          const { token, mode } = sync[operation].input.parse(input),
            preview = await this.db<{ seq: number; epoch: number }>('previewInfo', {
              token,
              runtimeId: this.context.runtimeId,
            }),
            head = await this.capabilities()
          if (head.seq !== preview.seq || head.epoch !== preview.epoch)
            fail('PREVIEW_CHANGED', '云端数据已变化，请重新预览')
          let push: Frozen['push'] | undefined
          if (mode === 'use_local') {
            const draft = await this.db<Draft>('replacement', { token, runtimeId: this.context.runtimeId }),
              state = await this.db<State>('state')
            push = {
              requestId: randomUUID(),
              deviceId: state.deviceId,
              epoch: draft.epoch,
              replace: true,
              expectedSeq: draft.cursor,
              items: await this.crypto<WireItem[]>('encrypt', { epoch: draft.epoch + 1, items: draft.items }),
            }
          }
          await this.db('bootstrap', { token, runtimeId: this.context.runtimeId, mode, push })
          await this.database.call('account.storage.syncSettings', { syncEnabled: true })
          this.enabled = true
          this.blocked = false
          await this.publish(true)
          this.wake()
          return
        }
        if (operation === 'sync.resolveConflict') {
          const frozen = await this.db<Frozen | null>('frozen')
          if (frozen) await this.sendFrozen(frozen, true)
          await this.pull()
          await this.db('resolve', sync[operation].input.parse(input))
          this.blocked = false
          this.wake()
          await this.publish(true)
          return
        }
        if (operation === 'sync.now') {
          this.blocked = false
          const state = await this.db<State>('state')
          if (!state.initialized) fail('SYNC_SETUP_REQUIRED', '请先预览并确认首次接入')
          if (!this.enabled) fail('SYNC_PAUSED', '同步已暂停，请先开启同步')
          await this.cycle()
          return
        }
      } catch (error) {
        await this.handle(error)
        throw error
      }
    })
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    this.watchController?.abort()
    if (this.timer) clearTimeout(this.timer)
    if (this.periodic) clearInterval(this.periodic)
    await Promise.allSettled([this.ready, this.queue, this.watcher])
    this.key?.fill(0)
    this.key = undefined
  }
}
