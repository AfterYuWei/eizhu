import assert from 'node:assert/strict'
import { aiCapabilitiesSchema, aiHttpRequestSchema } from '@eizhu/contracts'
import { generateModel } from '../packages/core/src/agent/model.ts'
assert.ok(process.argv.includes('--local'), '必须显式传入 --local；禁止对生产运行此工具')
const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7))
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535)
const token = process.env.EIZHU_AI_ACCEPT_TOKEN
assert.ok(token, '通过EIZHU_AI_ACCEPT_TOKEN提供本地隔离账号令牌')
const base = 'http://127.0.0.1:' + port
const headers = { authorization: 'Bearer ' + token }
const capabilities = async () => {
  const response = await fetch(base + '/api/ai/v2/capabilities', { headers, redirect: 'error' })
  assert.equal(response.status, 200)
  return aiCapabilitiesSchema.parse(await response.json())
}
const before = await capabilities()
assert.ok(before.available && before.defaultModel && before.remainingTokens > 0)
const result = await generateModel({
  provider: {
    id: 'official',
    name: '官方',
    protocol: 'responses',
    endpoint: 'https://eizhu.yuweinfo.com/api/ai/v2',
    model: before.defaultModel,
    contextWindow: 64000,
    apiKey: '',
  },
  source: 'official',
  token,
  signal: AbortSignal.timeout(120000),
  system: '仅测试工具协议，调用session_info，不执行任何远端操作。',
  messages: [{ role: 'user', content: '调用session_info验证协议' }],
  requireTool: true,
  onText: () => {},
  transport: async (raw, signal, consume) => {
    const checked = aiHttpRequestSchema.parse(raw)
    assert.equal(checked.source, 'official')
    assert.equal(checked.url, 'https://eizhu.yuweinfo.com/api/ai/v2/responses')
    const response = await fetch(base + '/api/ai/v2/responses', {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: checked.body,
    })
    assert.equal(response.status, 200)
    assert.ok(response.body)
    for await (const bytes of response.body) await consume(bytes)
  },
})
assert.equal(result.calls.length, 1)
assert.equal(result.calls[0].name, 'session_info')
const after = await capabilities()
assert.ok(after.remainingTokens < before.remainingTokens, '完成事件须在额度结算后发送')
console.log(
  JSON.stringify({
    local: true,
    toolsetVersion: 2,
    desktopProtocol: true,
    toolProposal: true,
    executedCommands: 0,
    settledTokens: before.remainingTokens - after.remainingTokens,
    productionContacted: false,
  }),
)
