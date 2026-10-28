import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { DesktopError } from '@eizhu/contracts'
import type { AccountStatus, SyncStatus, SyncPreview, SyncConflict } from '@eizhu/contracts'

export interface LiveActor {
  call<T = unknown>(operation: string, input?: unknown): Promise<T>
  login(operation: 'account.register' | 'account.login', email: string, password: string): Promise<void>
  restart(): Promise<void>
  logout(): Promise<void>
  faults: {
    forceMe401: boolean
    dropRefresh: boolean
    dropPush: boolean
    pushCount: number
    pushHashes: string[]
    refreshCount: number
    revokeOldRefresh(): Promise<boolean>
  }
  events: { opened: number; closed: number; hints: number }
}
export type AcceptanceInput = (kind: 'verify' | 'reset') => Promise<string>
const code = (expected: string) => (e: unknown) => e instanceof DesktopError && e.error.code === expected
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function wait(probe: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 300; i++) {
    if (await probe()) return
    await sleep(100)
  }
  throw new DesktopError({ code: 'ACCEPTANCE_TIMEOUT', message: `验收未完成：${label}` })
}
/** The caller supplies isolated real runtime actors. Secrets stay in this trusted test process. */
export async function acceptLiveSync(
  a: LiveActor,
  b: LiveActor,
  email: string,
  input: AcceptanceInput,
  phase: (name: string) => void,
  options: { resume?: boolean } = {},
) {
  const password = randomBytes(36).toString('base64url'),
    syncPassword = randomBytes(32).toString('base64url'),
    nextSyncPassword = randomBytes(32).toString('base64url')
  const challenge = async (
    kind: 'verify' | 'reset',
    send: () => Promise<unknown>,
    apply: (code: string) => Promise<unknown>,
  ) => {
    const deliver = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await send()
          return
        } catch (error) {
          if (!code('RATE_LIMITED')(error) || attempt >= 2) throw error
          const seconds =
            Number(((error as DesktopError).details as { retryAfterSeconds?: number })?.retryAfterSeconds) ||
            60
          if (seconds > 120) throw error
          phase('mail-rate-limited')
          await sleep(Math.max(1000, seconds * 1000))
        }
      }
    }
    await deliver()
    for (;;) {
      const value = await input(kind)
      if (value === 'resend') {
        try {
          await deliver()
        } catch (error) {
          if (!code('RATE_LIMITED')(error)) throw error
          phase('mail-rate-limited')
        }
        continue
      }
      try {
        await apply(value)
        return
      } catch (error) {
        if (!code('INVALID_EMAIL_CODE')(error)) throw error
        phase('mail-code-invalid')
      }
    }
  }
  let verificationPerformed = false
  const checks: string[] = [],
    status = (actor: LiveActor) => actor.call<SyncStatus>('sync.status')
  const settled = (actor: LiveActor) =>
    wait(async () => {
      const s = await status(actor)
      if (s.lastErrorCode && !['ACCOUNT_UNAVAILABLE', 'RATE_LIMITED'].includes(s.lastErrorCode))
        throw new DesktopError({ code: s.lastErrorCode, message: s.lastError })
      return s.initialized && s.pendingCount === 0 && s.conflictCount === 0 && s.status === 'synced'
    }, '同步确认')
  const toggle = (actor: LiveActor, enabled: boolean) => actor.call('account.setSyncEnabled', { enabled })
  const bootstrap = async (actor: LiveActor, includeOffline: boolean) => {
    const preview = await actor.call<SyncPreview>('sync.preview', { includeOffline })
    await actor.call('sync.bootstrap', { token: preview.token, mode: 'merge' })
    await settled(actor)
    return preview
  }
  if (options.resume) {
    const previous = await a.call<AccountStatus>('account.status')
    if (!previous.loggedIn || previous.user.email.toLowerCase() !== email.trim().toLowerCase())
      throw new DesktopError({ code: 'ACCEPTANCE_IDENTITY', message: '验收来源账号与专用邮箱不匹配' })
    await a.logout()
  }
  const sentinel = async (actor: LiveActor, name: string) => {
    const rows = await actor.call<Array<{ id: string; name: string }>>('group.list')
    if (options.resume && rows.length === 1 && rows[0].name === name) return rows[0]
    if (rows.length) throw new DesktopError({ code: 'ACCEPTANCE_NONEMPTY', message: '验收离线空间状态不符' })
    return actor.call<{ id: string }>('group.create', { request: { name } })
  }
  const offline = await sentinel(a, '同步验收离线哨兵')
  const offlineB = await sentinel(b, '第二端独立离线哨兵')
  if (options.resume) {
    phase('recover-owned-test-account')
    await challenge(
      'reset',
      () => a.call('account.requestPasswordReset', { email }),
      (code) => a.call('account.resetPassword', { email, code, newPassword: password }),
    )
    await a.login('account.login', email, password)
    checks.push('在新目录恢复本次专用测试账号；找回邮件验证后重新登录，原失败目录保留')
  } else {
    phase('register')
    await a.login('account.register', email, password)
  }
  const registered = await a.call<AccountStatus>('account.status')
  assert.equal(registered.loggedIn, true)
  if (!registered.loggedIn) throw new Error()
  if (!registered.user.emailVerified) {
    phase('verification-mail')
    await challenge(
      'verify',
      () => a.call('account.sendVerificationEmail'),
      (code) => a.call('account.verifyEmail', { code }),
    )
    assert.equal((await a.call<AccountStatus>('account.status')).user?.emailVerified, true)
    verificationPerformed = true
    checks.push('注册、发送验证请求与验证码验证')
  } else checks.push('注册；服务端已返回邮箱验证状态')
  a.faults.forceMe401 = true
  await a.call('account.me')
  assert.ok(a.faults.refreshCount > 0)
  assert.equal(await a.faults.revokeOldRefresh(), true)
  checks.push('客户端注入过期响应后调用刷新接口；轮换后的旧 refresh token 被服务端拒绝')
  phase('initial-preview')
  await a.call('sync.unlock', { password: syncPassword })
  const preview = await a.call<SyncPreview>('sync.preview', { includeOffline: true })
  if (preview.cloudCount !== 0)
    throw new DesktopError({ code: 'ACCEPTANCE_NONEMPTY', message: '测试账号已有云端条目，已停止写入' })
  assert.equal(preview.offlineCount, 1)
  assert.equal((await status(a)).initialized, false)
  await a.call('sync.bootstrap', { token: preview.token, mode: 'merge' })
  await settled(a)
  await b.login('account.login', email, password)
  await b.call('sync.unlock', { password: syncPassword })
  await bootstrap(b, false)
  assert.ok((await b.call<Array<{ id: string }>>('group.list')).some((g) => g.id === offline.id))
  checks.push('密钥包装、设备登记、固定水位快照；确认前不上传，离线合并保留，第二目录拉取成功')

  phase('four-item-types')
  await toggle(a, false)
  const group = await a.call<{ id: string }>('group.create', { request: { name: '云同步验收分组' } })
  const vault = await a.call<{ id: string }>('vault.create', {
    request: {
      name: '云同步合成凭据',
      type: 'password',
      username: 'synthetic-user',
      password: 'SYNTHETIC-NOT-A-REAL-CREDENTIAL',
    },
  })
  const profile = await a.call<{ id: string }>('profile.create', {
    request: {
      name: '云同步合成服务器',
      host: 'acceptance.example.invalid',
      username: 'synthetic-user',
      auth_type: 'vault',
      vault_id: vault.id,
      group_id: group.id,
    },
  })
  const snippet = await a.call<{ id: string }>('snippet.create', {
    request: {
      name: '云同步合成片段',
      content: 'printf eizhu-acceptance',
      description: '仅验证存储，不执行',
      tags: ['synthetic'],
    },
  })
  await wait(async () => b.events.opened > 0 && b.events.hints > 0, '变化通知连接就绪')
  const hints = b.events.hints,
    connections = b.events.opened
  await toggle(a, true)
  await a.call('sync.now')
  await settled(a)
  await wait(async () => b.events.hints > hints, '服务端 SSE 变化通知')
  assert.equal(b.events.opened, connections)
  await wait(async () => (await status(b)).cursor >= (await status(a)).cursor, '另一端增量拉取')
  assert.ok(
    (await b.call<Array<{ id: string }>>('profile.list', { groupId: null, search: null })).some(
      (p) => p.id === profile.id,
    ),
  )
  const credential = await b.call<{ password?: string }>('vault.reveal', { id: vault.id })
  assert.equal(credential.password, 'SYNTHETIC-NOT-A-REAL-CREDENTIAL')
  assert.ok((await b.call<Array<{ id: string }>>('snippet.list')).some((p) => p.id === snippet.id))
  checks.push('四类条目、分组与凭据关联和敏感正文加密往返；SSE 通知触发另一端增量拉取')

  phase('concurrent-conflict')
  await toggle(a, false)
  await toggle(b, false)
  await a.call('group.update', { id: group.id, request: { name: 'A 端并发编辑' } })
  await b.call('group.update', { id: group.id, request: { name: 'B 端并发编辑' } })
  await toggle(a, true)
  await a.call('sync.now')
  await settled(a)
  await toggle(b, true)
  await b.call('sync.now')
  const conflict = (await b.call<SyncConflict[]>('sync.conflicts')).find((c) => c.itemId === group.id)!
  assert.ok(conflict)
  await assert.rejects(
    b.call('sync.resolveConflict', {
      itemType: 'group',
      itemId: group.id,
      choice: 'keep_local',
      remoteRevision: conflict.remoteRevision - 1,
    }),
    code('CONFLICT_CHANGED'),
  )
  await b.call('sync.resolveConflict', {
    itemType: 'group',
    itemId: group.id,
    choice: 'keep_local',
    remoteRevision: conflict.remoteRevision,
  })
  await b.call('sync.now')
  await settled(b)
  await a.call('sync.now')
  await settled(a)
  assert.equal(
    (await a.call<Array<{ id: string; name: string }>>('group.list')).find((g) => g.id === group.id)!.name,
    'B 端并发编辑',
  )
  checks.push('服务端双端并发修改、修订冲突和保留本地选择；旧修订选择被拒绝')

  phase('unknown-push-result')
  await toggle(a, false)
  const beforePush = a.faults.pushCount
  a.faults.dropPush = true
  await a.call('group.update', { id: group.id, request: { name: '提交响应丢失' } })
  await toggle(a, true)
  await wait(async () => (await status(a)).lastErrorCode === 'ACCOUNT_UNAVAILABLE', '提交响应丢失')
  assert.equal(a.faults.pushCount - beforePush, 1)
  await a.restart()
  await settled(a)
  assert.equal(a.faults.pushCount - beforePush, 1)
  checks.push('服务端提交后在客户端丢弃响应；进程重启查询原请求恢复，未再次提交')

  phase('epoch-replacement')
  await b.call('sync.now')
  await settled(b)
  await toggle(b, false)
  await b.call('snippet.update', { id: snippet.id, request: { content: 'printf pending-during-epoch' } })
  const replace = await a.call<SyncPreview>('sync.preview', { includeOffline: false })
  await a.call('sync.bootstrap', { token: replace.token, mode: 'use_local' })
  await a.call('sync.now')
  await settled(a)
  await toggle(b, true)
  await b.call('sync.now')
  await settled(b)
  assert.equal(
    (await b.call<Array<{ id: string; content: string }>>('snippet.list')).find((s) => s.id === snippet.id)!
      .content,
    'printf pending-during-epoch',
  )
  checks.push('服务端整体替换与下一 epoch；另一端重取快照并保留替换期间的本地修改')

  phase('sync-password-rotation')
  await a.call('sync.changePassword', { password: nextSyncPassword })
  await b.logout()
  assert.deepEqual(
    (await b.call<Array<{ id: string }>>('group.list')).map((g) => g.id),
    [offlineB.id],
  )
  assert.equal(await b.faults.revokeOldRefresh(), true)
  await b.login('account.login', email, password)
  assert.equal((await status(b)).unlocked, false)
  await assert.rejects(b.call('sync.unlock', { password: syncPassword }), code('SYNC_CRYPTO'))
  await b.call('sync.unlock', { password: nextSyncPassword })
  await toggle(b, true)
  await b.call('sync.now')
  await settled(b)
  checks.push('密钥包装 CAS 与同步密码轮换，业务密文仍可解密')

  phase('lost-refresh-result')
  await toggle(a, false)
  a.faults.forceMe401 = true
  a.faults.dropRefresh = true
  await assert.rejects(a.call('account.me'), code('ACCOUNT_UNAVAILABLE'))
  assert.equal((await a.call<AccountStatus>('account.status')).sessionState, 'reauth_required')
  assert.ok((await a.call<Array<{ id: string }>>('group.list')).some((g) => g.id === group.id))
  await a.login('account.login', email, password)
  assert.equal((await status(a)).unlocked, true)
  checks.push('刷新轮换后丢弃响应要求重新登录，账号空间、本地数据与记住解锁保留')

  phase('password-reset-mail')
  const newPassword = randomBytes(36).toString('base64url')
  await challenge(
    'reset',
    () => a.call('account.requestPasswordReset', { email }),
    (code) => a.call('account.resetPassword', { email, code, newPassword }),
  )
  await assert.rejects(b.call('account.me'), code('ACCOUNT_NOT_LOGGED_IN'))
  await a.login('account.login', email, newPassword)
  await b.login('account.login', email, newPassword)
  await a.restart()
  assert.equal((await status(a)).unlocked, true)
  checks.push('找回邮件与登录密码重置使另一端会话失效；重新登录后保留本机解锁与条目数据')

  phase('cleanup-synthetic-items')
  await toggle(a, false)
  await toggle(b, false)
  await a.call('profile.delete', { id: profile.id })
  await a.call('vault.delete', { id: vault.id })
  await a.call('snippet.delete', { id: snippet.id })
  await a.call('group.delete', { id: group.id })
  await a.call('group.delete', { id: offline.id })
  await toggle(a, true)
  await a.call('sync.now')
  await settled(a)
  await toggle(b, true)
  await b.call('sync.now')
  await settled(b)
  assert.deepEqual(await b.call('group.list'), [])
  await toggle(a, false)
  await toggle(b, false)
  return {
    passed: true,
    resumed: Boolean(options.resume),
    registrationPerformed: !options.resume,
    checks,
    realBackend: true,
    mailVerification: verificationPerformed,
    mailPasswordReset: true,
    independentDirectories: 2,
    realSse: true,
    realKeyRotation: true,
    logicalCloudItemsAfterCleanup: 0,
    clientFaultInjection: ['me401', 'lostPushResponse', 'lostRefreshResponse'],
    remaining: [
      '服务端游标保留过期/配额耗尽/限流',
      '实际 HTTPS/代理断链',
      '其他目标平台',
      '真实系统密钥库',
      '8 小时运行',
    ],
  }
}
