import assert from 'node:assert/strict'
import { aiCapabilitiesSchema, aiHttpRequestSchema } from '@eizhu/contracts'
import { generateModel, modelRequest } from '../packages/core/src/agent/model.ts'

// Explicit local acceptance only. Product requests retain their fixed production addresses.
assert.ok(process.argv.includes('--local'), '必须显式传入 --local；禁止对生产运行此工具')
const portText = process.argv.find((arg) => arg.startsWith('--port='))?.slice(7)
assert.match(portText ?? '', /^\d{4,5}$/)
const port = Number(portText)
assert.ok(port >= 1024 && port <= 65535)
const token = process.env.EIZHU_AI_ACCEPT_TOKEN
assert.ok(token, '请通过 EIZHU_AI_ACCEPT_TOKEN 提供隔离本地账号令牌')
const base = `http://127.0.0.1:${port}`
const headers = { authorization: `Bearer ${token}` }
const capabilities = async () => {
  const response = await fetch(`${base}/api/ai/v1/capabilities`, { headers, redirect: 'error' })
  assert.equal(response.status, 200)
  return aiCapabilitiesSchema.parse(await response.json())
}
const before = await capabilities()
assert.ok(before.available && before.defaultModel && before.remainingTokens > 0)
const config = { source: 'official', endpoint: '', model: before.defaultModel, apiKey: '' }
const request = modelRequest(config, `Bearer ${token}`, [{ role: 'user', content: '请提议一条只读检查命令，不执行。' }])
const result = await generateModel(
  async (raw, signal, consume) => {
    const checked = aiHttpRequestSchema.parse(raw)
    assert.equal(checked.source, 'official')
    assert.equal(checked.url, 'https://eizhu.yuweinfo.com/api/ai/v1/responses')
    const response = await fetch(`${base}/api/ai/v1/responses`, {
      method: 'POST', signal, redirect: 'error',
      headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: checked.body,
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
    assert.ok(response.body)
    for await (const bytes of response.body) await consume(bytes)
  },
  request,
  AbortSignal.timeout(120000),
  () => {},
)
assert.ok(result.command && result.callId, '本地验收上游须返回 run_command 工具提议')
const after = await capabilities()
assert.ok(after.remainingTokens < before.remainingTokens, '官方额度须在响应完成前结算')
console.log(JSON.stringify({ local: true, desktopProtocol: true, toolProposal: true, executedCommands: 0,
  settledTokens: before.remainingTokens - after.remainingTokens, productionContacted: false }))
