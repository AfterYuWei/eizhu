import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  fail,
  syncConflictSchema,
  syncPushSchema,
  syncStatusSchema,
  syncWireItemSchema,
} from '@eizhu/contracts'
import type { SyncConflict, SyncStatus } from '@eizhu/contracts'
import type { LocalStore } from '../database/local-store.ts'
import { LocalCipher } from '../local/crypto.ts'
import { emptyPayload } from '../local/model.ts'
import type { Payload, Kind } from '../local/model.ts'
import {
  dependencies,
  entries,
  equal,
  get,
  graph,
  identity,
  kindOf,
  put,
  remoteSchema,
  summary,
  typeOf,
} from './model.ts'
import type { Entity, ItemType, Remote, PlainItem, WireItem } from './model.ts'

type State = {
  deviceId: string
  cursor: number
  epoch: number
  initialized: boolean
  lastConfirmed: string | null
  phase: SyncStatus['status']
  lastError: string
  lastErrorCode: string
}
type Conflict = { remote: Remote; reason: 'concurrent_edit' | 'dependency'; source?: 'offline' }
export type Frozen = {
  push: z.infer<typeof syncPushSchema>
  body: string
  covered: Array<{ kind: Kind; itemId: string; revision: number }>
  values: Remote[]
}
export type Draft = {
  cursor: number
  epoch: number
  revision: number
  items: Array<WireItem & { value: Entity | null }>
  covered: Frozen['covered']
}
type Preview = {
  runtimeId: string
  revision: number
  offlineRevision: number | null
  offline: Payload
  seq: number
  epoch: number
  remote: Remote[]
  expires: number
}
const count = (p: Payload) => entries(p).length
const toRemote = (item: PlainItem, epoch: number): Remote => ({
  itemType: item.itemType,
  itemId: item.itemId,
  revision: item.revision,
  epoch: item.epoch ?? epoch,
  value: item.value,
})
const positive = z.int().positive(),
  integer = z.int().nonnegative()
const schemaState = z.strictObject({
  deviceId: z.uuid(),
  cursor: integer,
  epoch: positive,
  initialized: z.boolean(),
  lastConfirmed: z.string().nullable(),
  phase: z.enum([
    'pending_setup',
    'locked',
    'pending',
    'syncing',
    'synced',
    'offline',
    'error',
    'conflict',
    'paused',
  ]),
  lastError: z.string().max(1024),
  lastErrorCode: z.string().max(100),
})

/** This repository and LocalStore share a single SQLite connection, on the database Worker only. */
export class SyncRepository {
  private cipher: LocalCipher
  private db: Database.Database
  private local: LocalStore
  private offline: () => { payload: Payload; revision: number }
  constructor(
    db: Database.Database,
    local: LocalStore,
    key: Uint8Array,
    workspace: string,
    offline: () => { payload: Payload; revision: number },
  ) {
    this.db = db
    this.local = local
    this.offline = offline
    this.cipher = new LocalCipher(key, workspace)
  }
  private state(): State {
    const row = this.db.prepare("SELECT data FROM sync_state WHERE key='state'").get() as
      { data: Buffer } | undefined
    if (row) return schemaState.parse(this.cipher.open(row.data, 'sync:state'))
    const state: State = {
      deviceId: randomUUID(),
      cursor: 0,
      epoch: 1,
      initialized: false,
      lastConfirmed: null,
      phase: 'pending_setup',
      lastError: '',
      lastErrorCode: '',
    }
    this.writeState(state)
    return state
  }
  private writeState(state: State): void {
    this.db
      .prepare("INSERT INTO sync_state VALUES ('state',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data")
      .run(this.cipher.seal(schemaState.parse(state), 'sync:state'))
  }
  private rows<T>(table: 'sync_shadow' | 'sync_conflicts'): Map<string, T> {
    return new Map(
      (
        this.db.prepare(`SELECT kind,item_id,data FROM ${table}`).all() as Array<{
          kind: ItemType
          item_id: string
          data: Buffer
        }>
      ).map((row) => [
        identity(row.kind, row.item_id),
        this.cipher.open<T>(row.data, `${table}:${row.kind}:${row.item_id}`),
      ]),
    )
  }
  private write(table: 'sync_shadow' | 'sync_conflicts', type: ItemType, id: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO ${table} VALUES (?,?,?) ON CONFLICT(kind,item_id) DO UPDATE SET data=excluded.data`,
      )
      .run(type, id, this.cipher.seal(value, `${table}:${type}:${id}`))
  }
  private removeConflict(type: ItemType, id: string): void {
    this.db.prepare('DELETE FROM sync_conflicts WHERE kind=? AND item_id=?').run(type, id)
  }
  private clear(type: ItemType, id: string, revision: number): void {
    this.db
      .prepare('DELETE FROM outbox WHERE kind=? AND item_id=? AND revision<=?')
      .run(kindOf[type], id, revision)
  }
  frozen(): Frozen | null {
    const row = this.db.prepare('SELECT request_id,data FROM sync_requests ORDER BY rowid LIMIT 1').get() as
      { request_id: string; data: Buffer } | undefined
    if (!row) return null
    const value = this.cipher.open<Frozen>(row.data, `sync-request:${row.request_id}`)
    syncPushSchema.parse(value.push)
    if (value.body !== JSON.stringify(value.push)) fail('SYNC_PROTOCOL', '冻结请求内容不一致，已停止上传')
    return value
  }
  conflicts(): SyncConflict[] {
    const payload = this.local.snapshot()
    return [...this.rows<Conflict>('sync_conflicts').values()].map((conflict) => {
      const r = conflict.remote,
        local = get(payload, r.itemType, r.itemId)
      return syncConflictSchema.parse({
        itemType: r.itemType,
        itemId: r.itemId,
        name: local?.name ?? r.value?.name ?? r.itemId,
        reason: conflict.reason,
        remoteRevision: r.revision,
        localDeleted: !local,
        remoteDeleted: !r.value,
        remoteSource: conflict.source ?? 'cloud',
        local: summary(r.itemType, local, r.value),
        remote: summary(r.itemType, r.value, local),
      })
    })
  }
  status(unlocked: boolean, enabled: boolean): SyncStatus {
    const s = this.state(),
      pending = this.local.syncPending(),
      conflicts = this.rows<Conflict>('sync_conflicts')
    const status: SyncStatus['status'] = !unlocked
      ? 'locked'
      : !s.initialized
        ? 'pending_setup'
        : !enabled
          ? 'paused'
          : s.lastError
            ? s.phase
            : conflicts.size
              ? 'conflict'
              : pending.length
                ? 'pending'
                : 'synced'
    return syncStatusSchema.parse({
      status: s.phase === 'syncing' && enabled && unlocked && s.initialized ? 'syncing' : status,
      pendingCount: pending.length,
      conflictCount: conflicts.size,
      cursor: s.cursor,
      initialized: s.initialized,
      unlocked,
      lastConfirmed: s.lastConfirmed,
      lastError: s.lastError,
      lastErrorCode: s.lastErrorCode,
      items: pending
        .slice(0, 10000)
        .map((p) => ({
          itemType: typeOf[p.kind],
          itemId: p.itemId,
          generation: p.revision,
          name: p.value?.name,
          status: conflicts.has(identity(typeOf[p.kind], p.itemId))
            ? 'conflict'
            : status === 'syncing'
              ? 'syncing'
              : 'pending',
          deleted: !p.value,
        })),
    })
  }
  note(phase: State['phase'], message = '', code = ''): void {
    const state = this.state()
    this.writeState({ ...state, phase, lastError: message, lastErrorCode: code })
  }
  private mergeOffline(
    account: Payload,
    offline: Payload,
  ): { payload: Payload; collisions: Array<Remote & { dependency?: boolean }> } {
    const payload = structuredClone(account),
      collisions: Array<Remote & { dependency?: boolean }> = [],
      incoming = entries(offline)
    for (const e of incoming) {
      const existing = get(payload, e.itemType, e.itemId)
      if (!existing) put(payload, e.itemType, e.itemId, e.value)
      else if (!equal(existing, e.value)) collisions.push({ ...e, revision: 0, epoch: this.state().epoch })
    }
    try {
      graph(payload)
    } catch {
      Object.assign(payload, structuredClone(account))
      const waiting = incoming.filter((e) => !get(account, e.itemType, e.itemId))
      let changed = true
      while (changed) {
        changed = false
        for (let i = waiting.length - 1; i >= 0; i--) {
          const e = waiting[i],
            next = structuredClone(payload)
          put(next, e.itemType, e.itemId, e.value)
          try {
            graph(next)
            Object.assign(payload, next)
            waiting.splice(i, 1)
            changed = true
          } catch {
            /* Keep this offline copy as a dependency conflict. */
          }
        }
      }
      for (const e of waiting)
        collisions.push({ ...e, revision: 0, epoch: this.state().epoch, dependency: true })
    }
    return { payload, collisions }
  }
  preview(runtimeId: string, seq: number, epoch: number, remote: Remote[], includeOffline: boolean) {
    const offline = includeOffline ? this.offline() : null
    const account = this.local.snapshot(),
      local = this.mergeOffline(account, offline?.payload ?? emptyPayload())
    const conflicts: SyncConflict[] = []
    for (const r of [...local.collisions, ...remote]) {
      const current = get(local.payload, r.itemType, r.itemId)
      if (current && !equal(current, r.value))
        conflicts.push(
          syncConflictSchema.parse({
            itemType: r.itemType,
            itemId: r.itemId,
            name: current.name,
            reason: 'dependency' in r && r.dependency ? 'dependency' : 'concurrent_edit',
            remoteRevision: r.revision,
            localDeleted: false,
            remoteDeleted: !r.value,
            local: summary(r.itemType, current, r.value),
            remote: summary(r.itemType, r.value, current),
            remoteSource: local.collisions.includes(r) ? 'offline' : 'cloud',
          }),
        )
    }
    if (conflicts.length > 10000) fail('SYNC_LIMIT', '冲突过多，请减少条目后重新预览')
    const token = randomUUID(),
      expires = Date.now() + 15 * 60 * 1000
    const preview: Preview = {
      runtimeId,
      seq,
      epoch,
      revision: this.local.archiveRevision(),
      offlineRevision: offline?.revision ?? null,
      offline: offline?.payload ?? emptyPayload(),
      remote,
      expires,
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM sync_previews').run()
      this.db
        .prepare('INSERT INTO sync_previews VALUES (?,?,?)')
        .run(token, this.cipher.seal(preview, `sync-preview:${token}`), expires)
    })()
    return {
      token,
      localCount: count(local.payload),
      offlineCount: offline ? count(offline.payload) : 0,
      accountCount: count(account),
      cloudCount: remote.filter((r) => r.value).length,
      conflictCount: conflicts.length,
      conflicts,
    }
  }
  private readPreview(token: string, runtimeId: string): Preview {
    const row = this.db
      .prepare('SELECT data FROM sync_previews WHERE token=? AND expires>=?')
      .get(token, Date.now()) as { data: Buffer } | undefined
    if (!row) fail('PREVIEW_EXPIRED', '请重新预览首次接入')
    const p = this.cipher.open<Preview>(row.data, `sync-preview:${token}`)
    if (
      p.runtimeId !== runtimeId ||
      p.revision !== this.local.archiveRevision() ||
      (p.offlineRevision !== null && p.offlineRevision !== this.offline().revision)
    )
      fail('PREVIEW_CHANGED', '本地数据或运行实例已变化，请重新预览')
    return p
  }
  previewInfo(token: string, runtimeId: string) {
    return this.readPreview(token, runtimeId)
  }
  replacement(token: string, runtimeId: string): Draft {
    const p = this.readPreview(token, runtimeId),
      local = this.mergeOffline(this.local.snapshot(), p.offline),
      merged = local.payload
    if (local.collisions.some((c) => c.dependency))
      fail('SYNC_DEPENDENCY', '离线合并存在关联冲突，请先合并并处理冲突，或取消合并离线空间')
    const remote = new Map(p.remote.map((r) => [identity(r.itemType, r.itemId), r])),
      all = new Map(
        p.remote.map((r) => [identity(r.itemType, r.itemId), { ...r, value: null as Entity | null }]),
      )
    for (const e of entries(merged))
      all.set(identity(e.itemType, e.itemId), {
        ...e,
        revision: remote.get(identity(e.itemType, e.itemId))?.revision ?? 0,
        epoch: p.epoch + 1,
      })
    if (all.size > 10000)
      fail('SYNC_REPLACE_TOO_LARGE', '整体替换超过服务端 10000 条上限，请减少条目；不会分批替换')
    return {
      cursor: p.seq,
      epoch: p.epoch,
      revision: p.revision,
      covered: [],
      items: [...all.values()].map((r) => ({
        itemType: r.itemType,
        itemId: r.itemId,
        baseRevision: r.revision,
        revision: r.revision + 1,
        generation: p.revision + 1,
        deleted: !r.value,
        value: r.value,
        payload: 'pending',
        keyVersion: 1,
        epoch: p.epoch + 1,
      })),
    }
  }
  bootstrap(
    token: string,
    runtimeId: string,
    mode: 'merge' | 'use_local' | 'use_cloud',
    push?: Frozen['push'],
  ): void {
    this.db.transaction(() => {
      const p = this.readPreview(token, runtimeId),
        before = this.local.snapshot(),
        local = this.mergeOffline(before, p.offline)
      this.db.prepare('DELETE FROM sync_conflicts').run()
      this.db.prepare('DELETE FROM sync_shadow').run()
      if (mode === 'use_cloud') {
        const cloud = emptyPayload()
        for (const r of p.remote) put(cloud, r.itemType, r.itemId, r.value)
        graph(cloud)
        this.local.syncApply(cloud, 'sync_use_cloud', true, false)
        this.db.prepare('DELETE FROM outbox').run()
        for (const r of p.remote) this.write('sync_shadow', r.itemType, r.itemId, r)
      } else {
        this.local.syncApply(local.payload, 'sync_import_offline', true, true)
        if (mode === 'use_local') {
          if (!push) fail('SYNC_PROTOCOL', '缺少整体替换请求')
          const expected = this.replacementFromPreview(p, local.payload)
          if (
            push.epoch !== p.epoch ||
            push.expectedSeq !== p.seq ||
            !push.replace ||
            push.items.length !== expected.length
          )
            fail('SYNC_PROTOCOL', '整体替换请求与预览不一致')
          for (const r of p.remote) this.write('sync_shadow', r.itemType, r.itemId, r)
          const covered = this.local
            .syncPending()
            .map((v) => ({ kind: v.kind, itemId: v.itemId, revision: v.revision }))
          const values = expected.map((r) => ({ ...r, revision: r.revision + 1, epoch: p.epoch + 1 }))
          this.saveFrozen({ push, body: JSON.stringify(push), covered, values })
        } else {
          for (const r of local.collisions)
            this.write('sync_conflicts', r.itemType, r.itemId, {
              remote: r,
              reason: r.dependency ? 'dependency' : 'concurrent_edit',
              source: 'offline',
            } satisfies Conflict)
          this.applyValues(p.remote, p.seq, p.epoch, true)
        }
      }
      this.writeState({
        ...this.state(),
        cursor: p.seq,
        epoch: p.epoch,
        initialized: true,
        phase: 'pending',
        lastError: '',
        lastErrorCode: '',
      })
      this.db.prepare('DELETE FROM sync_previews').run()
    })()
  }
  private replacementFromPreview(p: Preview, payload: Payload): Remote[] {
    const rows = new Map(
      p.remote.map((r) => [identity(r.itemType, r.itemId), { ...r, value: null as Entity | null }]),
    )
    for (const e of entries(payload))
      rows.set(identity(e.itemType, e.itemId), {
        ...e,
        revision: rows.get(identity(e.itemType, e.itemId))?.revision ?? 0,
        epoch: p.epoch + 1,
      })
    if (rows.size > 10000) fail('SYNC_REPLACE_TOO_LARGE', '整体替换超过服务端批次上限')
    return [...rows.values()]
  }
  /** Cursor, shadow, conflicts and business changes advance in one synchronous transaction. */
  apply(remote: Remote[], cursor: number, epoch: number, snapshot = false): void {
    this.db.transaction(() => this.applyValues(remote, cursor, epoch, snapshot))()
  }
  private applyValues(remote: Remote[], cursor: number, epoch: number, snapshot: boolean): void {
    const state = this.state()
    if (cursor < state.cursor && !snapshot) fail('SYNC_PROTOCOL', '云端游标发生倒退')
    const before = this.local.snapshot(),
      candidate = structuredClone(before),
      pending = new Map(this.local.syncPending().map((p) => [identity(typeOf[p.kind], p.itemId), p]))
    const shadows = this.rows<Remote>('sync_shadow'),
      conflicts = this.rows<Conflict>('sync_conflicts'),
      incoming = new Map(remote.map((r) => [identity(r.itemType, r.itemId), r]))
    if (incoming.size !== remote.length) fail('SYNC_PROTOCOL', '云端包含重复条目')
    if (snapshot) {
      for (const [id, old] of shadows)
        if (!incoming.has(id)) incoming.set(id, { ...old, revision: 0, epoch, value: null })
      this.db.prepare('DELETE FROM sync_shadow').run()
    }
    const candidates = new Map<string, Remote>()
    for (const [id, conflict] of conflicts)
      if (conflict.reason === 'dependency' && !incoming.has(id)) candidates.set(id, conflict.remote)
    for (const [id, r] of incoming) {
      remoteSchema.parse(r)
      const previous = shadows.get(id)
      if (!snapshot && previous && r.revision <= previous.revision) {
        if (r.revision === previous.revision && !equal(r.value, previous.value))
          fail('SYNC_PROTOCOL', '同一远端修订内容发生变化')
        continue
      }
      this.write('sync_shadow', r.itemType, r.itemId, r)
      const local = get(before, r.itemType, r.itemId),
        queued = pending.get(id)
      if (queued || (!state.initialized && local)) {
        if (equal(local, r.value)) {
          if (queued) this.clear(r.itemType, r.itemId, queued.revision)
          this.removeConflict(r.itemType, r.itemId)
        } else if (queued && previous && equal(previous.value, r.value)) {
          // Cloud revision changed without a content edit; local work can rebase safely.
        } else {
          this.write('sync_conflicts', r.itemType, r.itemId, {
            remote: r,
            reason: 'concurrent_edit',
          } satisfies Conflict)
          candidates.delete(id)
        }
      } else candidates.set(id, r)
    }
    for (const r of candidates.values()) put(candidate, r.itemType, r.itemId, r.value)
    const accepted = new Set<string>()
    try {
      graph(candidate)
      for (const id of candidates.keys()) accepted.add(id)
    } catch {
      // Keep a valid graph at every write; defer independently unapplicable rows as durable conflicts.
      Object.assign(candidate, structuredClone(before))
      let changed = true
      while (changed) {
        changed = false
        for (const [id, r] of candidates) {
          if (accepted.has(id)) continue
          const next = structuredClone(candidate)
          put(next, r.itemType, r.itemId, r.value)
          try {
            graph(next)
            Object.assign(candidate, next)
            accepted.add(id)
            changed = true
          } catch {
            /* Try again after dependencies. */
          }
        }
      }
    }
    for (const [id, r] of candidates) {
      if (accepted.has(id)) this.removeConflict(r.itemType, r.itemId)
      else
        this.write('sync_conflicts', r.itemType, r.itemId, {
          remote: r,
          reason: 'dependency',
        } satisfies Conflict)
    }
    this.local.syncApply(candidate, 'sync_remote_apply', false, false)
    this.writeState({ ...state, cursor, epoch, phase: 'pending', lastError: '', lastErrorCode: '' })
  }
  draft(): Draft | null {
    const state = this.state(),
      shadows = this.rows<Remote>('sync_shadow'),
      conflicts = this.rows<Conflict>('sync_conflicts')
    let pending = this.local.syncPending().filter((p) => !conflicts.has(identity(typeOf[p.kind], p.itemId)))
    // Do not upload a partial local transaction or an entity whose referenced row is conflicted.
    const blockedRevisions = new Set<number>()
    for (const p of this.local.syncPending())
      if (conflicts.has(identity(typeOf[p.kind], p.itemId))) blockedRevisions.add(p.revision)
    const entities = new Map(entries(this.local.snapshot()).map((e) => [identity(e.itemType, e.itemId), e]))
    for (const p of pending) {
      const visited = new Set<string>(),
        stack = p.value ? dependencies(typeOf[p.kind], p.value) : []
      while (stack.length) {
        const ref = stack.pop()!,
          id = identity(ref.type, ref.id)
        if (visited.has(id)) continue
        visited.add(id)
        if (conflicts.has(id)) {
          blockedRevisions.add(p.revision)
          break
        }
        const item = entities.get(id)
        if (item) stack.push(...dependencies(item.itemType, item.value))
      }
    }
    pending = pending.filter((p) => !blockedRevisions.has(p.revision))
    if (!pending.length) return null
    const selected: typeof pending = []
    const batches = new Map<number, typeof pending>()
    for (const p of pending) batches.set(p.revision, [...(batches.get(p.revision) ?? []), p])
    for (const [, batch] of [...batches].sort(([a], [b]) => a - b)) {
      if (batch.length > 10000 && !selected.length)
        fail('SYNC_BATCH_TOO_LARGE', '一次本地修改超过单批上限，未拆分上传')
      if (selected.length + batch.length > 10000) break
      selected.push(...batch)
    }
    pending = selected
    if (pending.length > 10000) fail('SYNC_BATCH_TOO_LARGE', '待同步条目超过单批上限，请先减少条目或分开处理')
    return {
      cursor: state.cursor,
      epoch: state.epoch,
      revision: this.local.archiveRevision(),
      covered: pending.map((p) => ({ kind: p.kind, itemId: p.itemId, revision: p.revision })),
      items: pending.map((p) => {
        const itemType = typeOf[p.kind],
          base = shadows.get(identity(itemType, p.itemId))?.revision ?? 0
        return {
          itemType,
          itemId: p.itemId,
          baseRevision: base,
          revision: base + 1,
          generation: p.revision,
          deleted: !p.value,
          payload: 'pending',
          keyVersion: 1,
          epoch: state.epoch,
          value: p.value,
        }
      }),
    }
  }
  freeze(draft: Draft, push: Frozen['push']): void {
    this.db.transaction(() => {
      const state = this.state()
      if (this.frozen()) fail('SYNC_BUSY', '已有未确认请求')
      if (state.cursor !== draft.cursor || state.epoch !== draft.epoch)
        fail('SYNC_CHANGED', '同步基线已变化，请重试')
      syncPushSchema.parse(push)
      if (
        push.replace ||
        push.epoch !== draft.epoch ||
        push.expectedSeq !== draft.cursor ||
        push.items.length !== draft.items.length
      )
        fail('SYNC_PROTOCOL', '冻结请求与本地修订不一致')
      for (let i = 0; i < push.items.length; i++) {
        const a = push.items[i],
          b = draft.items[i]
        if (
          a.itemType !== b.itemType ||
          a.itemId !== b.itemId ||
          a.revision !== b.revision ||
          a.generation !== b.generation
        )
          fail('SYNC_PROTOCOL', '冻结条目发生变化')
      }
      this.saveFrozen({
        push,
        body: JSON.stringify(push),
        covered: draft.covered,
        values: draft.items.map((item) => toRemote(item, draft.epoch)),
      })
    })()
  }
  private saveFrozen(frozen: Frozen): void {
    if (Buffer.byteLength(frozen.body) > 50 * 1024 * 1024)
      fail('SYNC_BATCH_TOO_LARGE', '同步请求超过 50 MiB 上限，未上传')
    this.db
      .prepare('INSERT INTO sync_requests VALUES (?,?)')
      .run(frozen.push.requestId, this.cipher.seal(frozen, `sync-request:${frozen.push.requestId}`))
  }
  ack(requestId: string, seq: number, epoch: number): void {
    this.db.transaction(() => {
      const f = this.frozen()
      if (!f || f.push.requestId !== requestId) fail('SYNC_PROTOCOL', '提交确认不匹配')
      if (
        seq !== (f.push.expectedSeq ?? this.state().cursor) + 1 ||
        epoch !== f.push.epoch + (f.push.replace ? 1 : 0)
      )
        fail('SYNC_PROTOCOL', '提交确认水位无效')
      for (const r of f.values) this.write('sync_shadow', r.itemType, r.itemId, { ...r, epoch })
      for (const p of f.covered) this.clear(typeOf[p.kind], p.itemId, p.revision)
      this.db.prepare('DELETE FROM sync_requests WHERE request_id=?').run(requestId)
      this.writeState({
        ...this.state(),
        cursor: seq,
        epoch,
        lastConfirmed: new Date().toISOString(),
        phase: 'pending',
        lastError: '',
        lastErrorCode: '',
      })
    })()
  }
  thaw(requestId: string): void {
    this.db.transaction(() => {
      const f = this.frozen()
      if (f?.push.requestId !== requestId) fail('SYNC_PROTOCOL', '冻结请求不匹配')
      this.db.prepare('DELETE FROM sync_requests WHERE request_id=?').run(requestId)
      if (f.push.replace) this.writeState({ ...this.state(), initialized: false })
    })()
  }
  resolve(type: ItemType, id: string, revision: number, choice: 'keep_local' | 'use_cloud'): void {
    this.db.transaction(() => {
      if (this.frozen()) fail('SYNC_BUSY', '请先确认正在提交的修改')
      const c = this.rows<Conflict>('sync_conflicts').get(identity(type, id))
      if (!c) fail('NOT_FOUND', '冲突已不存在')
      if (c.remote.revision !== revision) fail('CONFLICT_CHANGED', '云端内容已变化，请重新查看冲突')
      if (choice === 'use_cloud') {
        const payload = this.local.snapshot()
        put(payload, type, id, c.remote.value)
        graph(payload)
        this.local.syncApply(payload, 'sync_resolve_cloud', true, c.source === 'offline')
        if (c.source !== 'offline') this.clear(type, id, Number.MAX_SAFE_INTEGER)
      } else {
        const payload = this.local.snapshot(),
          value = get(payload, type, id)
        // A dependency conflict can have no local outbox; create a real local revision/tombstone.
        const revision = this.local.archiveRevision() + 1
        this.local.syncApply(payload, 'sync_resolve_local', false, false)
        this.db
          .prepare('INSERT INTO outbox(kind,item_id,revision,deleted,payload) VALUES (?,?,?,?,?)')
          .run(
            kindOf[type],
            id,
            revision,
            value ? 0 : 1,
            this.cipher.seal(value ?? { id, deleted: true }, `outbox:${kindOf[type]}:${id}:${revision}`),
          )
      }
      this.removeConflict(type, id)
      this.applyValues([], this.state().cursor, this.state().epoch, false)
    })()
  }
  execute(operation: string, raw: unknown): unknown {
    if (operation === 'sync.storage.preview') {
      const d = z
        .object({
          runtimeId: z.uuid(),
          seq: integer,
          epoch: positive,
          remote: z.array(remoteSchema).max(200000),
          includeOffline: z.boolean(),
        })
        .parse(raw)
      return this.preview(d.runtimeId, d.seq, d.epoch, d.remote, d.includeOffline)
    }
    if (operation === 'sync.storage.previewInfo' || operation === 'sync.storage.replacement') {
      const d = z.object({ runtimeId: z.uuid(), token: z.uuid() }).parse(raw)
      return operation === 'sync.storage.previewInfo'
        ? this.previewInfo(d.token, d.runtimeId)
        : this.replacement(d.token, d.runtimeId)
    }
    if (operation === 'sync.storage.bootstrap') {
      const d = z
        .object({
          runtimeId: z.uuid(),
          token: z.uuid(),
          mode: z.enum(['merge', 'use_local', 'use_cloud']),
          push: syncPushSchema.optional(),
        })
        .parse(raw)
      return this.bootstrap(d.token, d.runtimeId, d.mode, d.push)
    }
    if (operation === 'sync.storage.state') return this.state()
    if (operation === 'sync.storage.frozen') return this.frozen()
    if (operation === 'sync.storage.draft') return this.draft()
    if (operation === 'sync.storage.conflicts') return this.conflicts()
    const d = raw as Record<string, unknown>
    if (operation === 'sync.storage.status') {
      const p = z.object({ unlocked: z.boolean(), enabled: z.boolean() }).parse(d)
      return this.status(p.unlocked, p.enabled)
    }
    if (operation === 'sync.storage.note') {
      const p = z
        .object({
          phase: schemaState.shape.phase,
          message: z.string().max(1024).default(''),
          code: z.string().max(100).default(''),
        })
        .parse(d)
      return this.note(p.phase, p.message, p.code)
    }
    if (operation === 'sync.storage.apply') {
      const p = z
        .object({
          remote: z.array(remoteSchema).max(200000),
          cursor: integer,
          epoch: positive,
          snapshot: z.boolean().default(false),
        })
        .parse(d)
      return this.apply(p.remote, p.cursor, p.epoch, p.snapshot)
    }
    if (operation === 'sync.storage.freeze')
      return this.freeze(d.draft as Draft, syncPushSchema.parse(d.push))
    if (operation === 'sync.storage.ack') {
      const p = z.object({ requestId: z.uuid(), seq: positive, epoch: positive }).parse(d)
      return this.ack(p.requestId, p.seq, p.epoch)
    }
    if (operation === 'sync.storage.thaw') return this.thaw(z.uuid().parse(d.requestId))
    if (operation === 'sync.storage.resolve') {
      const p = z
        .object({
          itemType: syncWireItemSchema.shape.itemType,
          itemId: z.string().min(1).max(200),
          remoteRevision: integer,
          choice: z.enum(['keep_local', 'use_cloud']),
        })
        .parse(d)
      return this.resolve(p.itemType, p.itemId, p.remoteRevision, p.choice)
    }
    return fail('UNKNOWN_OPERATION', '未开放的同步存储操作')
  }
  close(): void {
    this.cipher.close()
  }
}
