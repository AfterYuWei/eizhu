import { spawn, execFile } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdtemp, mkdir, chmod, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, isAbsolute, delimiter, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import { aiCliSchema, aiToolNameSchema, DesktopError, fail, failureOf } from '@eizhu/contracts'
import type { AiCli } from '@eizhu/contracts'
import type { AgentExternal } from '@eizhu/core/agent/service'

const exec = promisify(execFile)
const names = { codex: 'codex', claude: 'claude', deepseek: 'dsh' } as const
const frameSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
    type: z.string().optional(),
  })
  .passthrough()
/** One owned child, bounded NDJSON frames and explicit exit acknowledgement. */
export class AgentProcess {
  child: ChildProcessWithoutNullStreams
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }
  >()
  private buffer = ''
  private stopped?: Promise<void>
  private exited: Promise<void>
  onMessage: (frame: z.infer<typeof frameSchema>) => void = () => {}
  onFailure: (error: unknown) => void = () => {}
  constructor(path: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(path, args, {
      cwd,
      env,
      stdio: 'pipe',
      windowsHide: true,
      detached: process.platform !== 'win32',
      shell: false,
    })
    this.exited = new Promise((resolve) =>
      this.child.once('close', () => {
        resolve()
        this.fail(new Error('Agent进程已退出'))
      }),
    )
    this.child.once('error', () => this.fail(new Error('Agent无法启动，请检查可执行路径和安装版本')))
    this.child.stdin.on('error', () => this.fail(new Error('Agent控制通道已关闭')))
    this.child.stderr.on('data', () => {
      /* Native stderr may contain credentials; it is deliberately not logged. */
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > 1048576) {
        this.fail(new Error('Agent协议数据超过上限'))
        void this.close()
        return
      }
      let end: number
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 1)
        if (!line.trim()) continue
        try {
          const f = frameSchema.parse(JSON.parse(line)),
            p = f.id !== undefined && !f.method ? this.pending.get(String(f.id)) : undefined
          if (p) {
            this.pending.delete(String(f.id))
            clearTimeout(p.timer)
            if (f.error) p.reject(new Error('Agent请求被拒绝或协议不兼容'))
            else p.resolve(f.result)
          } else this.onMessage(f)
        } catch {
          this.fail(new Error('Agent未返回有效JSON协议，请检查CLI版本'))
          void this.close()
        }
      }
    })
  }
  send(value: unknown) {
    if (!this.child.stdin.writable) fail('AI_AGENT_CLOSED', 'Agent进程已关闭')
    this.child.stdin.write(JSON.stringify(value) + '\n')
  }
  request(method: string, params: unknown, timeout = 30000): Promise<unknown> {
    if (this.pending.size >= 32) fail('AI_BUSY', 'Agent控制请求过多')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Agent控制请求超时'))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }
  private fail(error: unknown) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(error)
    }
    this.pending.clear()
    this.onFailure(error)
  }
  close(): Promise<void> {
    this.stopped ??= (async () => {
      this.child.stdin.end()
      const signal = (name: NodeJS.Signals) => {
        try {
          if (this.child.pid && process.platform !== 'win32') process.kill(-this.child.pid, name)
          else this.child.kill(name)
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
        }
      }
      if (this.child.exitCode === null && this.child.signalCode === null) signal('SIGTERM')
      let timer: NodeJS.Timeout | undefined
      await Promise.race([
        this.exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2000)
        }),
      ])
      clearTimeout(timer)
      if (this.child.exitCode === null && this.child.signalCode === null) {
        signal('SIGKILL')
        await this.exited
      }
    })()
    return this.stopped
  }
}
export class CliAgentHost implements AgentExternal {
  private directory: string
  private stateRoot: string
  private active = new Set<AbortController>()
  private drains = new Map<AbortController, Promise<void>>()
  constructor(directory: string, stateRoot: string) {
    this.directory = directory
    this.stateRoot = stateRoot
  }
  private async resolve(cli: AiCli) {
    const name = names[cli.kind],
      candidate = cli.path || name
    if (isAbsolute(candidate)) {
      await access(candidate, constants.X_OK)
      return candidate
    }
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const path = join(dir, candidate)
      try {
        await access(path, constants.X_OK)
        return path
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && ['ENOENT', 'EACCES'].includes(String(error.code))))
          throw error
      }
    }
    fail('AI_CLI_MISSING', '未找到' + name + '，请先安装并配置可执行路径')
  }
  async status(clis: AiCli[]) {
    return Promise.all(
      (['codex', 'claude', 'deepseek'] as const).map(async (kind) => {
        const cli = clis.find((c) => c.kind === kind) ?? { kind, path: '', model: '' }
        try {
          const path = await this.resolve(cli)
          const { stdout } = await exec(path, ['--version'], {
            timeout: 10000,
            maxBuffer: 65536,
            windowsHide: true,
          })
          return { kind, path, available: true, message: stdout.trim().slice(0, 512) }
        } catch (error) {
          return {
            kind,
            path: cli.path,
            available: false,
            message:
              failureOf(error).code === 'INTERNAL' ? '未找到可用CLI或版本检查失败' : failureOf(error).message,
          }
        }
      }),
    )
  }
  async run(
    raw: Parameters<AgentExternal['run']>[0],
    signal: AbortSignal,
    onText: Parameters<AgentExternal['run']>[2],
    onTool: Parameters<AgentExternal['run']>[3],
    onRevoke?: () => void,
  ) {
    const controller = new AbortController()
    this.active.add(controller)
    let drained!: () => void
    this.drains.set(
      controller,
      new Promise<void>((resolve) => {
        drained = resolve
      }),
    )
    try {
      return await this.runOwned(raw, signal, onText, onTool, controller, onRevoke)
    } catch (error) {
      if (error instanceof DesktopError) throw error
      throw new DesktopError({
        code: signal.aborted ? 'CANCELLED' : 'AI_CLI_INCOMPATIBLE',
        message: signal.aborted
          ? 'Agent已停止'
          : 'Agent启动或协议失败，请检查CLI版本、原生登录和模型配置；所需工具限制必须受支持',
      })
    } finally {
      this.active.delete(controller)
      this.drains.delete(controller)
      drained()
    }
  }
  private async runOwned(
    raw: Parameters<AgentExternal['run']>[0],
    signal: AbortSignal,
    onText: Parameters<AgentExternal['run']>[2],
    onTool: Parameters<AgentExternal['run']>[3],
    controller: AbortController,
    onRevoke?: () => void,
  ) {
    const input = { ...raw, cli: aiCliSchema.parse(raw.cli) },
      path = await this.resolve(input.cli)
    const combined = AbortSignal.any([signal, controller.signal])
    const cwd = join(this.stateRoot, 'agent-workspaces', input.conversationId)
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    const temp = await mkdtemp(join(tmpdir(), 'eizhu-agent-'))
    const socketPath =
      process.platform === 'win32' ? '\\\\.\\pipe\\eizhu-agent-' + randomUUID() : join(temp, 'bridge.sock')
    const token = randomBytes(32).toString('hex'),
      sockets = new Set<Socket>()
    let chain: Promise<unknown> = Promise.resolve(),
      toolCount = 0,
      open = true
    const server = createServer((socket) => {
      if (sockets.size >= 4) {
        socket.destroy()
        return
      }
      sockets.add(socket)
      let buffer = '',
        busy = false,
        admitted = false
      socket.once('close', () => {
        sockets.delete(socket)
        if (admitted && busy && open && !combined.aborted) controller.abort()
      })
      socket.setEncoding('utf8')
      socket.on('error', () => socket.destroy())
      socket.on('data', (chunk: string) => {
        buffer += chunk
        if (buffer.length > 524288 || busy) {
          socket.destroy()
          return
        }
        const end = buffer.indexOf('\n')
        if (end < 0) return
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        busy = true
        try {
          const d = z
            .strictObject({
              token: z.string().length(64),
              id: z.string(),
              name: aiToolNameSchema,
              args: z.unknown(),
            })
            .parse(JSON.parse(line))
          if (!timingSafeEqual(Buffer.from(d.token), Buffer.from(token)) || !open || combined.aborted)
            throw new Error('Invalid scope')
          admitted = true
          if (++toolCount > 32) throw new Error('Tool step limit')
          chain = chain
            .catch(() => undefined)
            .then(async () => {
              if (!open || combined.aborted) fail('CANCELLED', 'Agent已停止')
              const result = await onTool(d.name, d.args)
              busy = false
              if (!socket.destroyed) socket.end(JSON.stringify({ id: d.id, result }) + '\n')
            })
            .catch((error) => {
              busy = false
              if (!socket.destroyed) socket.end(JSON.stringify({ id: d.id, error: failureOf(error) }) + '\n')
            })
        } catch {
          socket.destroy()
        }
      })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, resolve)
      })
      if (process.platform !== 'win32') await chmod(socketPath, 0o600)
    } catch (error) {
      server.close()
      await rm(temp, { recursive: true, force: true })
      throw error
    }
    const mcp = {
      command: process.execPath,
      args: [join(this.directory, 'ai-mcp.cjs')],
      env: { ELECTRON_RUN_AS_NODE: '1', EIZHU_AGENT_SOCKET: socketPath, EIZHU_AGENT_TOKEN: token },
    }
    let child: AgentProcess | undefined
    const abort = () => {
      onRevoke?.()
      controller.abort()
      if (child) void child.close()
    }
    combined.addEventListener('abort', abort, { once: true })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    let text = ''
    const append = (delta: string) => {
      text += delta
      if (text.length > 196608) fail('AI_PROTOCOL', 'Agent回复超过上限')
      onText(text)
    }
    try {
      combined.throwIfAborted()
      const nativeSession = await cliDrivers[input.cli.kind]({
        path,
        cwd,
        env,
        input,
        mcp,
        temp,
        append,
        controller,
        launch: (args, childEnv) => {
          child = new AgentProcess(path, args, cwd, childEnv)
          return child
        },
      })
      await chain
      combined.throwIfAborted()
      return { nativeSession }
    } catch (error) {
      abort()
      throw error
    } finally {
      open = false
      combined.removeEventListener('abort', abort)
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      try {
        await child?.close()
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    }
  }
  async close() {
    for (const c of this.active) c.abort()
    await Promise.allSettled([...this.drains.values()])
  }
}

interface CliDriverContext {
  path: string
  cwd: string
  env: NodeJS.ProcessEnv
  input: Parameters<AgentExternal['run']>[0]
  mcp: { command: string; args: string[]; env: Record<string, string> }
  temp: string
  append: (text: string) => void
  controller: AbortController
  launch: (args: string[], env: NodeJS.ProcessEnv) => AgentProcess
}
export const cliDrivers = { codex: codexDriver, claude: claudeDriver, deepseek: deepseekDriver }
async function codexDriver(ctx: CliDriverContext): Promise<string> {
  const { path, cwd, env, input, mcp, append, controller, launch } = ctx
  // Disable existing MCP servers using per-process overrides, never edit global config.
  const listed = await exec(path, ['mcp', 'list', '--json'], {
    timeout: 10000,
    maxBuffer: 524288,
    env,
    windowsHide: true,
  })
  const old = z.array(z.object({ name: z.string() })).parse(JSON.parse(listed.stdout))
  const config: Record<string, unknown> = {
    'features.shell_tool': false,
    'features.goals': false,
    'features.browser_use': false,
    'features.browser_use_external': false,
    'features.browser_use_full_cdp_access': false,
    'features.computer_use': false,
    'features.image_generation': false,
    'features.sleep_tool': false,
    'features.request_permissions_tool': false,
    'features.default_mode_request_user_input': false,
    'features.skill_search': false,
    'features.skill_mcp_dependency_install': false,
    'features.memories': false,
    'features.tool_suggest': false,
    'features.hooks': false,
    'features.plugins': false,
    'features.apps': false,
    'features.multi_agent': false,
    'features.view_image': false,
    'features.code_mode': false,
    'features.code_mode_host': false,
    web_search: 'disabled',
    project_doc_max_bytes: 0,
  }
  for (const s of old) {
    if (!/^[A-Za-z0-9_-]+$/.test(s.name))
      fail('AI_CLI_INCOMPATIBLE', 'Codex现有MCP配置无法安全覆盖，请调整服务器名称')
    config['mcp_servers.' + s.name + '.enabled'] = false
    // CLI nested overrides replace the native server table; keep a valid inert transport.
    config['mcp_servers.' + s.name + '.command'] = process.execPath
    config['mcp_servers.' + s.name + '.args'] = []
  }
  config['mcp_servers.eizhu.command'] = mcp.command
  config['mcp_servers.eizhu.args'] = mcp.args
  config['mcp_servers.eizhu.enabled'] = true
  config['mcp_servers.eizhu.required'] = true
  config['mcp_servers.eizhu.tool_timeout_sec'] = 600
  config['mcp_servers.eizhu.default_tools_approval_mode'] = 'approve'
  for (const [key, value] of Object.entries(mcp.env)) config['mcp_servers.eizhu.env.' + key] = value
  const child = launch(
    [
      'app-server',
      '--listen',
      'stdio://',
      ...Object.entries(config).flatMap(([k, v]) => ['-c', k + '=' + JSON.stringify(v)]),
    ],
    env,
  )
  let finish!: (v: void) => void, reject!: (e: unknown) => void
  const completed = new Promise<void>((r, j) => {
    finish = r
    reject = j
  })
  // Initialization may fail before the turn waiter is awaited.
  void completed.catch(() => undefined)
  child.onFailure = reject
  child.onMessage = (f) => {
    const p = z.record(z.string(), z.unknown()).parse(f.params ?? {})
    if (f.id !== undefined && f.method) {
      if (
        f.method === 'item/commandExecution/requestApproval' ||
        f.method === 'item/fileChange/requestApproval'
      )
        child!.send({ id: f.id, result: { decision: 'decline' } })
      else child!.send({ id: f.id, error: { code: -32601, message: '当前嵌入仅允许eizhu远端工具' } })
    } else if (f.method === 'item/agentMessage/delta') append(z.string().parse(p.delta))
    else if (f.method === 'turn/completed') {
      const turn = z.object({ turn: z.object({ status: z.string() }) }).parse(p).turn
      if (turn.status === 'completed') finish()
      else reject(new Error('Codex任务未完成'))
    } else if (f.method === 'item/started') {
      const item = z.object({ item: z.object({ type: z.string() }) }).parse(p).item
      if (['commandExecution', 'fileChange', 'dynamicToolCall'].includes(item.type)) {
        controller.abort()
        reject(new Error('Codex尝试使用本机工具，任务已拒绝'))
      }
    }
  }
  await child.request('initialize', {
    clientInfo: { name: 'eizhu', title: 'eizhu', version: '2' },
    capabilities: { experimentalApi: false },
  })
  child.send({ method: 'initialized' })
  const params = {
    cwd,
    model: input.cli.model || undefined,
    sandbox: 'read-only',
    approvalPolicy: 'untrusted',
    developerInstructions: '仅使用eizhu MCP工具操作已授权远端。禁止本机工具。',
    config: {},
  }
  const thread = z
    .object({ thread: z.object({ id: z.string() }) })
    .parse(
      await child.request(
        input.nativeSession ? 'thread/resume' : 'thread/start',
        input.nativeSession ? { ...params, threadId: input.nativeSession } : params,
      ),
    )
  const nativeSession = thread.thread.id
  await child.request('turn/start', {
    threadId: nativeSession,
    input: [{ type: 'text', text: input.prompt }],
  })
  await completed

  return nativeSession
}
async function claudeDriver(ctx: CliDriverContext): Promise<string> {
  const { env, input, mcp, append, launch } = ctx
  let nativeSession = input.nativeSession ?? randomUUID(),
    hasText = false
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--bare',
    '--setting-sources',
    '',
    '--settings',
    JSON.stringify({ disableAllHooks: true, disableCommandPluginSources: true, autoMemoryEnabled: false }),
    '--disable-slash-commands',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: { eizhu: { type: 'stdio', ...mcp } } }),
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    'mcp__eizhu__*',
  ]
  if (input.cli.model) args.push('--model', input.cli.model)
  if (input.nativeSession) args.push('--resume', input.nativeSession)
  const child = launch(args, { ...env, MCP_TOOL_TIMEOUT: '600000' })
  await new Promise<void>((resolve, reject) => {
    child!.onFailure = reject
    child!.onMessage = (f) => {
      if (f.type === 'system' && typeof f.session_id === 'string') nativeSession = f.session_id
      if (f.type === 'stream_event') {
        const e = z
          .object({
            type: z.string(),
            delta: z.object({ type: z.string(), text: z.string().optional() }).optional(),
          })
          .parse(f.event)
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          hasText = true
          append(e.delta.text ?? '')
        }
      }
      if (f.type === 'result') {
        if (f.is_error === true) reject(new Error('Claude Code任务失败，请检查CLI登录与模型配置'))
        else {
          if (!hasText && typeof f.result === 'string') append(f.result)
          resolve()
        }
      }
    }
    child!.send({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: input.prompt }] },
    })
  })

  return nativeSession
}
async function deepseekDriver(ctx: CliDriverContext): Promise<string> {
  const { cwd, env, input, mcp, temp, append, launch } = ctx
  const nativeSession = input.nativeSession ?? randomUUID()
  let hasText = false,
    failed = false
  if (!input.cli.model) fail('AI_CONFIG', '请在DeepSeek Harness设置中填写原生模型名')
  const patch = join(temp, 'eizhu.yml')
  const configuredHome = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const nativeHome =
    configuredHome === '~'
      ? homedir()
      : configuredHome.startsWith('~/')
        ? join(homedir(), configuredHome.slice(2))
        : resolve(configuredHome)
  const runtimeHome = join(temp, 'deepseek-home')
  await mkdir(runtimeHome, { mode: 0o700 })
  // sdk-minimal has an explicit composition; remove all native filesystem/shell tools.
  await writeFile(
    patch,
    [
      '- id: tool-fs\n  disabled: true',
      '- id: tool-working-directory\n  disabled: true',
      '- id: persistent-bash\n  disabled: true',
      '- id: persistent-pwsh\n  disabled: true',
      '- id: sessions\n  config:\n    root: ' +
        JSON.stringify(join(nativeHome, 'sessions')) +
        '\n    compression: none',
      '- insert:',
      '    - id: eizhu-mcp',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: eizhu',
      '        transport: stdio',
      '        command: ' + JSON.stringify(mcp.command),
      '        args: ' + JSON.stringify(mcp.args),
      '        env: ' + JSON.stringify(mcp.env),
      '        toolCallTimeoutMs: 600000',
      '        failOnStartupError: true',
    ].join('\n'),
    { mode: 0o600 },
  )
  const child = launch(['--profile', 'sdk-minimal', '--patch', patch], { ...env, DSH_HOME: runtimeHome })
  child.onMessage = (f) => {
    const p = z.record(z.string(), z.unknown()).parse(f.params ?? {})
    if (f.method === 'approval/request' && f.id !== undefined)
      child!.send({
        jsonrpc: '2.0',
        id: f.id,
        result: {
          outcome:
            typeof p.toolName === 'string' && p.toolName.startsWith('mcp__eizhu__')
              ? 'allowed-once'
              : 'rejected',
        },
      })
    else if (f.method === 'user-question/ask' && f.id !== undefined)
      child!.send({ jsonrpc: '2.0', id: f.id, result: { cancelled: true } })
    else if (f.method === 'session.event' && p.sessionId === nativeSession) {
      const e = z.record(z.string(), z.unknown()).parse(p.event)
      if (e.type === 'assistant/message') {
        const message = z
          .object({
            message: z.object({
              content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
            }),
          })
          .parse(e.data).message
        const text = message.content
          .filter((v) => v.type === 'text')
          .map((v) => v.text ?? '')
          .join('')
        if (text) {
          append((hasText ? '\n\n' : '') + text)
          hasText = true
        }
      }
      if (e.type === 'turn/end') {
        const reason = z.object({ reason: z.object({ kind: z.string() }) }).parse(e.data).reason.kind
        failed = ['error', 'aborted'].includes(reason)
      }
    }
  }
  const initialized = z
    .object({ serverInfo: z.object({ name: z.literal('deepseek-harness-sdk-runtime') }) })
    .parse(
      await child.request('initialize', {
        cwd,
        provider: 'deepseek',
        model: input.cli.model,
        approvalRequests: true,
        maxTokens: 8192,
      }),
    )
  if (!initialized.serverInfo) fail('AI_PROTOCOL', 'DeepSeek Harness版本不兼容')
  if (input.nativeSession) await child.request('session/resume', { sessionId: nativeSession })
  await child.request('session/prompt', {
    sessionId: nativeSession,
    contentBlocks: [{ type: 'text', text: input.prompt }],
  })
  await child.request('session/wait', { sessionId: nativeSession }, 3600000)
  if (failed) fail('AI_CLI_FAILED', 'DeepSeek Harness任务未完成')

  return nativeSession
}
