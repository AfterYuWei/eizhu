import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { AgentService } from './service.ts'
import type { AgentExternal, AgentSsh } from './service.ts'
import type { AiConversation } from '@eizhu/contracts'
import { aiConversationSchema, aiModelCatalogSchema, fail } from '@eizhu/contracts'
import { storedAiConfigSchema, storedAiConversationSchema } from './repository.ts'
import { modelFixture } from './model-fixture.ts'
import type { AiTransport } from './model.ts'
const command = (sessionId = 'a') => ({
  sessionId,
  command: 'printf hello',
  cwd: '/tmp',
  purpose: '检查',
  impact: '只读',
  timeoutSeconds: 60,
})
async function until(condition: () => boolean) {
  const deadline = Date.now() + 4000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await delay(5)
  }
}
function fixture(
  steps: Array<{ name: string; args: unknown } | null>,
  external?: AgentExternal,
  transportOverride?: AiTransport,
) {
  let config = storedAiConfigSchema.parse({
    providers: [
      {
        id: 'p',
        name: '测试',
        protocol: 'responses',
        endpoint: 'http://127.0.0.1/v1',
        model: 'fixture',
        contextWindow: 64000,
        apiKey: 'test-key',
      },
    ],
    clis: [],
    defaultBackend: { kind: 'custom', providerId: 'p', model: 'fixture' },
  })
  const records = new Map<string, unknown>(),
    bindings = new Map([
      ['a', {}],
      ['b', {}],
    ]),
    execs: string[] = [],
    stops: string[] = []
  let current: AiConversation | undefined,
    index = 0,
    writesFail = false,
    unknown = false,
    long = false,
    busy = false,
    partial = false
  const storage = async (raw: unknown) => {
    const d = raw as { kind: string; value?: unknown; id?: string }
    if (d.kind === 'config.read') return structuredClone(config)
    if (d.kind === 'config.write') {
      config = storedAiConfigSchema.parse(d.value)
      return
    }
    if (d.kind === 'save') {
      const s = storedAiConversationSchema.parse(d.value)
      if (writesFail && s.conversation.messages.some((m) => m.tool?.state === 'running'))
        throw new Error('disk failed')
      records.set(s.conversation.id, structuredClone(s))
      return
    }
    if (d.kind === 'read') return structuredClone(records.get(d.id!))
    if (d.kind === 'list')
      return [...records.values()].map((v) => storedAiConversationSchema.parse(v).conversation)
    if (d.kind === 'remove') records.delete(d.id!)
  }
  const ssh: AgentSsh = {
    agentTarget: async (sessionId) => ({
      binding: bindings.get(sessionId) ?? fail('NOT_FOUND', '连接不存在'),
      target: {
        profileId: sessionId,
        sessionId,
        host: sessionId + '.invalid',
        port: 22,
        username: 'test',
        cwd: '/tmp',
        system: 'Linux',
      },
    }),
    agentConnected: (id, b) => bindings.get(id) === b,
    agentReady: () => {
      if (busy) fail('AI_BUSY', '有未提交输入')
    },
    agentReadContext: () => ({
      content: 'terminal output',
      startLine: 0,
      endLine: 1,
      totalLines: 1,
      truncated: false,
    }),
    agentExecute: async (id, _b, _p, signal) => {
      ssh.agentReady(id, _b)
      assert.ok(
        [...records.values()].some((v) =>
          storedAiConversationSchema.parse(v).conversation.messages.some((m) => m.tool?.state === 'running'),
        ),
      )
      execs.push(id)
      if (long)
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else
            signal.addEventListener(
              'abort',
              () => {
                stops.push(id)
                resolve()
              },
              { once: true },
            )
        })
      return {
        status: unknown || signal.aborted ? 'unknown' : 'completed',
        stdout: 'hello',
        stderr: '',
        exitCode: unknown || signal.aborted ? null : 0,
        elapsedMs: 1,
        truncated: false,
        message: '',
      }
    },
  }
  const transport: AiTransport = async (_r, _s, consume) => {
    const step = steps[index++] ?? null
    await consume(
      Buffer.from(
        modelFixture(
          'responses',
          step ? '准备检查' : '已完成任务',
          step ? [{ id: 'call-' + index, name: step.name, args: step.args }] : [],
          !partial,
        ),
      ),
    )
  }
  const service = new AgentService(
    storage,
    ssh,
    transportOverride ?? transport,
    async () => '',
    { runtimeId: randomUUID(), workspaceId: 'offline', generation: 1 },
    (c) => {
      current = structuredClone(c)
    },
    undefined,
    external,
  )
  return {
    service,
    storage,
    ssh,
    transport,
    execs,
    stops,
    bindings,
    records,
    get modelSteps() {
      return index
    },
    get config() {
      return config
    },
    get current() {
      return current!
    },
    set failWrites(v: boolean) {
      writesFail = v
    },
    set unknown(v: boolean) {
      unknown = v
    },
    set long(v: boolean) {
      long = v
    },
    set busy(v: boolean) {
      busy = v
    },
    set partial(v: boolean) {
      partial = v
    },
    async open() {
      return aiConversationSchema.parse(await service.execute('ai.open', { sessionIds: ['a', 'b'] }, 1))
    },
    async send(id: string) {
      await service.execute('ai.send', { conversationId: id, text: '检查', attachments: [] }, 1)
    },
    async pending() {
      await until(() => current?.status === 'awaiting_confirmation')
      return current!.messages.findLast((m) => m.tool?.state === 'pending')!.tool!
    },
    async decide(id: string, decision: 'once' | 'conversation' | 'reject' = 'once') {
      const call = await this.pending()
      await service.execute(
        'ai.decide',
        { conversationId: id, callId: call.id, revision: current!.revision, decision },
        1,
      )
      return call
    },
  }
}
test('multi-session commands require approval; duplicate/window decisions cannot execute twice; final answer retained', async () => {
  const f = fixture([
    { name: 'terminal_execute', args: command('a') },
    { name: 'terminal_execute', args: command('b') },
    null,
  ])
  try {
    const c = await f.open()
    await f.send(c.id)
    const call = await f.pending()
    assert.equal(f.execs.length, 0)
    await assert.rejects(
      f.service.execute(
        'ai.decide',
        { conversationId: c.id, callId: call.id, revision: 1, decision: 'once' },
        2,
      ),
    )
    await f.decide(c.id)
    await assert.rejects(
      f.service.execute(
        'ai.decide',
        { conversationId: c.id, callId: call.id, revision: 1, decision: 'once' },
        1,
      ),
    )
    await f.pending()
    assert.deepEqual(f.execs, ['a'])
    await f.decide(c.id)
    await until(() => f.current.status === 'idle')
    assert.deepEqual(f.execs, ['a', 'b'])
    assert.equal(f.current.messages.at(-1)?.text, '已完成任务')
  } finally {
    await f.service.close()
  }
})
test('conversation grant is scoped to tool and connection instance', async () => {
  const f = fixture([
    { name: 'terminal_execute', args: command('a') },
    { name: 'terminal_execute', args: command('a') },
    { name: 'terminal_execute', args: command('b') },
    null,
  ])
  try {
    const c = await f.open()
    await f.send(c.id)
    await f.decide(c.id, 'conversation')
    await until(() => f.execs.length === 2 && f.current.status === 'awaiting_confirmation')
    assert.deepEqual(f.execs, ['a', 'a'])
    await f.decide(c.id)
    await until(() => f.current.status === 'idle')
  } finally {
    await f.service.close()
  }
})
test('observer permits structured reads and refuses arbitrary shell commands', async () => {
  const f = fixture([{ name: 'session_info', args: {} }, { name: 'terminal_execute', args: command() }, null])
  try {
    const c = await f.open()
    await f.service.execute('ai.permission', { conversationId: c.id, permission: 'observer' }, 1)
    await f.send(c.id)
    await until(() => f.current.status === 'idle')
    assert.equal(f.execs.length, 0)
    assert.ok(f.current.messages.some((m) => m.tool?.error.includes('观察')))
  } finally {
    await f.service.close()
  }
})
test('connection replacement and scope removal revoke pending approvals', async () => {
  const f = fixture([{ name: 'terminal_execute', args: command() }, null])
  try {
    const c = await f.open()
    await f.send(c.id)
    const call = await f.pending()
    f.bindings.set('a', {})
    await assert.rejects(
      f.service.execute(
        'ai.decide',
        { conversationId: c.id, callId: call.id, revision: f.current.revision, decision: 'once' },
        1,
      ),
    )
    assert.equal(f.execs.length, 0)
    await f.service.execute('ai.scope', { conversationId: c.id, sessionIds: ['b'] }, 1)
    assert.equal(f.current.messages.find((m) => m.tool?.id === call.id)?.tool?.state, 'expired')
  } finally {
    await f.service.close()
  }
})
test('interrupted model stream and failed durable checkpoint dispatch nothing', async () => {
  for (const mode of ['partial', 'disk'] as const) {
    const f = fixture([{ name: 'terminal_execute', args: command() }, null])
    try {
      const c = await f.open()
      if (mode === 'partial') f.partial = true
      await f.send(c.id)
      if (mode === 'disk') {
        await f.pending()
        f.failWrites = true
        await f.decide(c.id)
      }
      await until(() => ['error', 'idle', 'paused'].includes(f.current.status))
      assert.equal(f.execs.length, 0)
    } finally {
      f.failWrites = false
      await f.service.close()
    }
  }
})
test('unknown result and busy terminal pause instead of dispatching more commands', async () => {
  for (const mode of ['unknown', 'busy'] as const) {
    const f = fixture([
      { name: 'terminal_execute', args: command() },
      { name: 'terminal_execute', args: command('b') },
    ])
    try {
      const c = await f.open()
      f[mode] = true
      await f.send(c.id)
      await f.decide(c.id)
      await until(() => f.current.status === 'paused')
      assert.equal(f.execs.length, mode === 'busy' ? 0 : 1)
    } finally {
      await f.service.close()
    }
  }
})
test('Stop cancels every long task created by an external Agent', async () => {
  let started = false
  const external: AgentExternal = {
    status: async () => [],
    run: async (_input, signal, _text, tool) => {
      await tool('terminal_start', command('a'))
      await tool('terminal_start', command('b'))
      started = true
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { nativeSession: 'native-session' }
    },
  }
  const f = fixture([], external)
  f.long = true
  try {
    const c = await f.open()
    await f.service.execute('ai.backend', { conversationId: c.id, backend: { kind: 'codex', model: '' } }, 1)
    await f.service.execute('ai.permission', { conversationId: c.id, permission: 'auto' }, 1)
    await f.send(c.id)
    await until(() => started)
    await f.service.execute('ai.cancel', { conversationId: c.id }, 1)
    assert.deepEqual(f.stops.sort(), ['a', 'b'])
    assert.ok(f.current.jobs.every((j) => j.status === 'unknown'))
  } finally {
    await f.service.close()
  }
})
test('provider keys stay private and are not reused for a new endpoint', async () => {
  const f = fixture([])
  try {
    const publicSettings = await f.service.execute('ai.settings', undefined, 1)
    assert.ok(!JSON.stringify(publicSettings).includes('test-key'))
    await f.service.execute(
      'ai.configure',
      {
        id: 'p',
        name: 'new',
        protocol: 'chat',
        endpoint: 'https://other.invalid/v1',
        model: 'new',
        contextWindow: 64000,
        clearKey: false,
      },
      1,
    )
    assert.equal(f.config.providers[0].apiKey, '')
  } finally {
    await f.service.close()
  }
})
for (const protocol of ['responses', 'chat', 'anthropic'] as const)
  test(`${protocol}: model discovery accepts an unknown model while execution and saving still require it`, async () => {
    let requests = 0
    const f = fixture([], undefined, async (request, _signal, consume) => {
      requests++
      assert.equal(request.method, 'GET')
      assert.equal(request.url, 'http://127.0.0.1/v1/models')
      assert.equal(request.authorization, protocol === 'anthropic' ? '' : 'Bearer test-key')
      if (protocol === 'anthropic') assert.equal(request.headers?.['x-api-key'], 'test-key')
      await consume(Buffer.from(JSON.stringify({ data: [{ id: 'discovered', display_name: '发现的模型' }] })))
    })
    try {
      const input = {
        id: 'p',
        name: '测试',
        protocol,
        endpoint: 'http://127.0.0.1/v1',
        model: '',
        clearKey: false,
      }
      await f.service.execute('ai.configure', { ...input, model: 'fixture' }, 1)
      const catalog = aiModelCatalogSchema.parse(await f.service.execute('ai.discover', input, 1))
      assert.deepEqual(catalog.models, [{ id: 'discovered', name: '发现的模型' }])
      assert.equal(catalog.defaultModel, '')
      assert.deepEqual(f.config.providers[0].models, [])
      assert.deepEqual(await f.service.execute('ai.discover', { ...input, model: undefined }, 1), catalog)
      assert.equal(requests, 2)
      await assert.rejects(f.service.execute('ai.test', input, 1), { name: 'ZodError' })
      await assert.rejects(f.service.execute('ai.configure', input, 1), { name: 'ZodError' })
      assert.equal(requests, 2)
      assert.equal(f.config.providers[0].model, 'fixture')
      assert.equal(f.config.providers[0].apiKey, 'test-key')
      assert.equal(f.execs.length, 0)
    } finally {
      await f.service.close()
    }
  })
test('model discovery leaves the candidate pool, running Agent and unsaved key unchanged', async () => {
  const f = fixture([], undefined, async (request, _signal, consume) => {
    await consume(
      Buffer.from(
        request.method === 'GET'
          ? JSON.stringify({
              data:
                request.authorization === 'Bearer unsaved-draft-key'
                  ? [{ id: 'draft-only', name: '草稿模型' }]
                  : [{ id: 'other-model', name: '其他模型' }],
            })
          : modelFixture('responses', '', [
              { id: 'pending-call', name: 'terminal_execute', args: command() },
            ]),
      ),
    )
  })
  try {
    const models = [{ id: 'fixture', name: '用户选择的模型' }]
    await f.service.execute(
      'ai.configure',
      {
        id: 'p',
        name: '测试',
        protocol: 'responses',
        endpoint: 'http://127.0.0.1/v1',
        model: 'fixture',
        clearKey: false,
        models,
      },
      1,
    )
    const c = await f.open()
    await f.send(c.id)
    const pending = await f.pending()
    const input = {
      id: 'p',
      name: '测试',
      protocol: 'responses',
      endpoint: 'http://127.0.0.1/v1',
      model: '',
      clearKey: false,
    }
    await f.service.execute('ai.discover', input, 1)
    assert.deepEqual(f.config.providers[0].models, models)
    assert.equal(f.current.status, 'awaiting_confirmation')
    assert.equal(f.current.messages.find((m) => m.tool?.id === pending.id)?.tool?.state, 'pending')
    await f.service.execute('ai.discover', { ...input, apiKey: 'unsaved-draft-key' }, 1)
    assert.equal(f.config.providers[0].apiKey, 'test-key')
    assert.deepEqual(f.config.providers[0].models, models)
    await f.service.execute('ai.discover', { ...input, id: 'unsaved-provider' }, 1)
    assert.equal(f.config.providers.length, 1)
    assert.equal(f.execs.length, 0)
  } finally {
    await f.service.close()
  }
})
test('model discovery cannot overwrite candidate choices during configuration changes or failure', async () => {
  let release: (() => void) | undefined
  let broken = false
  const f = fixture([], undefined, async (_request, _signal, consume) => {
    if (broken) throw new Error('Discovery unavailable')
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await consume(Buffer.from(JSON.stringify({ data: [{ id: 'stale-model' }] })))
  })
  try {
    const input = {
      id: 'p',
      name: '测试',
      protocol: 'responses',
      endpoint: 'http://127.0.0.1/v1',
      model: '',
      clearKey: false,
    }
    const pending = f.service.execute('ai.discover', input, 1)
    await until(() => Boolean(release))
    const models = [{ id: 'new-model', name: '新模型' }]
    await f.service.execute(
      'ai.configure',
      { ...input, endpoint: 'https://new.invalid/v1', model: 'new-model', models },
      1,
    )
    release!()
    await pending
    assert.equal(f.config.providers[0].endpoint, 'https://new.invalid/v1')
    assert.deepEqual(f.config.providers[0].models, models)
    broken = true
    await assert.rejects(
      f.service.execute('ai.discover', { ...input, endpoint: 'https://new.invalid/v1' }, 1),
      /Discovery unavailable/,
    )
    assert.deepEqual(f.config.providers[0].models, models)
  } finally {
    release?.()
    await f.service.close()
  }
})
for (const change of [
  { endpoint: 'https://new.invalid/v1' },
  { protocol: 'chat' },
  { apiKey: 'rotated-key' },
])
  test(`candidate choices are retained for a model switch and ${Object.keys(change)[0]} changes`, async () => {
    const f = fixture([])
    try {
      const input = {
        id: 'p',
        name: '测试',
        protocol: 'responses',
        endpoint: 'http://127.0.0.1/v1',
        model: 'fixture',
        clearKey: false,
      }
      const models = [
        { id: 'fixture', name: '原模型' },
        { id: 'next-model', name: '下一模型' },
      ]
      await f.service.execute('ai.configure', { ...input, models }, 1)
      await f.service.execute('ai.configure', { ...input, model: 'next-model' }, 1)
      assert.deepEqual(f.config.providers[0].models, models)
      await f.service.execute('ai.configure', { ...input, ...change }, 1)
      assert.deepEqual(f.config.providers[0].models, models)
    } finally {
      await f.service.close()
    }
  })
for (const protocol of ['responses', 'chat', 'anthropic'] as const)
  for (const outcome of ['tool', 'text', 'empty', 'interrupted', 'invalid-tool', 'transport-error'] as const)
    test(`${protocol}: connection test uses automatic tool selection and handles ${outcome} honestly`, async () => {
      let requests = 0
      const f = fixture([], undefined, async (request, _signal, consume) => {
        requests++
        const body = JSON.parse(request.body!)
        assert.equal(body.tools.length, 1)
        assert.equal(body.tools[0].function?.name ?? body.tools[0].name, 'session_info')
        assert.ok(body.tool_choice == null || body.tool_choice === 'auto' || body.tool_choice.type === 'auto')
        if (outcome === 'transport-error') throw new Error('401 Unauthorized')
        const calls =
          outcome === 'tool' || outcome === 'interrupted'
            ? [{ id: 'test-call', name: 'session_info', args: {} }]
            : outcome === 'invalid-tool'
              ? [{ id: 'test-call', name: 'terminal_execute', args: command() }]
              : []
        await consume(
          Buffer.from(
            modelFixture(protocol, outcome === 'text' ? '连接正常' : '', calls, outcome !== 'interrupted'),
          ),
        )
      })
      try {
        const input = {
          id: 'p',
          name: '测试',
          protocol,
          endpoint: 'http://127.0.0.1/v1',
          model: 'fixture',
          clearKey: false,
        }
        const pending = f.service.execute('ai.test', input, 1)
        if (outcome === 'tool') {
          assert.deepEqual(await pending, { message: '连接与工具调用测试通过；未执行远端操作' })
        } else if (outcome === 'text') {
          assert.deepEqual(await pending, {
            message: '连接与模型回复正常；本次未返回工具调用，工具兼容性尚未验证',
          })
        } else await assert.rejects(pending)
        assert.equal(requests, 1)
        assert.equal(f.execs.length, 0)
        assert.equal(f.config.providers[0].model, 'fixture')
      } finally {
        await f.service.close()
      }
    })
test('backend switch preserves a handoff and expires pending operations', async () => {
  const f = fixture([{ name: 'terminal_execute', args: command() }, null])
  try {
    const c = await f.open()
    await f.send(c.id)
    await f.pending()
    await f.service.execute('ai.backend', { conversationId: c.id, backend: { kind: 'claude', model: '' } }, 1)
    assert.ok(f.current.summary.includes('检查'))
    assert.equal(f.current.backend.kind, 'claude')
    assert.equal(f.execs.length, 0)
  } finally {
    await f.service.close()
  }
})

test('native revocation immediately invalidates an outstanding approval before process cleanup', async () => {
  let revoke: (() => void) | undefined,
    cleanup: () => void = () => {}
  const external: AgentExternal = {
    status: async () => [],
    run: async (_input, _signal, _text, tool, onRevoke) => {
      revoke = onRevoke
      const call = tool('terminal_execute', command())
      await new Promise<void>((resolve) => {
        cleanup = resolve
      })
      await call
      throw new Error('native process exited')
    },
  }
  const f = fixture([], external)
  try {
    const c = await f.open()
    await f.service.execute('ai.backend', { conversationId: c.id, backend: { kind: 'codex', model: '' } }, 1)
    await f.send(c.id)
    const call = await f.pending()
    revoke!()
    await delay(0)
    await assert.rejects(
      f.service.execute(
        'ai.decide',
        { conversationId: c.id, callId: call.id, revision: f.current.revision, decision: 'once' },
        1,
      ),
    )
    assert.equal(f.execs.length, 0)
  } finally {
    cleanup()
    await f.service.close()
  }
})

test('large output handles page inside their conversation and persist separately from excerpts', async () => {
  let first: unknown, page: unknown, foreign: unknown
  const external: AgentExternal = {
    status: async () => [],
    run: async (_i, _s, _t, tool) => {
      first = await tool('terminal_read_context', { sessionId: 'a' })
      const handle = (first as { handle: string }).handle
      page = await tool('output_read', { handle, offset: 12000, maxChars: 100 })
      foreign = await tool('output_read', { handle: 'foreign-conversation-handle', offset: 0, maxChars: 100 })
      return { nativeSession: 'fixture' }
    },
  }
  const f = fixture([], external)
  f.ssh.agentReadContext = () => ({
    content: '大输出'.repeat(15000),
    startLine: 0,
    endLine: 1,
    totalLines: 1,
    truncated: false,
  })
  try {
    const c = await f.open()
    await f.service.execute('ai.backend', { conversationId: c.id, backend: { kind: 'codex', model: '' } }, 1)
    await f.send(c.id)
    await until(() => f.current.status === 'idle')
    assert.ok((first as { handle: string }).handle)
    assert.equal((page as { content: string }).content.length, 100)
    assert.ok((foreign as { error: string }).error)
    const stored = storedAiConversationSchema.parse(f.records.get(c.id))
    assert.equal(Object.keys(stored.outputs).length, 1)
    assert.ok(JSON.stringify(stored.outputs).includes('大输出'))
  } finally {
    await f.service.close()
  }
})
test('restart expires approvals, marks in-flight work unknown and never replays it', async () => {
  const f = fixture([]),
    c = await f.open()
  await f.service.close()
  const stored = storedAiConversationSchema.parse(f.records.get(c.id))
  stored.conversation.status = 'executing'
  stored.conversation.messages.push(
    {
      id: randomUUID(),
      role: 'tool',
      text: '',
      tool: {
        id: 'stale',
        name: 'terminal_execute',
        args: command(),
        sessionId: 'a',
        state: 'running',
        preview: 'command',
        error: '',
      },
    },
    {
      id: randomUUID(),
      role: 'tool',
      text: '',
      tool: {
        id: 'approval',
        name: 'terminal_execute',
        args: command(),
        sessionId: 'a',
        state: 'pending',
        preview: 'command',
        error: '',
      },
    },
  )
  f.records.set(c.id, stored)
  const resumed = new AgentService(
    f.storage,
    f.ssh,
    f.transport,
    async () => '',
    { runtimeId: randomUUID(), workspaceId: 'offline', generation: 2 },
    () => {},
  )
  try {
    const read = aiConversationSchema.parse(await resumed.execute('ai.read', { conversationId: c.id }, 1))
    assert.equal(read.status, 'paused')
    assert.equal(read.messages[0].tool?.state, 'unknown')
    assert.equal(read.messages[1].tool?.state, 'expired')
    assert.equal(f.execs.length, 0)
    await assert.rejects(
      resumed.execute(
        'ai.decide',
        { conversationId: c.id, callId: 'approval', revision: read.revision, decision: 'once' },
        1,
      ),
    )
  } finally {
    await resumed.close()
  }
})
test('context compaction preserves original records and saves a separate semantic summary', async () => {
  const f = fixture([]),
    c = await f.open()
  await f.service.close()
  f.config.providers[0].contextWindow = 4096
  const stored = storedAiConversationSchema.parse(f.records.get(c.id))
  stored.wire = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 ? ('assistant' as const) : ('user' as const),
    content: '原始上下文'.repeat(700),
  }))
  stored.conversation.messages.push({ id: randomUUID(), role: 'user', text: '保留原始记录' })
  f.records.set(c.id, stored)
  const resumed = new AgentService(
    f.storage,
    f.ssh,
    f.transport,
    async () => '',
    { runtimeId: randomUUID(), workspaceId: 'offline', generation: 2 },
    () => {},
  )
  try {
    await resumed.execute('ai.read', { conversationId: c.id }, 1)
    await resumed.execute('ai.send', { conversationId: c.id, text: '继续', attachments: [] }, 1)
    await until(() => f.modelSteps >= 2)
    await until(() => storedAiConversationSchema.parse(f.records.get(c.id)).conversation.status === 'idle')
    const result = storedAiConversationSchema.parse(f.records.get(c.id))
    assert.equal(result.conversation.summary, '已完成任务')
    assert.ok(result.conversation.messages.some((m) => m.text === '保留原始记录'))
    assert.ok(result.wire.length < 8)
  } finally {
    await resumed.close()
  }
})
test('an idle Agent exposes per-job stop without interrupting other terminals', async () => {
  const external: AgentExternal = {
    status: async () => [],
    run: async (_i, _s, _t, tool) => {
      await tool('terminal_start', command('a'))
      await tool('terminal_start', command('b'))
      return { nativeSession: 'fixture' }
    },
  }
  const f = fixture([], external)
  f.long = true
  try {
    const c = await f.open()
    await f.service.execute('ai.backend', { conversationId: c.id, backend: { kind: 'codex', model: '' } }, 1)
    await f.service.execute('ai.permission', { conversationId: c.id, permission: 'auto' }, 1)
    await f.send(c.id)
    await until(() => f.current.status === 'idle' && f.current.jobs.length === 2)
    const job = f.current.jobs[0]
    await f.service.execute('ai.stopJob', { conversationId: c.id, jobId: job.id }, 1)
    assert.deepEqual(f.stops, ['a'])
    assert.equal(f.current.jobs[1].status, 'running')
    await f.service.execute('ai.cancel', { conversationId: c.id }, 1)
    assert.deepEqual(f.stops.sort(), ['a', 'b'])
  } finally {
    await f.service.close()
  }
})

test('disable stops the Agent, expires approvals and prevents subsequent runs while preserving secrets', async () => {
  const f = fixture([{ name: 'terminal_execute', args: command() }])
  try {
    const c = await f.open()
    await f.send(c.id)
    const call = await f.pending()
    await f.service.execute('ai.setEnabled', { enabled: false }, 1)
    assert.equal(f.config.enabled, false)
    assert.equal(f.config.providers[0].apiKey, 'test-key')
    assert.equal(f.execs.length, 0)
    assert.ok(!f.current.messages.some((m) => m.tool?.state === 'pending'))
    await assert.rejects(f.send(c.id), /启用/)
    await assert.rejects(f.open(), /启用/)
    await assert.rejects(
      f.service.execute(
        'ai.decide',
        { conversationId: c.id, callId: call.id, revision: f.current.revision, decision: 'once' },
        1,
      ),
    )
    await f.service.execute('ai.setEnabled', { enabled: true }, 1)
    assert.equal(f.config.providers[0].apiKey, 'test-key')
  } finally {
    await f.service.close()
  }
})
test('settings backend selection stops current work and hands the conversation to the selected Agent', async () => {
  const f = fixture([{ name: 'terminal_execute', args: command() }])
  try {
    const c = await f.open()
    await f.send(c.id)
    await f.pending()
    await f.service.execute('ai.setDefault', { kind: 'claude', model: 'configured' }, 1)
    assert.equal(f.current.backend.kind, 'claude')
    assert.equal(f.current.backend.model, 'configured')
    assert.ok(f.current.summary.includes('检查'))
    assert.equal(f.execs.length, 0)
    assert.equal(f.config.defaultBackend.kind, 'claude')
  } finally {
    await f.service.close()
  }
})
