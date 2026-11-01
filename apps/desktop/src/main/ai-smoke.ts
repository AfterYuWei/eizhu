import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Server, utils } from 'ssh2'
import type { Connection } from 'ssh2'
import type { AddressInfo } from 'node:net'
import type { BrowserWindow } from 'electron'
import type { RuntimeHost } from './runtime-host.ts'
import { aiConversationSchema } from '@eizhu/contracts'

/** Explicitly isolated smoke profile, actual main/network/utilityProcess/SQLite/SSH and local synthetic model. */
export async function verifyAiDesktop(window: BrowserWindow, runtime: RuntimeHost, root: string) {
  const clients = new Set<Connection>(),
    commands: string[] = [],
    requests: string[] = []
  let modelMode: 'normal' | 'quota' | 'unauthorized' | 'interrupted' | 'unsupported' = 'normal'
  const key = utils.generateKeyPairSync('ed25519'),
    parsed = utils.parseKey(key.private)
  assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed))
  const fingerprint =
    'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  const ssh = new Server({ hostKeys: [key.private] }, (client) => {
    clients.add(client)
    client.on('error', () => undefined)
    client.once('close', () => clients.delete(client))
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.password === 'synthetic-ai-ssh-password') ctx.accept()
      else ctx.reject()
    })
    client.on('ready', () =>
      client.on('session', (accept) => {
        const s = accept()
        s.on('pty', (accept) => accept?.())
        s.on('shell', (accept) => {
          const channel = accept()
          channel.on('error', () => undefined)
          channel.write('AI synthetic terminal\r\n$ ')
        })
        s.on('exec', (accept, _reject, info) => {
          const channel = accept()
          channel.on('error', () => undefined)
          if (info.command.startsWith('cd -- ')) {
            commands.push(info.command)
            const bytes = Buffer.from('你好 🧪\n')
            channel.write(bytes.subarray(0, 2))
            channel.write(bytes.subarray(2))
            channel.stderr.write('synthetic warning\n')
            channel.exit(3)
          } else {
            channel.write('/bin/sh\n')
            channel.exit(0)
          }
          channel.end()
        })
      }),
    )
  })
  const http = createServer((req, res) => {
    let body = ''
    req.on('data', (bytes: Buffer) => {
      body += bytes.toString()
      if (body.length > 524288) req.destroy()
    })
    req.on('end', () => {
      requests.push(body)
      assert.equal(req.headers.authorization, 'Bearer synthetic-ai-api-key')
      if (modelMode === 'quota' || modelMode === 'unauthorized') {
        res.writeHead(modelMode === 'quota' ? 429 : 401)
        res.end()
        return
      }
      const data = JSON.parse(body) as { messages: Array<{ role: string }> }
      const done = data.messages.some((m) => m.role === 'tool')
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const command = {
        command: "printf '你好'",
        cwd: '/tmp',
        purpose: '检查远端命令输出',
        impact: '只读，不修改服务器文件',
      }
      if (modelMode === 'unsupported') {
        res.end(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '此模型仅支持文本' }, finish_reason: 'stop' }] })}\n\n`,
        )
        return
      }
      const delta = done
        ? { content: '检查完成：命令退出码为 3，请结合警告核查。后续操作仍需确认。' }
        : {
            content: '我会先检查命令输出。',
            tool_calls: [
              {
                index: 0,
                id: 'synthetic-call',
                function: { name: 'run_command', arguments: JSON.stringify(command) },
              },
            ],
          }
      const payload = Buffer.from(
        `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n${modelMode === 'interrupted' ? '' : `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: done ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`}`,
      )
      res.write(payload.subarray(0, 37))
      res.end(payload.subarray(37))
    })
  })
  const js = <T = unknown>(source: string, data?: unknown): Promise<T> =>
    window.webContents.executeJavaScript(`(async d=>{${source}})(${JSON.stringify(data)})`)
  const call = <T = unknown>(domain: string, method: string, input?: unknown) => {
    console.log('EIZHU_AI_STEP', `${domain}.${method}`)
    return js<T>('return window.eizhu[d.domain][d.method](d.input)', { domain, method, input })
  }
  const wait = async (source: string) => {
    for (let i = 0; i < 200; i++) {
      if (await js<boolean>(source)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('AI desktop smoke timeout: ' + source)
  }
  const size = window.getContentSize(),
    screenshots: string[] = []
  let profileId: string | undefined
  try {
    ssh.listen(0, '127.0.0.1')
    http.listen(0, '127.0.0.1')
    await Promise.all([once(ssh, 'listening'), once(http, 'listening')])
    const port = (ssh.address() as AddressInfo).port,
      httpPort = (http.address() as AddressInfo).port
    const profile = await call<{ id: string }>('profile', 'create', {
      request: {
        name: 'AI 合成服务',
        host: '127.0.0.1',
        port,
        username: 'synthetic',
        auth_type: 'password',
        password: 'synthetic-ai-ssh-password',
      },
    })
    profileId = profile.id
    const settings = await call('ai', 'configure', {
      source: 'custom',
      protocol: 'chat',
      endpoint: `http://127.0.0.1:${httpPort}/v1`,
      model: 'synthetic-ai',
      apiKey: 'synthetic-ai-api-key',
    })
    assert.ok(!JSON.stringify(settings).includes('synthetic-ai-api-key'))
    await call('ai', 'test')
    assert.equal(commands.length, 0)
    const loaded = once(window.webContents, 'did-finish-load')
    window.webContents.reload()
    await loaded
    window.webContents.backgroundThrottling = false
    await wait("return [...document.querySelectorAll('.srv')].some(r=>r.title.startsWith('AI 合成服务 ·'))")
    await js(
      "window.__aiSmoke=null;window.eizhu.events.on('eizhu-ai-message',e=>{if(e.conversation)window.__aiSmoke=e.conversation});const row=[...document.querySelectorAll('.srv')].find(r=>r.title.startsWith('AI 合成服务 ·'));row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
    )
    await wait(
      "return [...document.querySelectorAll('[role=\"dialog\"] button')].some(b=>b.textContent==='信任并继续')",
    )
    assert.ok(await js<boolean>('return document.body.innerText.includes(d)', fingerprint))
    await js(
      "[...document.querySelectorAll('[role=\"dialog\"] button')].find(b=>b.textContent==='信任并继续').click()",
    )
    await wait(
      "return window.eizhu.session.list().then(rows=>rows.some(r=>r.profile_id===d&&r.status==='connected'))".replace(
        '===d',
        `===${JSON.stringify(profileId)}`,
      ),
    )
    await wait(
      'return !!document.querySelector(\'button[aria-label="AI 助手"]\')&&!document.querySelector(\'[role="dialog"]\')',
    )
    await js('document.querySelector(\'button[aria-label="AI 助手"]\').click()')
    await wait("return !!window.__aiSmoke&&!!document.querySelector('.ai-composer textarea:not([disabled])')")
    await js(
      "const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'检查命令输出');input.dispatchEvent(new Event('input',{bubbles:true}))",
    )
    await js("[...document.querySelectorAll('.ai-composer button')].find(b=>b.textContent==='发送').click()")
    await wait(
      "return window.__aiSmoke?.status==='awaiting_confirmation'&&!!document.querySelector('.ai-command')",
    )
    assert.equal(commands.length, 0, 'No SSH exec before user confirmation')
    const proposed = aiConversationSchema.parse(await js('return window.__aiSmoke'))
    const proposalId = proposed.messages.at(-1)!.proposal!.id
    await js(
      "[...document.querySelectorAll('.ai-command button')].find(b=>b.textContent==='执行此命令').click()",
    )
    await call('ai', 'decide', { proposalId, accepted: true }).then(
      () => assert.fail('Duplicate approval accepted'),
      () => undefined,
    )
    await wait(
      "return window.__aiSmoke?.status==='idle'&&window.__aiSmoke.messages.some(m=>m.proposal?.state==='completed')",
    )
    const result = aiConversationSchema
      .parse(await js('return window.__aiSmoke'))
      .messages.find((m) => m.proposal?.id === proposalId)!.proposal!.result!
    assert.equal(commands.length, 1)
    assert.equal(result.exitCode, 3)
    assert.equal(result.stdout, '你好 🧪\n')
    assert.equal(result.stderr, 'synthetic warning\n')
    assert.ok(commands[0].startsWith("cd -- '/tmp' && exec sh -c "))
    assert.ok(!requests.join('').includes('synthetic-ai-ssh-password'))
    const rows = await call<Array<{ id: string }>>('ai', 'history', { profileId })
    assert.equal(rows.length, 1)
    const historical = aiConversationSchema.parse(
      await call('ai', 'read', { profileId, conversationId: rows[0].id }),
    )
    assert.equal(
      historical.messages.find((m) => m.proposal?.id === proposalId)?.proposal?.result?.exitCode,
      3,
    )
    const stateFiles = [
      join(root, 'workspaces/offline/workspace.sqlite'),
      join(root, 'workspaces/offline/workspace.sqlite-wal'),
    ]
    for (const path of stateFiles) {
      const bytes = await readFile(path).catch(() => Buffer.alloc(0))
      assert.ok(!bytes.includes(Buffer.from('synthetic-ai-api-key')))
      assert.ok(!bytes.includes(Buffer.from('检查远端命令输出')))
    }
    for (const theme of ['light', 'dark']) {
      window.setContentSize(1280, 800)
      await js(
        "document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(d);await document.fonts.ready;await new Promise(r=>setTimeout(r,150))",
        theme,
      )
      const name = `ai-chat-${theme}.png`
      await writeFile(
        join(root, name),
        (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
      )
      screenshots.push(name)
    }
    window.setContentSize(900, 720)
    await wait("return document.querySelector('.ai-inspector')?.classList.contains('is-overlay')")
    const name = 'ai-chat-narrow.png'
    await writeFile(
      join(root, name),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    screenshots.push(name)
    const sessionId = proposed.target.sessionId
    for (const mode of ['quota', 'unauthorized', 'interrupted'] as const) {
      modelMode = mode
      const c = aiConversationSchema.parse(await call('ai', 'open', { sessionId }))
      await call('ai', 'send', { conversationId: c.id, text: '验证错误反馈', attachments: [] })
      await wait(`return window.__aiSmoke?.id===${JSON.stringify(c.id)}&&window.__aiSmoke.status==='error'`)
      const failed = aiConversationSchema.parse(await js('return window.__aiSmoke'))
      assert.ok(failed.error)
      assert.ok(!failed.messages.some((m) => m.proposal))
      assert.equal(commands.length, 1)
    }
    modelMode = 'unsupported'
    assert.equal(
      await call('ai', 'test').then(
        () => false,
        (e) => e.code === 'AI_TOOL_UNSUPPORTED',
      ),
      true,
    )
    modelMode = 'normal'
    await call('ai', 'remove', { profileId })
    assert.deepEqual(await call('ai', 'history', { profileId }), [])
    return {
      passed: true,
      model: 'loopback-synthetic',
      ssh: 'loopback-synthetic',
      approvalRequired: true,
      duplicateRejected: true,
      outputAndExitCode: true,
      encryptedStorage: true,
      historyDeletion: true,
      quotaAndAuthErrors: true,
      incompleteStreamRejected: true,
      unsupportedToolsRejected: true,
      screenshots,
    }
  } finally {
    for (const s of await runtime.call<Array<{ id: string; profile_id: string }>>('session.list'))
      if (s.profile_id === profileId) await call('session', 'close', { id: s.id })
    if (profileId) await call('profile', 'delete', { id: profileId })
    await call('ai', 'configure', {
      source: 'official',
      protocol: 'chat',
      endpoint: '',
      model: '',
      apiKey: '',
    })
    for (const client of clients) client.end()
    await Promise.all([
      new Promise<void>((r) => ssh.close(() => r())),
      new Promise<void>((r) => http.close(() => r())),
    ])
    window.setContentSize(size[0], size[1])
    const loaded = once(window.webContents, 'did-finish-load')
    window.webContents.reload()
    await loaded
    await wait("return !!document.querySelector('.desktop-shell')")
  }
}
