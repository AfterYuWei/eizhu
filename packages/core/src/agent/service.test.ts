import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { aiConversationSchema, aiProposalSchema, aiSettingsSchema, fail } from '@eizhu/contracts'
import type { AiConversation } from '@eizhu/contracts'
import { AgentService } from './service.ts'
import { storedAiConfigSchema, storedAiConversationSchema } from './repository.ts'
import type { AgentSsh } from './service.ts'
import type { AiTransport } from './model.ts'

async function fixture() {
  let config: z.infer<typeof storedAiConfigSchema> = {
    source: 'custom',
    endpoint: 'http://127.0.0.1/v1',
    model: 'synthetic',
    apiKey: 'private-api-key',
  }
  const records = new Map<string, unknown>()
  const requests: string[] = []
  let binding: object = {},
    calls = 0,
    writesFail = false,
    interrupted = false,
    tokenExpired = false,
    remainingTokens = 90,
    stdout = 'hello'
  const target = {
    profileId: 'profile',
    sessionId: 'session',
    host: '127.0.0.1',
    username: 'synthetic',
    port: 22,
    cwd: '/tmp',
    system: '合成系统',
  }
  let current: AiConversation | undefined
  const storage = async (raw: unknown) => {
    const d = raw as { kind: string; value?: unknown; id?: string }
    if (d.kind === 'config.read') return structuredClone(config)
    if (d.kind === 'config.write') {
      config = storedAiConfigSchema.parse(d.value)
      return
    }
    if (d.kind === 'read') return structuredClone(records.get(d.id!))
    if (d.kind === 'save') {
      if (writesFail) throw new Error('Synthetic disk failure')
      const value = storedAiConversationSchema.parse(d.value)
      records.set(value.conversation.id, structuredClone(value))
      return
    }
    if (d.kind === 'list') return []
  }
  const ssh: AgentSsh = {
    agentTarget: async () => ({ target: structuredClone(target), binding }),
    agentConnected: (_session, b) => b === binding,
    agentExecute: async (_session, _b, _p, _signal, output) => {
      calls++
      output('hello', 'warning')
      await new Promise((r) => setTimeout(r, 10))
      return {
        status: 'completed',
        stdout,
        stderr: 'warning',
        exitCode: 7,
        elapsedMs: 10,
        truncated: false,
        message: '',
      }
    },
  }
  const transport: AiTransport = async (request, _signal, consume) => {
    if (request.body) requests.push(request.body)
    if (request.method === 'GET' && request.url.endsWith('/models')) {
      await consume(
        Buffer.from(JSON.stringify({ data: [{ id: 'synthetic' }, { id: 'other' }, { id: 'synthetic' }] })),
      )
      return
    }
    if (request.method === 'GET') {
      await consume(
        Buffer.from(
          JSON.stringify({
            available: true,
            models: [{ id: 'synthetic', name: '合成模型' }],
            defaultModel: 'synthetic',
            dailyTokenLimit: 100,
            remainingTokens,
            message: '',
          }),
        ),
      )
      return
    }
    const command = { command: 'printf hello', cwd: '/tmp', purpose: '检查', impact: '只读' }
    const text = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '先检查' })}\n\n`
    const completed = interrupted
      ? ''
      : `data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [
              {
                type: 'function_call',
                call_id: randomUUID(),
                name: 'run_command',
                arguments: JSON.stringify(command),
              },
            ],
          },
        })}\n\n`
    await consume(Buffer.from(text + completed))
  }
  const service = new AgentService(
    storage,
    ssh,
    transport,
    async () => {
      if (tokenExpired) fail('ACCOUNT_NOT_LOGGED_IN', '登录已失效')
      return 'Bearer synthetic-token'
    },
    { runtimeId: randomUUID(), workspaceId: 'offline', generation: 1 },
    (c) => {
      current = structuredClone(c)
    },
  )
  const c = aiConversationSchema.parse(await service.execute('ai.open', { sessionId: 'session' }, 1))
  const wait = async (condition: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) {
        await new Promise((r) => setTimeout(r, 1))
        return
      }
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error('AI test timeout')
  }
  const send = async () => {
    await service.execute('ai.send', { conversationId: c.id, text: '检查', attachments: [] }, 1)
    await wait(() => ['awaiting_confirmation', 'error'].includes(current?.status ?? ''))
    return aiProposalSchema.parse(current?.messages.at(-1)?.proposal)
  }
  return {
    service,
    c,
    send,
    wait,
    current: () => current!,
    calls: () => calls,
    rebind: () => {
      binding = {}
    },
    failWrites: () => {
      writesFail = true
    },
    interrupt: () => {
      interrupted = true
    },
    setRemaining: (n: number) => {
      remainingTokens = n
    },
    expireToken: () => {
      tokenExpired = true
    },
    changeHost: () => {
      target.host = 'other.example.invalid'
      binding = {}
    },
    setOutput: (value: string) => {
      stdout = value
    },
    requests: () => requests,
    setCwd: (cwd: string) => {
      target.cwd = cwd
    },
    records,
    restart: async () => {
      await service.close()
      return new AgentService(
        storage,
        ssh,
        transport,
        async () => 'Bearer synthetic-token',
        { runtimeId: randomUUID(), workspaceId: 'offline', generation: 2 },
        (c) => {
          current = structuredClone(c)
        },
      )
    },
  }
}
test('no command before approval; duplicate confirmation executes once and next command waits again', async () => {
  const f = await fixture()
  try {
    const p = await f.send()
    assert.equal(f.calls(), 0)
    await f.service.execute('ai.decide', { proposalId: p.id, accepted: true }, 1)
    await assert.rejects(f.service.execute('ai.decide', { proposalId: p.id, accepted: true }, 1))
    await f.wait(
      () =>
        f.current().status === 'awaiting_confirmation' &&
        f.current().messages.some((m) => m.proposal?.state === 'completed'),
    )
    assert.equal(f.calls(), 1)
    const result = f.current().messages.find((m) => m.proposal?.id === p.id)?.proposal?.result
    assert.equal(result?.exitCode, 7)
    assert.equal(result?.stderr, 'warning')
    assert.equal(f.current().messages.at(-1)?.proposal?.state, 'pending')
  } finally {
    await f.service.close()
  }
})
test('every model request uses the current terminal directory and interactive execution instructions', async () => {
  const f = await fixture()
  try {
    f.setCwd('/srv/current-terminal')
    await f.send()
    const request = JSON.parse(f.requests().at(-1)!)
    const system = request.input.find((item: { role?: string }) => item.role === 'system').content
    assert.ok(system.includes('当前 SSH 窗口的交互式 shell'))
    assert.ok(system.includes('/srv/current-terminal'))
    assert.ok(!system.includes('独立的非交互'))
    assert.equal(f.current().target.cwd, '/srv/current-terminal')
  } finally {
    await f.service.close()
  }
})
test('window ownership, connection replacement, rejection and changed model invalidate proposals', async () => {
  const f = await fixture()
  try {
    const p = await f.send()
    await assert.rejects(f.service.execute('ai.decide', { proposalId: p.id, accepted: true }, 2))
    f.rebind()
    await assert.rejects(f.service.execute('ai.decide', { proposalId: p.id, accepted: true }, 1))
    assert.equal(f.calls(), 0)
    await f.service.execute('ai.open', { sessionId: 'session', conversationId: f.c.id }, 1)
    const next = await f.send()
    await f.service.execute('ai.decide', { proposalId: next.id, accepted: false }, 1)
    await assert.rejects(f.service.execute('ai.decide', { proposalId: next.id, accepted: true }, 1))
    const pending = await f.send()
    const settings = aiSettingsSchema.parse(
      await f.service.execute(
        'ai.configure',
        { source: 'custom', endpoint: 'http://127.0.0.1/v1', model: 'other' },
        1,
      ),
    )
    assert.equal(settings.hasApiKey, true)
    assert.ok(!JSON.stringify(settings).includes('private-api-key'))
    await assert.rejects(f.service.execute('ai.decide', { proposalId: pending.id, accepted: true }, 1))
    assert.equal(f.calls(), 0)
  } finally {
    await f.service.close()
  }
})
test('durable checkpoint failure prevents SSH dispatch', async () => {
  const f = await fixture()
  try {
    const p = await f.send()
    f.failWrites()
    await f.service.execute('ai.decide', { proposalId: p.id, accepted: true }, 1)
    await f.wait(() => f.current().status === 'error')
    assert.equal(f.calls(), 0)
  } finally {
    await f.service.close()
  }
})
test('interrupted stream has no executable card', async () => {
  const f = await fixture()
  try {
    f.interrupt()
    await f.service.execute('ai.send', { conversationId: f.c.id, text: '检查', attachments: [] }, 1)
    await f.wait(() => f.current().status === 'error')
    assert.ok(!f.current().messages.at(-1)?.proposal)
    assert.equal(f.calls(), 0)
  } finally {
    await f.service.close()
  }
})
test('concurrent sends cannot start two model loops for one conversation', async () => {
  const f = await fixture()
  try {
    const input = { conversationId: f.c.id, text: '检查', attachments: [] }
    const results = await Promise.allSettled([
      f.service.execute('ai.send', input, 1),
      f.service.execute('ai.send', input, 1),
    ])
    assert.equal(results.filter((v) => v.status === 'fulfilled').length, 1)
    await f.wait(() => f.current().status === 'awaiting_confirmation')
    assert.equal(f.current().messages.filter((v) => v.proposal).length, 1)
    assert.equal(f.calls(), 0)
  } finally {
    await f.service.close()
  }
})
test('persisted pending proposals cannot execute after runtime restart and can be read without a connection', async () => {
  const f = await fixture()
  const p = await f.send()
  const restarted = await f.restart()
  try {
    const read = aiConversationSchema.parse(
      await restarted.execute('ai.read', { profileId: 'profile', conversationId: f.c.id }, 1),
    )
    assert.equal(read.messages.at(-1)?.proposal?.state, 'expired')
    const opened = aiConversationSchema.parse(
      await restarted.execute('ai.open', { sessionId: 'session', conversationId: f.c.id }, 1),
    )
    assert.equal(opened.messages.at(-1)?.proposal?.state, 'expired')
    await assert.rejects(restarted.execute('ai.decide', { proposalId: p.id, accepted: true }, 1))
    assert.equal(f.calls(), 0)
  } finally {
    await restarted.close()
  }
})
test('official capability contract uses account authorization and blocks exhausted quota or expired login', async () => {
  const f = await fixture()
  try {
    await f.service.execute('ai.configure', { source: 'official', endpoint: '', model: '' }, 1)
    const opened = aiConversationSchema.parse(await f.service.execute('ai.open', { sessionId: 'session' }, 1))
    assert.equal(opened.model, 'synthetic')
    f.setRemaining(0)
    await assert.rejects(f.service.execute('ai.open', { sessionId: 'session' }, 1), /额度/)
    f.expireToken()
    await assert.rejects(f.service.execute('ai.capabilities', undefined, 1), /登录已失效/)
    assert.equal(f.calls(), 0)
  } finally {
    await f.service.close()
  }
})
test('changed server endpoint cannot resume an old execution context; history remains readable', async () => {
  const f = await fixture()
  try {
    await f.send()
    f.changeHost()
    await assert.rejects(
      f.service.execute('ai.open', { sessionId: 'session', conversationId: f.c.id }, 1),
      /连接信息已变化/,
    )
    const read = aiConversationSchema.parse(
      await f.service.execute('ai.read', { profileId: 'profile', conversationId: f.c.id }, 1),
    )
    assert.equal(read.target.host, '127.0.0.1')
    assert.equal(f.calls(), 0)
  } finally {
    await f.service.close()
  }
})
test('medium output is sent to the model once without duplicated overlapping head/tail fragments', async () => {
  const f = await fixture()
  try {
    const value = 'A'.repeat(17000) + 'B'.repeat(3000)
    f.setOutput(value)
    const p = await f.send()
    await f.service.execute('ai.decide', { proposalId: p.id, accepted: true }, 1)
    await f.wait(() => f.requests().length === 2 && f.current().status === 'awaiting_confirmation')
    const request = JSON.parse(f.requests()[1])
    const result = JSON.parse(
      request.input.find((m: { type: string }) => m.type === 'function_call_output').output,
    )
    assert.equal(result.stdout, value)
  } finally {
    await f.service.close()
  }
})

test('model discovery and connection tests use drafts without saving or executing SSH', async () => {
  const f = await fixture()
  try {
    const before = await f.service.execute('ai.settings', undefined, 1)
    const draft = { source: 'custom', endpoint: 'http://127.0.0.1/v1', model: '' }
    const result = (await f.service.execute('ai.discover', draft, 1)) as { models: Array<{ id: string }> }
    assert.deepEqual(
      result.models.map((model) => model.id),
      ['synthetic', 'other'],
    )
    await f.service.execute('ai.test', { ...draft, model: 'other' }, 1)
    assert.equal(JSON.parse(f.requests().at(-1)!).model, 'other')
    assert.equal(JSON.parse(f.requests().at(-1)!).max_output_tokens, 256)
    assert.deepEqual(await f.service.execute('ai.settings', undefined, 1), before)
    assert.equal(f.calls(), 0)
  } finally {
    await f.service.close()
  }
})

test('legacy conversation history stays readable and cannot resume an old protocol context', async () => {
  const f = await fixture()
  const record = storedAiConversationSchema.parse(f.records.get(f.c.id))
  delete record.format
  f.records.set(f.c.id, record)
  const restarted = await f.restart()
  try {
    const read = await restarted.execute('ai.read', { profileId: 'profile', conversationId: f.c.id }, 1)
    assert.ok(read)
    await assert.rejects(
      restarted.execute('ai.open', { sessionId: 'session', conversationId: f.c.id }, 1),
      /协议已更新/,
    )
    assert.equal(f.calls(), 0)
  } finally {
    await restarted.close()
  }
})
