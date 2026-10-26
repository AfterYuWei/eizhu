import { connectionPlan } from '../ssh/plan.ts'
import { ssh, tunnelConfigSchema } from '@eizhu/contracts'
import type { HistoryEntry, HistorySettings, TunnelConfig } from '@eizhu/contracts/models/api'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { DesktopError, fail, local } from '@eizhu/contracts'
import type { LocalInput } from '@eizhu/contracts'
import { LocalCipher } from '../local/crypto.ts'
import { restoreCheckpoint } from '../sftp/checkpoint.ts'
import type { Checkpoint, CheckpointProgress } from '../sftp/checkpoint.ts'
import {
  emptyPayload,
  kinds,
  payloadSchema,
  proxyOf,
  optionsOf,
  validateGraph,
  orderedPayload,
} from '../local/model.ts'
import type { Payload, Kind, StoredProfile, StoredVault } from '../local/model.ts'

type Entity = Payload[Kind][number]
type Preview = {
  token: string
  payload: Payload
  revision: number
  expires: number
  mode: 'none' | 'plain' | 'encrypted'
  exportedAt: string
  source: import('@eizhu/contracts/models/backup').RestorePreview['source']
}
const now = () => new Date().toISOString()
const stats = (p: Payload) => Object.fromEntries(kinds.map((k) => [k, p[k].length])) as Record<Kind, number>
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
function comparable(kind: Kind, item: Entity | undefined): string | undefined {
  if (!item) return undefined
  const payload = emptyPayload()
  ;(payload[kind] as Entity[]).push(item)
  return JSON.stringify(orderedPayload(payload)[kind][0])
}
const find = <T extends { id: string }>(rows: T[], id: string): T =>
  rows.find((row) => row.id === id) ?? fail('NOT_FOUND', '记录不存在')
function inUse(references: Array<{ id: string; name: string }>, message: string): void {
  if (references.length) throw new DesktopError({ code: 'IN_USE', message, references })
}

/** All methods run synchronously in the database Worker. No transactions cross a message boundary. */
export class LocalStore {
  private cipher: LocalCipher
  private db: Database.Database
  constructor(db: Database.Database, key: Uint8Array) {
    this.db = db
    this.cipher = new LocalCipher(key, 'offline')
    const version = db.pragma('user_version', { simple: true })
    if (version === 1)
      db.transaction(() => {
        db.exec(`
        CREATE TABLE entities (kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, item_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, payload BLOB NOT NULL);
        CREATE TABLE local_state (key TEXT PRIMARY KEY, data BLOB NOT NULL);
        CREATE TABLE restore_previews (token TEXT PRIMARY KEY, data BLOB NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE safety_snapshots (id TEXT PRIMARY KEY, data BLOB NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE key_check (id INTEGER PRIMARY KEY CHECK(id=1), data BLOB NOT NULL);
      `)
        db.prepare('INSERT INTO key_check VALUES (1, ?)').run(this.cipher.seal('eizhu-local-v2', 'key-check'))
        db.pragma('user_version = 2')
      })()
    else if (version !== 2) fail('SCHEMA_UNSUPPORTED', '业务数据版本不受支持，原数据已保留')
    const marker = db.prepare('SELECT data FROM key_check WHERE id=1').get() as { data: Buffer } | undefined
    if (!marker || this.cipher.open(marker.data, 'key-check') !== 'eizhu-local-v2')
      fail('KEY_INVALID', '数据密钥校验失败，原数据已保留')
    this.pruneHistory()
  }
  close(): void {
    this.cipher.close()
  }
  transferState(operation:string,input:unknown):unknown{
    const d=input as {id:string;value?:unknown}
    if(operation==='sftp.storage.list')return (this.db.prepare("SELECT key,data FROM local_state WHERE key LIKE 'transfer:%'").all() as Array<{key:string;data:Buffer}>).map(r=>{
      const base=this.cipher.open<Checkpoint>(r.data,r.key)
      const progress=this.state<CheckpointProgress|undefined>(`transfer-progress:${base.task.id}`,undefined)
      return restoreCheckpoint(base,progress)
    })
    if(!/^[a-f0-9-]{36}$/.test(d.id))fail('BAD_REQUEST','传输编号无效')
    const key=`transfer:${d.id}`
    const progressKey=`transfer-progress:${d.id}`
    this.db.transaction(()=>{
      if(operation==='sftp.storage.delete')this.db.prepare('DELETE FROM local_state WHERE key IN (?,?)').run(key,progressKey)
      else if(operation==='sftp.storage.checkpoint')this.setState(progressKey,d.value)
      else {
        this.db.prepare('INSERT INTO local_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key,this.cipher.seal(d.value,key))
        this.db.prepare('DELETE FROM local_state WHERE key=?').run(progressKey)
      }
    })()
  }
  archiveState<T>(key: string, fallback: T): T { return this.state(`archive:${key}`, fallback) }
  archiveWrite(key: string, value: unknown): void {
    this.db.transaction(() => this.setState(`archive:${key}`, value))()
  }
  archiveTransaction<T>(work: () => T): T { return this.db.transaction(work)() }
  archiveDelete(key: string): void { this.db.prepare('DELETE FROM local_state WHERE key=?').run(`archive:${key}`) }
  archiveRevision(): number { return this.revision() }
  snapshot(): Payload {
    const result = emptyPayload()
    for (const kind of kinds) {
      const rows = this.db
        .prepare('SELECT id, data FROM entities WHERE kind=? ORDER BY id')
        .all(kind) as Array<{ id: string; data: Buffer }>
      for (const row of rows)
        (result[kind] as Entity[]).push(this.cipher.open<Entity>(row.data, `entity:${kind}:${row.id}`))
    }
    return result
  }
  private revision(): number {
    return (this.db.prepare('SELECT revision FROM revisions WHERE id=1').get() as { revision: number })
      .revision
  }
  private audit(action: string, id = ''): void {
    this.db.prepare('INSERT INTO audit VALUES (?, ?, ?, ?)').run(randomUUID(), action, id, now())
  }
  private profile(item: StoredProfile) {
    const metadata = { ...item },
      password = item.proxy_password
    delete metadata.inline_credential
    delete metadata.proxy_password
    return { ...metadata, proxy: { ...proxyOf(item), has_password: Boolean(password) } }
  }
  private vault(item: StoredVault, payload: Payload, references?: Map<string, number>) {
    const { credential, ...metadata } = item
    return {
      ...metadata,
      has_passphrase: Boolean(credential?.passphrase),
      ref_count: references
        ? (references.get(item.id) ?? 0)
        : payload.profiles.filter((p) => p.vault_id === item.id).length,
    }
  }
  private resultSnapshot(p: Payload) {
    const references = this.referenceCounts(p)
    return {
      groups: p.groups,
      profiles: p.profiles.map((p) => this.profile(p)),
      vault: p.vault.map((v) => this.vault(v, p, references)),
    }
  }
  private referenceCounts(p: Payload): Map<string, number> {
    const references = new Map<string, number>()
    for (const profile of p.profiles)
      if (profile.vault_id) references.set(profile.vault_id, (references.get(profile.vault_id) ?? 0) + 1)
    return references
  }
  private commit(before: Payload, after: Payload, action: string, id = '', safety = false): void {
    payloadSchema.parse(after)
    validateGraph(after)
    const revision = this.revision() + 1
    if (safety) {
      const snapshotId = randomUUID()
      this.db
        .prepare('INSERT INTO safety_snapshots VALUES (?, ?, ?)')
        .run(snapshotId, this.cipher.seal(before, `safety:${snapshotId}`), now())
    }
    for (const kind of kinds) {
      const old = new Map<string, Entity>(before[kind].map((v) => [v.id, v]))
      const next = new Map<string, Entity>(after[kind].map((v) => [v.id, v]))
      for (const itemId of new Set([...old.keys(), ...next.keys()])) {
        const item = next.get(itemId)
        if (comparable(kind, old.get(itemId)) === comparable(kind, item)) continue
        if (item)
          this.db
            .prepare(
              'INSERT INTO entities VALUES (?, ?, ?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
            )
            .run(kind, itemId, this.cipher.seal(item, `entity:${kind}:${itemId}`))
        else this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, itemId)
        this.db
          .prepare('INSERT INTO outbox(kind,item_id,revision,deleted,payload) VALUES (?,?,?,?,?)')
          .run(
            kind,
            itemId,
            revision,
            item ? 0 : 1,
            this.cipher.seal(item ?? { id: itemId, deleted: true }, `outbox:${kind}:${itemId}:${revision}`),
          )
      }
    }
    this.db.prepare('UPDATE revisions SET revision=? WHERE id=1').run(revision)
    this.audit(action, id)
  }
  private mutate<T>(action: string, id: string, apply: (payload: Payload) => T): T {
    return this.db.transaction(() => {
      const before = this.snapshot(),
        after = structuredClone(before)
      const result = apply(after)
      this.commit(before, after, action, id)
      return result
    })()
  }
  private writeProfile(id: string, request: LocalInput<'profile.update'>['request'], creating: boolean) {
    return this.mutate(creating ? 'profile_create' : 'profile_update', id, (p) => {
      const time = now()
      const previous: StoredProfile = creating
        ? {
            id,
            name: '',
            host: '',
            port: 22,
            username: '',
            auth_type: 'password',
            icon: 'server',
            tags: [],
            options: '{}',
            note: '',
            sort_order: 0,
            created_at: time,
            updated_at: time,
          }
        : find(p.profiles, id)
      const { password, private_key, passphrase, proxy, ...metadata } = request
      const next: StoredProfile = { ...previous, ...defined(metadata), updated_at: time }
      next.host = next.host.trim()
      next.username = next.username.trim()
      next.name = next.name.trim() || next.host
      if (!next.host || !next.username) fail('VALIDATION', '主机和用户名不能为空')
      if (proxy) {
        const root = optionsOf(next.options)
        const { password: proxyPassword, ...proxyMetadata } = proxy
        const oldProxy = proxyOf(previous)
        root.proxy = proxyMetadata
        next.options = JSON.stringify(root)
        const same =
          oldProxy.type === proxy.type &&
          oldProxy.host === proxy.host &&
          oldProxy.port === proxy.port &&
          oldProxy.username === proxy.username
        next.proxy_password =
          proxy.type === 'socks5' || proxy.type === 'http'
            ? proxyPassword || (same ? previous.proxy_password : '')
            : ''
      }
      if (next.auth_type === 'vault') {
        const vault = find(p.vault, next.vault_id ?? '')
        if (vault.type === 'password') next.username = vault.username
        delete next.inline_credential
      } else {
        delete next.vault_id
        if (next.auth_type !== previous.auth_type) delete next.inline_credential
        if (next.auth_type === 'password' && password) next.inline_credential = { password }
        if (next.auth_type === 'key' && private_key)
          next.inline_credential = { private_key, ...(passphrase ? { passphrase } : {}) }
        if (next.auth_type === 'agent' || next.auth_type === 'none') delete next.inline_credential
      }
      if (next.group_id === '') delete next.group_id
      if (creating) p.profiles.push(next)
      else p.profiles[p.profiles.findIndex((p) => p.id === id)] = next
      return this.profile(next)
    })
  }
  private writeVault(id: string, request: LocalInput<'vault.create'>['request'], creating: boolean) {
    return this.mutate(creating ? 'vault_create' : 'vault_update', id, (p) => {
      const prior = creating ? undefined : find(p.vault, id)
      if (prior && prior.type !== request.type) fail('VALIDATION', '凭据类型不能修改')
      const username = request.type === 'password' ? request.username?.trim() || '' : ''
      if (request.type === 'password' && (!username || !request.password))
        fail('VALIDATION', '用户名和密码不能为空')
      if (request.type === 'private_key' && !request.private_key) fail('VALIDATION', '私钥不能为空')
      const item: StoredVault = {
        id,
        name: request.name.trim(),
        type: request.type,
        username,
        remark: request.remark ?? '',
        fingerprint: '',
        credential:
          request.type === 'password'
            ? { password: request.password! }
            : {
                private_key: request.private_key!,
                public_key: request.public_key,
                passphrase: request.passphrase,
              },
        created_at: prior?.created_at ?? now(),
        updated_at: now(),
      }
      // Key validation/derivation is performed by the compute Worker before this database message.
      if (request.type === 'private_key') item.fingerprint = this.keyFingerprint(request.private_key!)
      if (creating) p.vault.push(item)
      else p.vault[p.vault.findIndex((v) => v.id === id)] = item
      if (request.type === 'password')
        for (const profile of p.profiles)
          if (profile.vault_id === id) {
            profile.username = username
            profile.updated_at = now()
          }
      return this.vault(item, p)
    })
  }
  private keyFingerprint(key: string): string {
    return keyFingerprint(key)
  }
  private state<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT data FROM local_state WHERE key=?').get(key) as
      { data: Buffer } | undefined
    return row ? this.cipher.open<T>(row.data, `state:${key}`) : fallback
  }
  private setState(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO local_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
      .run(key, this.cipher.seal(value, `state:${key}`))
  }
  pruneHistory(): void {
    this.db.transaction(() => {
      const settings = this.state<HistorySettings>('history_settings', {
        enabled: true,
        maxEntries: 500,
        retentionDays: 30,
      })
      const keys = this.db.prepare("SELECT key FROM local_state WHERE key LIKE 'history:%'").all() as Array<{
        key: string
      }>
      for (const { key } of keys) {
        const rows = this.state<HistoryEntry[]>(key, [])
          .filter((e) => e.lastAt >= Date.now() - settings.retentionDays * 86400000)
          .sort((a, b) => b.lastAt - a.lastAt)
          .slice(0, settings.maxEntries)
        if (rows.length) this.setState(key, rows)
        else this.db.prepare('DELETE FROM local_state WHERE key=?').run(key)
      }
    })()
  }
  sshExecute(operation: string, input: unknown): unknown {
    if (operation === 'ssh.pruneHistory') return this.pruneHistory()
    if (operation === 'ssh.plan')
      return connectionPlan(this.snapshot(), input as { id?: string; request?: unknown })
    if (operation === 'ssh.known')
      return this.state<string | null>(`host:${(input as { endpoint: string }).endpoint}`, null)
    if (operation === 'ssh.trust') {
      const d = input as { endpoint: string; fingerprint: string }
      return this.db.transaction(() => {
        this.setState(`host:${d.endpoint}`, d.fingerprint)
        this.audit('ssh_host_trust')
      })()
    }
    if (operation === 'history.list' || operation === 'history.record' || operation === 'history.delete')
      return this.db.transaction(() => {
        const d = input as { profileId?: string; id?: string; command?: string; cwd?: string }
        const settings = this.state<HistorySettings>('history_settings', {
          enabled: true,
          maxEntries: 500,
          retentionDays: 30,
        })
        if (operation === 'history.delete' && !d.profileId) {
          this.db.prepare("DELETE FROM local_state WHERE key LIKE 'history:%'").run()
          return
        }
        if (d.profileId) find(this.snapshot().profiles, d.profileId)
        const key = `history:${d.profileId}`
        let entries = this.state<HistoryEntry[]>(key, [])
          .filter((e) => e.lastAt >= Date.now() - settings.retentionDays * 86400000)
          .sort((a, b) => b.lastAt - a.lastAt)
          .slice(0, settings.maxEntries)
        if (operation === 'history.record' && settings.enabled) {
          const old = entries.find((e) => e.command === d.command && e.cwd === d.cwd)
          entries = [
            {
              id: old?.id ?? randomUUID(),
              command: d.command!,
              cwd: d.cwd!,
              count: (old?.count ?? 0) + 1,
              lastAt: Date.now(),
            },
            ...entries.filter((e) => e !== old),
          ].slice(0, settings.maxEntries)
        }
        if (operation === 'history.delete') entries = d.id ? entries.filter((e) => e.id !== d.id) : []
        this.setState(key, entries)
        return operation === 'history.list' ? entries : undefined
      })()
    if (operation === 'tunnel.list') return this.state<TunnelConfig[]>('tunnels', [])
    if (operation === 'tunnel.save' || operation === 'tunnel.delete')
      return this.db.transaction(() => {
        const configs = this.state<TunnelConfig[]>('tunnels', [])
        if (operation === 'tunnel.delete') {
          const { id } = ssh[operation].input.parse(input)
          this.setState(
            'tunnels',
            configs.filter((c) => c.id !== id),
          )
          return
        }
        const { config } = ssh['tunnel.save'].input.parse(input)
        find(this.snapshot().profiles, config.profile_id)
        const next = tunnelConfigSchema.parse({ ...config, id: config.id || randomUUID() })
        const remaining = configs.filter((c) => c.id !== next.id)
        if (remaining.length >= 128) fail('QUEUE_FULL', '隧道配置过多')
        this.setState('tunnels', [...remaining, next])
        this.audit('tunnel_save', next.id)
        return next
      })()
    return fail('UNKNOWN_OPERATION', '未开放的 SSH 存储操作')
  }
  execute(operation: string, input: unknown): unknown {
    switch (operation) {
      case 'profile.list': {
        const data = local[operation].input.parse(input)
        return this.snapshot()
          .profiles.filter(
            (p) =>
              (!data.groupId || p.group_id === data.groupId) &&
              (!data.search ||
                [p.name, p.host, p.username, p.note, ...p.tags].some((v) =>
                  v.toLowerCase().includes(data.search!.toLowerCase()),
                )),
          )
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
          .map((p) => this.profile(p))
      }
      case 'profile.get':
        return this.profile(find(this.snapshot().profiles, local[operation].input.parse(input).id))
      case 'profile.create':
        return this.writeProfile(randomUUID(), local[operation].input.parse(input).request, true)
      case 'profile.update': {
        const d = local[operation].input.parse(input)
        return this.writeProfile(d.id, d.request, false)
      }
      case 'profile.delete': {
        const { id } = local[operation].input.parse(input)
        return this.mutate('profile_delete', id, (p) => {
          find(p.profiles, id)
          inUse(
            this.state<TunnelConfig[]>('tunnels', [])
              .filter((c) => c.profile_id === id)
              .map((c) => ({ id: c.id, name: c.name })),
            '该服务器仍被隧道引用',
          )
          this.db.prepare('DELETE FROM local_state WHERE key=?').run(`history:${id}`)
          inUse(
            p.profiles.filter((v) => proxyOf(v).jump_profile_id === id).map(({ id, name }) => ({ id, name })),
            '该服务器仍被用作跳板',
          )
          p.profiles = p.profiles.filter((v) => v.id !== id)
        })
      }
      case 'group.list':
        return this.snapshot().groups.sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        )
      case 'group.create':
      case 'group.update': {
        const d =
          operation === 'group.create'
            ? local[operation].input.parse(input)
            : local[operation].input.parse(input)
        const id = 'id' in d ? d.id : randomUUID()
        return this.mutate(operation === 'group.create' ? 'group_create' : 'group_update', id, (p) => {
          const previous =
            operation === 'group.create'
              ? { id, name: '', icon: 'folder', sort_order: 0, created_at: now() }
              : find(p.groups, id)
          const item = { ...previous, ...defined(d.request), id }
          if (!item.parent_id) delete item.parent_id
          if (operation === 'group.create') p.groups.push(item)
          else p.groups[p.groups.findIndex((g) => g.id === id)] = item
          return item
        })
      }
      case 'group.delete': {
        const { id } = local[operation].input.parse(input)
        return this.mutate('group_delete', id, (p) => {
          find(p.groups, id)
          inUse(
            [
              ...p.groups.filter((g) => g.parent_id === id),
              ...p.profiles.filter((v) => v.group_id === id),
            ].map(({ id, name }) => ({ id, name })),
            '该分组仍有子分组或服务器，请先移动或删除',
          )
          p.groups = p.groups.filter((g) => g.id !== id)
        })
      }
      case 'vault.list': {
        const d = local[operation].input.parse(input),
          p = this.snapshot()
        const references = this.referenceCounts(p)
        return p.vault
          .filter(
            (v) =>
              (!d.vaultType || v.type === d.vaultType) &&
              (!d.q ||
                [v.name, v.username, v.remark].some((t) => t.toLowerCase().includes(d.q!.toLowerCase()))),
          )
          .map((v) => this.vault(v, p, references))
      }
      case 'vault.get': {
        const p = this.snapshot()
        return this.vault(find(p.vault, local[operation].input.parse(input).id), p)
      }
      case 'vault.create':
        return this.writeVault(randomUUID(), local[operation].input.parse(input).request, true)
      case 'vault.update': {
        const d = local[operation].input.parse(input)
        return this.writeVault(d.id, d.request, false)
      }
      case 'vault.references': {
        const { id } = local[operation].input.parse(input)
        return this.snapshot()
          .profiles.filter((v) => v.vault_id === id)
          .map(({ id, name }) => ({ id, name }))
      }
      case 'vault.reveal': {
        const { id } = local[operation].input.parse(input)
        return this.db.transaction(() => {
          const value = find(this.snapshot().vault, id).credential
          this.audit('vault_reveal', id)
          return value ?? {}
        })()
      }
      case 'vault.delete': {
        const { id } = local[operation].input.parse(input)
        return this.mutate('vault_delete', id, (p) => {
          find(p.vault, id)
          inUse(
            p.profiles.filter((v) => v.vault_id === id).map(({ id, name }) => ({ id, name })),
            '该凭据仍被服务器引用',
          )
          p.vault = p.vault.filter((v) => v.id !== id)
        })
      }
      case 'snippet.list':
        return this.snapshot().snippets
      case 'snippet.create':
      case 'snippet.update': {
        const d =
            operation === 'snippet.create'
              ? local[operation].input.parse(input)
              : local[operation].input.parse(input),
          id = 'id' in d ? d.id : randomUUID()
        return this.mutate(operation === 'snippet.create' ? 'snippet_create' : 'snippet_update', id, (p) => {
          const previous =
            operation === 'snippet.create'
              ? {
                  id,
                  name: '',
                  content: '',
                  description: '',
                  tags: [],
                  is_global: false,
                  created_at: now(),
                  updated_at: now(),
                }
              : find(p.snippets, id)
          const item = { ...previous, ...defined(d.request), updated_at: now() }
          if (operation === 'snippet.create') p.snippets.push(item)
          else p.snippets[p.snippets.findIndex((s) => s.id === id)] = item
          return item
        })
      }
      case 'snippet.delete': {
        const { id } = local[operation].input.parse(input)
        return this.mutate('snippet_delete', id, (p) => {
          find(p.snippets, id)
          p.snippets = p.snippets.filter((s) => s.id !== id)
        })
      }
      case 'audit.list':
        return this.db
          .prepare('SELECT * FROM audit ORDER BY rowid DESC LIMIT ?')
          .all(local[operation].input.parse(input).limit)
      case 'audit.clear':
        return this.db.transaction(() => {
          this.db.prepare('DELETE FROM audit').run()
          this.audit('audit_clear')
        })()
      case 'localState.read': {
        const { key } = local[operation].input.parse(input)
        const row = this.db.prepare('SELECT data FROM local_state WHERE key=?').get(key) as
          { data: Buffer } | undefined
        return row ? this.cipher.open(row.data, `state:${key}`) : null
      }
      case 'localState.write': {
        const { key, value } = local[operation].input.parse(input)
        let encoded: string
        try {
          encoded = JSON.stringify(value)
        } catch {
          return fail('BAD_REQUEST', '设置不是有效 JSON')
        }
        if (!encoded! || Buffer.byteLength(encoded) > 65536) fail('BAD_REQUEST', '设置内容过大或无效')
        this.db.transaction(() => {
          this.db
            .prepare('INSERT INTO local_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
            .run(key, this.cipher.seal(value, `state:${key}`))
          this.audit('local_state_write')
          if (key === 'history_settings') this.pruneHistory()
        })()
        return
      }
      case 'backup.safetyVersions':
        return this.db
          .prepare('SELECT id,created_at AS createdAt FROM safety_snapshots ORDER BY rowid DESC')
          .all()
      case 'backup.previewSafety': {
        const { id } = local[operation].input.parse(input),
          row = this.db.prepare('SELECT data,created_at FROM safety_snapshots WHERE id=?').get(id) as
            { data: Buffer; created_at: string } | undefined
        if (!row) fail('NOT_FOUND', '安全快照不存在')
        const { conflicts, ...preview } = this.prepare({
          payload: this.cipher.open(row.data, `safety:${id}`),
          mode: 'encrypted',
          exportedAt: row.created_at,
          source: { kind: 'safety', createdAt: row.created_at },
        })
        void conflicts
        return preview
      }
      case 'backup.applyRestore': {
        const d = local[operation].input.parse(input)
        this.apply(d.token, d.mode === 'replace' ? 'replace' : 'overwrite')
        return
      }
      default:
        return fail('UNKNOWN_OPERATION', '未开放的本地操作')
    }
  }
  prepare(input: Omit<Preview, 'token' | 'revision' | 'expires'>) {
    const payload = payloadSchema.parse(input.payload)
    try {
      validateGraph(payload)
    } catch {
      return fail('IMPORT_FAILED', '备份关联或数据内容无效')
    }
    const current = this.snapshot(),
      changes = Object.fromEntries(
        kinds.map((kind) => {
          const before = new Map<string, Entity>(current[kind].map((v) => [v.id, v])),
            after = new Map<string, Entity>(payload[kind].map((v) => [v.id, v]))
          return [
            kind,
            {
              added: [...after.keys()].filter((id) => !before.has(id)).length,
              changed: [...after].filter(
                ([id, v]) => before.has(id) && comparable(kind, before.get(id)) !== comparable(kind, v),
              ).length,
              unchanged: [...after].filter(
                ([id, v]) => comparable(kind, before.get(id)) === comparable(kind, v),
              ).length,
              removedInReplace: [...before.keys()].filter((id) => !after.has(id)).length,
            },
          ]
        }),
      )
    const preview: Preview = {
      ...input,
      payload,
      token: randomUUID(),
      revision: this.revision(),
      expires: Date.now() + 15 * 60 * 1000,
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM restore_previews WHERE expires<?').run(Date.now())
      this.db
        .prepare(
          'DELETE FROM restore_previews WHERE token IN (SELECT token FROM restore_previews ORDER BY rowid DESC LIMIT -1 OFFSET 3)',
        )
        .run()
      this.db
        .prepare('INSERT INTO restore_previews VALUES (?,?,?)')
        .run(preview.token, this.cipher.seal(preview, `preview:${preview.token}`), preview.expires)
    })()
    return {
      token: preview.token,
      stats: stats(payload),
      changes,
      credentialMode: preview.mode,
      exportedAt: preview.exportedAt,
      source: preview.source,
      conflicts: Object.fromEntries(
        kinds.map((k) => {
          const ids = new Set(current[k].map((c) => c.id))
          return [k, payload[k].filter((v) => ids.has(v.id)).length]
        }),
      ),
    }
  }
  apply(token: string, strategy: 'skip' | 'overwrite' | 'regenerate' | 'replace') {
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT data FROM restore_previews WHERE token=? AND expires>=?')
        .get(token, Date.now()) as { data: Buffer } | undefined
      if (!row) fail('PREVIEW_EXPIRED', '请重新预览备份')
      const preview = this.cipher.open<Preview>(row.data, `preview:${token}`)
      if (preview.revision !== this.revision()) fail('PREVIEW_CHANGED', '本地数据已变化，请重新预览')
      const before = this.snapshot(),
        incoming = structuredClone(preview.payload),
        after = strategy === 'replace' ? emptyPayload() : structuredClone(before)
      if (strategy === 'regenerate') {
        const maps = Object.fromEntries(
          kinds.map((k) => [k, new Map(incoming[k].map((v) => [v.id, randomUUID()]))]),
        ) as Record<Kind, Map<string, string>>
        for (const k of kinds)
          for (const v of incoming[k]) {
            v.id = maps[k].get(v.id)!
          }
        for (const g of incoming.groups)
          if (g.parent_id) g.parent_id = maps.groups.get(g.parent_id) ?? g.parent_id
        for (const p of incoming.profiles) {
          if (p.group_id) p.group_id = maps.groups.get(p.group_id) ?? p.group_id
          if (p.vault_id) p.vault_id = maps.vault.get(p.vault_id) ?? p.vault_id
          const root = optionsOf(p.options),
            proxy = proxyOf(p)
          if (proxy.type === 'jump' && proxy.jump_profile_id) {
            root.proxy = {
              ...proxy,
              jump_profile_id: maps.profiles.get(proxy.jump_profile_id) ?? proxy.jump_profile_id,
            }
            p.options = JSON.stringify(root)
          }
        }
      }
      const imported = { groups: 0, vault: 0, profiles: 0, snippets: 0 },
        skipped = { ...imported }
      for (const kind of kinds) {
        const target = after[kind] as Entity[],
          indices = new Map(target.map((item, index) => [item.id, index]))
        for (const item of incoming[kind]) {
          const index = indices.get(item.id)
          if (index !== undefined && strategy === 'skip') {
            skipped[kind]++
            continue
          }
          if (index === undefined) {
            indices.set(item.id, target.length)
            target.push(item)
          } else target[index] = item
          imported[kind]++
        }
      }
      // Shared password usernames must remain consistent even for skip/overwrite mixtures.
      const vaults = new Map(after.vault.map((v) => [v.id, v]))
      for (const profile of after.profiles)
        if (profile.auth_type === 'vault') {
          const vault = vaults.get(profile.vault_id ?? '')
          if (vault?.type === 'password') profile.username = vault.username
        }
      try {
        this.commit(before, after, 'backup_import', '', true)
      } catch (cause) {
        if (cause instanceof DesktopError && cause.error.code !== 'DATA_DECRYPT_FAILED')
          fail('IMPORT_FAILED', '导入后的关联无效，未修改任何数据')
        throw cause
      }
      this.db.prepare('DELETE FROM restore_previews').run()
      return { imported, skipped, snapshot: this.resultSnapshot(after) }
    })()
  }
}

import { createHash } from 'node:crypto'
function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}
