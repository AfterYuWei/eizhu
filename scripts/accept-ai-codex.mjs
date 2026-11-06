import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { gunzipSync, zstdDecompressSync } from 'node:zlib'
import { CliAgentHost } from '../apps/desktop/src/main/ai-cli.ts'
assert.ok(process.argv.includes('--local'), '必须显式使用 --local；仅连接合成模型')
const path = process.argv.find((v) => v.startsWith('--cli='))?.slice(6)
assert.ok(path && isAbsolute(path), '通过 --cli=<已安装Codex绝对路径> 指定CLI；不下载二进制')
const root = await mkdtemp(join(tmpdir(), 'eizhu-codex-accept-'))
let requests = 0,
  calls = 0,
  text = '',
  toolNames = [],
  failure
const server = createServer(async (req, res) => {
  try {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      assert.ok(size <= 1048576)
      chunks.push(chunk)
    }
    let bytes = Buffer.concat(chunks)
    if (req.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes)
    if (req.headers['content-encoding'] === 'zstd') bytes = zstdDecompressSync(bytes)
    if (!bytes.length) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    const body = JSON.parse(bytes.toString())
    if (!body.tools) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    requests++
    toolNames = body.tools.map((t) => t.name || t.type)
    const helpers = [
      'list_mcp_resources',
      'list_mcp_resource_templates',
      'read_mcp_resource',
      'request_user_input',
    ]
    assert.ok(
      toolNames.every((n) => helpers.includes(n) || n === 'mcp__eizhu' || n.startsWith('mcp__eizhu__')),
      '发现未受管原生工具',
    )
    const namespace = body.tools.find((t) => t.name === 'mcp__eizhu')
    assert.ok(namespace || toolNames.includes('mcp__eizhu__session_info'), '未发现eizhu工具')
    const call = {
      type: 'function_call',
      id: 'fc_fixture',
      call_id: 'call_fixture',
      name: namespace ? 'session_info' : 'mcp__eizhu__session_info',
      ...(namespace ? { namespace: 'mcp__eizhu' } : {}),
      arguments: '{}',
      status: 'completed',
    }
    const message = {
      type: 'message',
      id: 'msg_fixture',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '本地协议验收完成', annotations: [] }],
    }
    const output = requests === 1 ? [call] : [message]
    const response = {
      id: 'resp_' + requests,
      object: 'response',
      created_at: 1,
      model: body.model,
      status: 'completed',
      output,
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    }
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      ...output.flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item },
        ...(item.type === 'message'
          ? [
              {
                type: 'response.output_text.delta',
                item_id: item.id,
                output_index,
                content_index: 0,
                delta: '本地协议验收完成',
              },
            ]
          : []),
        { type: 'response.output_item.done', output_index, item },
      ]),
      { type: 'response.completed', response },
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''))
  } catch (error) {
    failure = error
    res.writeHead(500)
    res.end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const extras = [
  '-c',
  'model_provider="eizhu_fixture"',
  '-c',
  'model_providers.eizhu_fixture.name="fixture"',
  '-c',
  'model_providers.eizhu_fixture.base_url="http://127.0.0.1:' + server.address().port + '/v1"',
  '-c',
  'model_providers.eizhu_fixture.wire_api="responses"',
  '-c',
  'model_providers.eizhu_fixture.requires_openai_auth=false',
  '-c',
  'analytics.enabled=false',
  '-c',
  'feedback.enabled=false',
]
const wrapper = join(root, 'codex.mjs')
await writeFile(
  wrapper,
  '#!/usr/bin/env node\nimport {spawn} from "node:child_process";const args=process.argv.slice(2);const child=spawn(' +
    JSON.stringify(path) +
    ',[...args,...(args[0]==="mcp"?[]:' +
    JSON.stringify(extras) +
    ')],{stdio:["inherit","inherit","ignore"]});child.on("exit",code=>process.exit(code??1));\n',
  { mode: 0o700 },
)
await writeFile(
  join(root, 'ai-mcp.cjs'),
  'void import(' + JSON.stringify(resolve('apps/desktop/src/runtime/ai-mcp.ts')) + ')',
)
const host = new CliAgentHost(root, root)
try {
  await host.run(
    {
      conversationId: randomUUID(),
      cli: { kind: 'codex', path: wrapper, model: 'gpt-5.2-codex' },
      prompt: '调用eizhu session_info，然后中文回答。',
    },
    AbortSignal.timeout(45000),
    (value) => {
      text = value
    },
    async (name, args) => {
      assert.equal(name, 'session_info')
      assert.deepEqual(args, {})
      calls++
      return { sessions: [] }
    },
  )
  if (failure) throw failure
  assert.equal(calls, 1)
  assert.equal(requests, 2)
  assert.equal(text, '本地协议验收完成')
  console.log(
    JSON.stringify(
      {
        passed: true,
        nativeCli: true,
        syntheticModel: true,
        productionContacted: false,
        requests,
        calls,
        localExecutionToolsAbsent: true,
        toolNames,
      },
      null,
      2,
    ),
  )
} finally {
  await host.close()
  await new Promise((r) => server.close(r))
  await rm(root, { recursive: true, force: true })
}
