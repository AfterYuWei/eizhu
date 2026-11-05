import test from 'node:test'
import assert from 'node:assert/strict'
import { generateModel } from './model.ts'
import type { AiTransport } from './model.ts'
import { modelFixture } from './model-fixture.ts'
const args = {
  sessionId: 'a',
  command: 'printf hello',
  cwd: '/tmp',
  purpose: '测试',
  impact: '只读',
  timeoutSeconds: 60,
}
for (const protocol of ['responses', 'chat', 'anthropic'] as const) {
  test(protocol + ': complete native tools round trip and streamed text', async () => {
    const bodies: unknown[] = []
    const transport: AiTransport = async (r, _s, consume) => {
      bodies.push(JSON.parse(r.body!))
      const bytes = Buffer.from(
        modelFixture(protocol, '中文 🧪', [{ id: 'call1', name: 'terminal_execute', args }]),
      )
      for (let i = 0; i < bytes.length; i += 7) await consume(bytes.subarray(i, i + 7))
    }
    let streamed = ''
    const result = await generateModel({
      provider: {
        id: 'test',
        name: '测试',
        protocol,
        endpoint: 'http://127.0.0.1/v1',
        model: 'fixture',
        contextWindow: 64000,
        apiKey: 'test-key',
      },
      source: 'custom',
      transport,
      signal: AbortSignal.timeout(3000),
      system: '测试',
      messages: [{ role: 'user', content: '检查' }],
      onText: (t) => {
        streamed = t
      },
    })
    assert.equal(result.text, '中文 🧪')
    assert.equal(streamed, '中文 🧪')
    assert.equal(result.calls[0].name, 'terminal_execute')
    assert.deepEqual(result.calls[0].args, args)
    assert.ok(result.messages.length)
    assert.equal(bodies.length, 1)
  })
  test(protocol + ': complete tool arguments followed by interrupted stream cannot authorize', async () => {
    const transport: AiTransport = async (_r, _s, consume) =>
      consume(
        Buffer.from(modelFixture(protocol, '', [{ id: 'call1', name: 'terminal_execute', args }], false)),
      )
    await assert.rejects(
      generateModel({
        provider: {
          id: 'test',
          name: '测试',
          protocol,
          endpoint: 'http://127.0.0.1/v1',
          model: 'fixture',
          contextWindow: 64000,
          apiKey: 'test-key',
        },
        source: 'custom',
        transport,
        signal: AbortSignal.timeout(3000),
        system: '测试',
        messages: [{ role: 'user', content: '检查' }],
        onText: () => {},
      }),
    )
  })
}
test('unknown tool and invalid command schema are rejected after completion', async () => {
  for (const c of [
    { id: 'bad', name: 'local_shell', args: {} },
    { id: 'bad', name: 'terminal_execute', args: { ...args, cwd: 'relative' } },
  ]) {
    const transport: AiTransport = async (_r, _s, consume) =>
      consume(Buffer.from(modelFixture('responses', '', [c])))
    await assert.rejects(
      generateModel({
        provider: {
          id: 'test',
          name: '测试',
          protocol: 'responses',
          endpoint: 'http://127.0.0.1/v1',
          model: 'fixture',
          contextWindow: 64000,
          apiKey: '',
        },
        source: 'custom',
        transport,
        signal: AbortSignal.timeout(3000),
        system: '测试',
        messages: [{ role: 'user', content: '检查' }],
        onText: () => {},
      }),
    )
  }
})
