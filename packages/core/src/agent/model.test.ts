import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aiEndpointSchema, aiHttpRequestSchema } from '@eizhu/contracts'
import { generateModel, modelRequest, redactAiText } from './model.ts'
import type { AiTransport } from './model.ts'

const config = {
  source: 'custom' as const,
  protocol: 'chat' as const,
  endpoint: 'http://127.0.0.1:1234/v1',
  model: 'synthetic',
  apiKey: '',
}
const command = { command: 'printf hello', cwd: "/tmp/中文's", purpose: '诊断', impact: '只读' }
const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`
const request = modelRequest(config, '', [{ role: 'user', content: '检查' }])
const stream =
  (body: string): AiTransport =>
  async (_r, _s, consume) => {
    const bytes = Buffer.from(body)
    for (let i = 0; i < bytes.length; i += 3) await consume(bytes.subarray(i, i + 3))
  }

test('AI endpoint boundary allows HTTPS and loopback HTTP; official origin and paths are pinned', () => {
  for (const value of ['https://api.example.invalid/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1'])
    assert.ok(aiEndpointSchema.safeParse(value).success)
  for (const value of [
    'http://api.example.invalid/v1',
    'https://user:secret@example.invalid',
    'file:///tmp/a',
    'https://example.invalid/?token=secret',
  ])
    assert.ok(!aiEndpointSchema.safeParse(value).success)
  assert.ok(
    !aiHttpRequestSchema.safeParse({
      source: 'official',
      url: config.endpoint,
      authorization: '',
      method: 'GET',
    }).success,
  )
})
test('chat streaming handles split UTF-8 and arguments, requiring a completed single tool call', async () => {
  const body =
    event({
      choices: [
        {
          delta: {
            content: '检查中文 🧪',
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                function: { name: 'run_command', arguments: JSON.stringify(command).slice(0, 15) },
              },
            ],
          },
        },
      ],
    }) +
    event({
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(command).slice(15) } }] },
          finish_reason: 'tool_calls',
        },
      ],
    }) +
    'data: [DONE]\n\n'
  const result = await generateModel(stream(body), request, new AbortController().signal, () => undefined)
  assert.deepEqual(result.command, command)
  assert.equal(result.text, '检查中文 🧪')
  await assert.rejects(
    generateModel(
      stream(body.slice(0, body.indexOf('data: ', 20))),
      request,
      new AbortController().signal,
      () => undefined,
    ),
  )
  await assert.rejects(
    generateModel(
      stream(event({ choices: [{ delta: { tool_calls: [{ index: 1 }] } }] })),
      request,
      new AbortController().signal,
      () => undefined,
    ),
  )
})
test('Responses preserves reasoning/output items for subsequent stateless tool results', async () => {
  const req = modelRequest({ ...config, protocol: 'responses' }, '', [{ role: 'user', content: '检查' }])
  const output = [
    { type: 'reasoning', encrypted_content: 'synthetic-encrypted' },
    { type: 'function_call', call_id: 'call-2', name: 'run_command', arguments: JSON.stringify(command) },
  ]
  const result = await generateModel(
    stream(event({ type: 'response.completed', response: { status: 'completed', output } })),
    req,
    new AbortController().signal,
    () => undefined,
  )
  assert.deepEqual(result.command, command)
  const next = JSON.parse(
    modelRequest({ ...config, protocol: 'responses' }, '', [
      result.message,
      { role: 'tool', content: 'done', tool_call_id: 'call-2' },
    ]).body!,
  )
  assert.equal(next.input[0].encrypted_content, 'synthetic-encrypted')
  assert.equal(next.input[2].call_id, 'call-2')
})
test('sensitive keys, tokens and private key blocks are removed from model context', () => {
  const value = redactAiText(
    'owned-secret Bearer token-123 password=unsafe\n-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----',
    ['owned-secret'],
  )
  for (const secret of ['owned-secret', 'token-123', 'unsafe', '\nkey\n']) assert.ok(!value.includes(secret))
})
