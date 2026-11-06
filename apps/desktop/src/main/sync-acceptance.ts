import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { lstatSync, realpathSync, readdirSync, mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ACCOUNT_SERVER, DesktopError, failureOf, offlineWorkspace } from '@eizhu/contracts'
import type { WorkspaceIdentity } from '@eizhu/contracts'
import { loadDeviceKey } from '@eizhu/core/runtime/device-key'
import { RuntimeHost } from './runtime-host.ts'
import { accountHttp } from './account-network.ts'
import { syncEventStream, readSyncEvents } from './sync-events.ts'
import { SseHints } from '@eizhu/core/sync/sse'
import type { Transport } from '@eizhu/core/archive/network'
import type { EventStream } from '@eizhu/core/sync/service'
import { acceptLiveSync } from '@eizhu/core/testing/live-sync'
import type { LiveActor } from '@eizhu/core/testing/live-sync'
import type { AccountFixture } from './account-fixture-server.ts'
import { cloneAcceptanceProfile } from '@eizhu/core/testing/acceptance-profile'

declare const __EIZHU_VERSION__: string
const root = process.argv.find((v) => v.startsWith('--acceptance-root='))?.slice(18)
const synthetic = process.argv.includes('--synthetic')
const local = process.argv.includes('--local')
const live = process.argv.includes('--live')
const mode = synthetic ? 'synthetic' : local ? 'local' : 'live'
const target = local ? 'http://127.0.0.1:8080/' : ACCOUNT_SERVER
const resetExisting = process.argv.includes('--reset-existing-account')
if (!root || Number(synthetic) + Number(local) + Number(live) !== 1)
  throw new Error('Explicit isolated acceptance mode required')
if (resetExisting && !local)
  throw new Error('Existing account recovery is restricted to localhost acceptance')
if (
  lstatSync(root).isSymbolicLink() ||
  !realpathSync(root).startsWith(realpathSync(tmpdir()) + sep) ||
  readdirSync(root).length
)
  throw new Error('Acceptance root must be a fresh empty temporary directory')
process.umask(0o077)
mkdirSync(join(root, 'chromium'), { recursive: true, mode: 0o700 })
app.setPath('userData', root)
app.setPath('sessionData', join(root, 'chromium'))
app.setName('eizhu')
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
const previousRawMode = process.stdin.isRaw
if (process.stdin.isTTY) process.stdin.setRawMode(true)
const input = createInterface({ input: process.stdin, terminal: false })
const inputs: string[] = []
let take: ((value: string) => void) | undefined
let rejectInput: ((error: Error) => void) | undefined
let inputEnded = false
const inputClosed = () =>
  new DesktopError({ code: 'ACCEPTANCE_INPUT_CLOSED', message: '验证码输入已关闭，隔离数据已保留' })
input.on('close', () => {
  inputEnded = true
  rejectInput?.(inputClosed())
  rejectInput = undefined
  take = undefined
})
const closeInput = () => {
  input.close()
  if (process.stdin.isTTY) process.stdin.setRawMode(previousRawMode ?? false)
}
process.once('exit', () => {
  if (process.stdin.isTTY) process.stdin.setRawMode(previousRawMode ?? false)
})
input.on('line', (line) => {
  try {
    const value = JSON.parse(line) as { code?: string; action?: string }
    const code = value.action === 'resend' ? 'resend' : value.code
    if (!code || (!/^\d{6}$/.test(code) && code !== 'resend')) throw new Error()
    if (take) {
      const done = take
      take = undefined
      rejectInput = undefined
      done(code)
    } else inputs.push(code)
  } catch {
    output({ event: 'input_invalid', message: '请输入 JSON 格式的六位验证码，或 resend 操作' })
  }
})
const getCode = async (kind: 'verify' | 'reset') => {
  if (synthetic) return kind === 'verify' ? '123456' : '654321'
  output({
    event: 'input_required',
    kind,
    message: kind === 'verify' ? '请输入验证邮件中的六位验证码' : '请输入找回邮件中的六位验证码',
  })
  if (inputEnded && !inputs.length) throw inputClosed()
  return (
    inputs.shift() ??
    new Promise<string>((resolve, reject) => {
      take = resolve
      rejectInput = reject
    })
  )
}
let fixture: AccountFixture | undefined
const actors: Actor[] = []
let currentPhase = 'startup'
let finishing = false
async function finish(code: number) {
  if (finishing) return
  finishing = true
  closeInput()
  const closed = await Promise.allSettled([
    ...actors.map((actor) => actor.close()),
    ...(fixture ? [fixture.close()] : []),
  ])
  if (closed.some((result) => result.status === 'rejected')) {
    output({ event: 'shutdown_failed', message: '验收资源未能正常释放' })
    code = 1
  }
  app.exit(code)
}
process.stdin.on('data', (bytes: Buffer) => {
  if (bytes.includes(3)) void finish(130)
})
process.once('SIGINT', () => void finish(130))
process.once('SIGTERM', () => void finish(143))
const protector = {
  available: () => false,
  wrap: () => {
    throw new Error()
  },
  unwrap: () => {
    throw new Error()
  },
  restrict: async (path: string) => {
    if (process.platform === 'win32')
      await promisify(execFile)(
        'icacls.exe',
        [path, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:F`],
        { windowsHide: true },
      )
    else await chmod(path, 0o600)
  },
}
class Actor implements LiveActor {
  private host!: RuntimeHost
  private key!: Buffer
  private generation = 0
  private directory: string
  private label: string
  private oldRefresh?: string
  private responses: Array<{ path: string; method: string; status: number }> = []
  events = { opened: 0, closed: 0, hints: 0 }
  faults = {
    forceMe401: false,
    dropRefresh: false,
    dropPush: false,
    pushCount: 0,
    pushHashes: [] as string[],
    refreshCount: 0,
    revokeOldRefresh: async () => {
      if (!this.oldRefresh) return false
      const body = Buffer.from(JSON.stringify({ refreshToken: this.oldRefresh }))
      this.oldRefresh = undefined
      try {
        const response = await this.base(
          {
            url: new URL('api/auth/refresh', ACCOUNT_SERVER).href,
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body,
          },
          AbortSignal.timeout(20000),
        )
        try {
          return response.status === 401
        } finally {
          response.body.fill(0)
        }
      } finally {
        body.fill(0)
      }
    },
  }
  private base: Transport
  private stream: EventStream
  constructor(label: string) {
    this.label = label
    this.directory = join(root!, label)
    this.base =
      fixture?.transport ??
      (local
        ? (request, signal) => {
            const source = new URL(request.url)
            return accountHttp(
              { ...request, url: new URL(source.pathname + source.search, target).href },
              signal,
            )
          }
        : accountHttp)
    this.stream =
      fixture?.events ??
      (local
        ? (authorization, signal, consume) =>
            readSyncEvents(authorization, signal, consume, new URL('api/sync/v2/events', target).href)
        : syncEventStream)
    actors.push(this)
  }
  private transport: Transport = async (request, signal) => {
    const path = new URL(request.url).pathname
    if (path === '/api/auth/me' && this.faults.forceMe401) {
      this.faults.forceMe401 = false
      return { status: 401, headers: {}, body: Buffer.from('{"code":"UNAUTHENTICATED"}') }
    }
    if (path === '/api/auth/refresh') {
      this.faults.refreshCount++
      this.oldRefresh = JSON.parse(Buffer.from(request.body!).toString()).refreshToken
    }
    if (path === '/api/auth/logout')
      this.oldRefresh = JSON.parse(Buffer.from(request.body!).toString()).refreshToken
    if (path === '/api/sync/v2/push') {
      this.faults.pushCount++
      this.faults.pushHashes.push(createHash('sha256').update(request.body!).digest('hex'))
    }
    const response = await this.base(request, signal)
    this.responses.push({ path, method: request.method, status: response.status })
    if (this.responses.length > 128) this.responses.shift()
    if (
      response.status >= 200 &&
      response.status < 300 &&
      ((path === '/api/auth/refresh' && this.faults.dropRefresh) ||
        (path === '/api/sync/v2/push' && this.faults.dropPush))
    ) {
      this.faults.dropRefresh = false
      this.faults.dropPush = false
      response.body.fill(0)
      throw new Error('Acceptance client discarded committed response')
    }
    return response
  }
  private eventsTransport: EventStream = async (authorization, signal, consume) => {
    this.events.opened++
    const parser = new SseHints(() => this.events.hints++)
    try {
      await this.stream(authorization, signal, async (bytes) => {
        parser.feed(bytes)
        await consume(bytes)
      })
    } finally {
      this.events.closed++
    }
  }
  async start(workspace?: WorkspaceIdentity) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    this.key = (await loadDeviceKey(this.directory, protector)).key
    this.host = new RuntimeHost(
      this.directory,
      __dirname,
      ++this.generation,
      () => output({ event: 'runtime_failed', actor: this.label }),
      this.key,
      workspace,
      this.transport,
      this.eventsTransport,
    )
    await this.host.start()
  }
  call<T>(operation: string, value?: unknown): Promise<T> {
    return this.host.call<T>(operation, value)
  }
  async login(
    operation: 'account.register' | 'account.login',
    email: string,
    password: string,
    ticket?: string,
  ) {
    const result = await this.call<{ workspace: WorkspaceIdentity }>('account.authenticate', {
      operation,
      input: { email, password, ...(ticket ? { ticket } : {}) },
    })
    if (result.workspace.id !== this.host.workspace.id) {
      await this.host.close()
      this.key.fill(0)
      await this.start(result.workspace)
      await this.call('account.commitTransition', { target: result.workspace })
    }
  }
  async logout() {
    const previous = this.host.workspace
    await this.call('account.prepareLogout')
    await this.host.close()
    this.key.fill(0)
    await this.start(offlineWorkspace)
    await this.call('account.commitTransition', { target: offlineWorkspace, logoutSource: previous })
  }
  async restart() {
    await this.host.close()
    this.key.fill(0)
    await this.start()
  }
  async close() {
    await this.host?.close()
    this.key?.fill(0)
  }
  diagnostics() {
    return {
      actor: this.label,
      generation: this.generation,
      events: this.events,
      pushCount: this.faults.pushCount,
      refreshCount: this.faults.refreshCount,
      pushHashes: this.faults.pushHashes,
      responses: this.responses,
    }
  }
}
async function main() {
  await app.whenReady()
  if (synthetic) {
    const { createAccountFixture } = await import('./account-fixture-server.ts')
    fixture = await createAccountFixture()
  }
  const emailPath = process.argv.find((v) => v.startsWith('--email-file='))?.slice(13)
  const email = synthetic
    ? 'acceptance@example.invalid'
    : z
        .email()
        .max(255)
        .parse((await readFile(emailPath!, 'utf8')).trim())
  const resumeProfile = process.argv.find((v) => v.startsWith('--resume-profile='))?.slice(17)
  if (resumeProfile && resetExisting) throw new Error('Choose either profile resume or account recovery')
  if (resumeProfile && synthetic) throw new Error('合成模式不能恢复真实账号目录')
  const resumedFrom = resumeProfile
    ? await cloneAcceptanceProfile(resumeProfile, root!, mode === 'local' ? 'local' : 'live')
    : undefined
  const a = new Actor('device-a'),
    b = new Actor('device-b')
  await a.start()
  await b.start()
  const startedAt = new Date().toISOString()
  output({
    event: 'started',
    mode,
    target: synthetic ? 'local protocol fixture' : target,
    root,
  })
  const result = await acceptLiveSync(
    a,
    b,
    email,
    getCode,
    (phase) => {
      currentPhase = phase
      output({ event: 'phase', phase })
    },
    { resume: Boolean(resumedFrom), resetExisting },
  )
  const report = {
    ...result,
    resumedFrom,
    synthetic,
    mode,
    target: synthetic ? 'local protocol fixture' : target,
    productionBackend: live,
    realBackend: !synthetic,
    mailVerification: !synthetic && result.mailVerification,
    mailPasswordReset: !synthetic && result.mailPasswordReset,
    realSse: !synthetic && result.realSse,
    realKeyRotation: !synthetic && result.realKeyRotation,
    version: __EIZHU_VERSION__,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    keyMode: 'restricted-file',
    startedAt,
    verifiedAt: new Date().toISOString(),
    clients: actors.map((actor) => actor.diagnostics()),
  }
  await writeFile(join(root!, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  output({ event: 'passed', report: join(root!, 'acceptance.json'), mode })
}
main().then(
  () => finish(0),
  async (error) => {
    const failure = failureOf(error)
    const report = {
      passed: false,
      synthetic,
      mode,
      target: synthetic ? 'local protocol fixture' : target,
      productionBackend: live,
      version: __EIZHU_VERSION__,
      platform: process.platform,
      arch: process.arch,
      phase: currentPhase,
      failedAt: new Date().toISOString(),
      error: { code: failure.code, message: failure.message },
      clients: actors.map((actor) => actor.diagnostics()),
    }
    await writeFile(join(root!, 'failure.json'), JSON.stringify(report, null, 2) + '\n', {
      mode: 0o600,
    }).catch(() => output({ event: 'failure_report_unavailable' }))
    output({ event: 'failed', error: report.error, report: join(root!, 'failure.json') })
    await finish(1)
  },
)
