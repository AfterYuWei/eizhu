/* eslint-disable no-control-regex -- Terminal/protocol boundaries handle control bytes explicitly. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile, readdir, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Server, utils } from 'ssh2'
import type { Connection } from 'ssh2'
import type { AddressInfo } from 'node:net'
import type { BrowserWindow } from 'electron'
import type { RuntimeHost } from './runtime-host.ts'
import { aiConversationSchema, aiSettingsSchema } from '@eizhu/contracts'
import { modelFixture } from '@eizhu/core/agent/model-fixture'

/** Explicit loopback services; exercises the real Electron/Worker/SQLite/SSH chain. */
export async function verifyAiDesktop(window: BrowserWindow, runtime: RuntimeHost, root: string) {
  const clients = new Set<Connection>(),
    commands: string[] = [],
    execCommands: string[] = [],
    screenshots: string[] = [],
    profiles: string[] = [],
    conversations: string[] = []
  const sftpServer = [
    '/usr/libexec/sftp-server',
    '/usr/lib/openssh/sftp-server',
    '/usr/lib/ssh/sftp-server',
  ].find(existsSync)
  const remoteDirectory = join(await realpath(root), 'ai-remote-files'),
    remoteFile = join(remoteDirectory, '配置.conf')
  await mkdir(remoteDirectory, { recursive: true })
  await writeFile(remoteFile, '# original\nport=22\n')
  let mode: 'normal' | 'interrupted' | 'long' | 'quota' | 'unauthorized' | 'file' = 'normal'
  let targetIds: string[] = []
  const generated = utils.generateKeyPairSync('ed25519'),
    parsed = utils.parseKey(generated.private)
  assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed))
  const fingerprint =
    'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  const ssh = new Server({ hostKeys: [generated.private] }, (client) => {
    clients.add(client)
    client.on('error', () => undefined)
    client.once('close', () => clients.delete(client))
    client.on('authentication', (ctx) =>
      ctx.method === 'password' && ctx.password === 'synthetic-ai-ssh-password' ? ctx.accept() : ctx.reject(),
    )
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (accept) => accept?.())
        session.on('shell', (accept) => {
          const channel = accept()
          channel.on('error', () => undefined)
          channel.write('$ ')
          channel.on('data', (bytes: Buffer) => {
            const script = bytes.toString()
            channel.write(script + '\r\n')
            if (!/[\r\n\x03]/.test(script)) return
            const token = script.match(/eizhuAi;([\w-]+);start/)?.[1]
            if (token) {
              commands.push(script)
              channel.write('\x1b]1337;eizhuAi;' + token + ';start\x07')
              channel.write('你好 🧪\r\nsynthetic warning\r\n')
              if (mode !== 'long') channel.write('\x1b]1337;eizhuAi;' + token + ';end;3\x07')
              else return
            }
            channel.write('\x1b]7;file:///tmp\x07\x1b]1337;eizhuPrompt\x07')
            if (script.includes('__eizhu_osc7')) channel.write('\x1b]1337;eizhuOsc7Ready\x07')
            channel.write('$ ')
          })
        })
        session.on('subsystem', (accept, reject, info) => {
          if (info.name !== 'sftp' || !sftpServer) {
            reject()
            return
          }
          const channel = accept(),
            child = spawn(sftpServer, ['-d', remoteDirectory], { stdio: 'pipe' })
          child.stderr.on('data', () => undefined)
          child.on('error', () => channel.destroy())
          channel.on('error', () => undefined)
          channel.once('close', () => child.kill())
          child.once('close', () => channel.end())
          channel.pipe(child.stdin)
          child.stdout.pipe(channel)
        })
        session.on('exec', (accept, _reject, info) => {
          execCommands.push(info.command)
          const channel = accept()
          channel.on('error', () => undefined)
          channel.write('/bin/bash\n')
          channel.exit(0)
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
      if (mode === 'quota' || mode === 'unauthorized') {
        res.writeHead(mode === 'quota' ? 429 : 401)
        res.end()
        return
      }
      const protocol = req.url?.split('/')[1]
      assert.ok(protocol === 'responses' || protocol === 'chat' || protocol === 'anthropic')
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'synthetic-ai', name: '合成模型' }] }))
        return
      }
      const data = JSON.parse(body)
      const forced = typeof data.tool_choice === 'object'
      const nativeCalls = Array.isArray(data.input)
        ? data.input.filter((item: { type?: string }) => item.type === 'function_call')
        : []
      const executed = nativeCalls.filter((item: { name: string }) => item.name === 'terminal_execute')
      const next = targetIds[executed.length]
      const fileResult = Array.isArray(data.input)
        ? data.input.find((item: { type?: string }) => item.type === 'function_call_output')
        : undefined
      const fileVersion = mode === 'file' && fileResult ? JSON.parse(fileResult.output).version : undefined
      const calls =
        mode === 'file'
          ? !nativeCalls.length
            ? [{ id: randomUUID(), name: 'file_read', args: { sessionId: targetIds[0], path: remoteFile } }]
            : nativeCalls.length === 1
              ? [
                  {
                    id: randomUUID(),
                    name: 'file_edit',
                    args: {
                      sessionId: targetIds[0],
                      path: remoteFile,
                      version: fileVersion,
                      oldText: 'port=22',
                      newText: 'port=2222',
                    },
                  },
                ]
              : []
          : forced
            ? [{ id: randomUUID(), name: 'session_info', args: {} }]
            : mode === 'long'
              ? [
                  {
                    id: randomUUID(),
                    name: 'terminal_start',
                    args: {
                      sessionId: targetIds[0],
                      command: 'sleep 30',
                      cwd: '/tmp',
                      purpose: '长任务中断验收',
                      impact: '合成服务',
                      timeoutSeconds: 60,
                    },
                  },
                ]
              : !nativeCalls.length
                ? [{ id: randomUUID(), name: 'session_info', args: {} }]
                : next
                  ? [
                      {
                        id: randomUUID(),
                        name: 'terminal_execute',
                        args: {
                          sessionId: next,
                          command: "printf '你好'",
                          cwd: '/tmp',
                          purpose: '检查终端输出',
                          impact: '只读查询',
                          timeoutSeconds: 60,
                        },
                      },
                    ]
                  : []
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const payload = Buffer.from(
        modelFixture(
          protocol,
          calls.length
            ? '准备检查当前连接。'
            : '## 检查完成\n\n两个连接已完成检查，退出码为3，请核查服务状态。',
          calls,
          mode !== 'interrupted',
        ),
      )
      res.write(payload.subarray(0, 17))
      res.end(payload.subarray(17))
    })
  })
  const js = <T = unknown>(source: string, data?: unknown): Promise<T> =>
    window.webContents.executeJavaScript('(async d=>{' + source + '})(' + JSON.stringify(data) + ')')
  const call = <T = unknown>(domain: string, method: string, input?: unknown) =>
    js<T>('return window.eizhu[d.domain][d.method](d.input)', { domain, method, input })
  const wait = async (source: string) => {
    for (let i = 0; i < 240; i++) {
      if (await js<boolean>(source)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    await writeFile(join(root, 'ai-v2-failure.png'), (await window.webContents.capturePage()).toPNG())
    const state = await js(
      "return {status:window.__aiV2?.status,error:window.__aiV2?.error,backend:window.__aiV2?.backend,tools:window.__aiV2?.messages.filter(m=>m.tool).map(m=>({name:m.tool.name,state:m.tool.state,error:m.tool.error})),buttons:[...document.querySelectorAll('.ai-composer button')].map(b=>({text:b.textContent,disabled:b.disabled}))}",
    )
    throw new Error('AI v2 smoke timeout: ' + source + ' ' + JSON.stringify(state))
  }
  const snapshot = () => js('return window.__aiV2')
  const read = async () => aiConversationSchema.parse(await snapshot())
  const size = window.getContentSize()
  try {
    ssh.listen(0, '127.0.0.1')
    http.listen(0, '127.0.0.1')
    await Promise.all([once(ssh, 'listening'), once(http, 'listening')])
    const sshPort = (ssh.address() as AddressInfo).port,
      httpPort = (http.address() as AddressInfo).port
    await call('ai', 'setEnabled', { enabled: true })
    for (const protocol of ['responses', 'chat', 'anthropic']) {
      const provider = {
        id: protocol,
        name: '合成 ' + protocol,
        protocol,
        endpoint: 'http://127.0.0.1:' + httpPort + '/' + protocol + '/v1',
        model: 'synthetic-ai',
        contextWindow: 64000,
        apiKey: 'synthetic-ai-api-key',
        clearKey: false,
      }
      const settings = aiSettingsSchema.parse(await call('ai', 'configure', provider))
      assert.ok(!JSON.stringify(settings).includes('synthetic-ai-api-key'))
      await call('ai', 'discover', provider)
      await call('ai', 'test', provider)
      assert.equal(commands.length, 0)
    }
    await call('ai', 'setDefault', { kind: 'custom', providerId: 'responses', model: 'synthetic-ai' })
    await js(
      "window.__aiV2=null;window.eizhu.events.on('eizhu-ai-message',e=>{if(e.conversation)window.__aiV2=e.conversation})",
    )
    const names = ['AI v2 主机A', 'AI v2 主机B']
    for (const name of names) {
      const p = await call<{ id: string }>('profile', 'create', {
        request: {
          name,
          host: '127.0.0.1',
          port: sshPort,
          username: 'synthetic',
          auth_type: 'password',
          password: 'synthetic-ai-ssh-password',
        },
      })
      profiles.push(p.id)
    }
    const loaded = once(window.webContents, 'did-finish-load')
    window.webContents.reload()
    await loaded
    await wait("return !!document.querySelector('.desktop-shell')")
    await js(
      "window.__aiV2=null;window.eizhu.events.on('eizhu-ai-message',e=>{if(e.conversation)window.__aiV2=e.conversation})",
    )
    for (let i = 0; i < names.length; i++) {
      const name = names[i],
        profileId = profiles[i]
      await wait(
        "return [...document.querySelectorAll('.srv')].some(r=>r.title.startsWith(" +
          JSON.stringify(name + ' ·') +
          '))',
      )
      await js(
        "const row=[...document.querySelectorAll('.srv')].find(r=>r.title.startsWith(d));row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
        name + ' ·',
      )
      await wait(
        "const trust=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='信任并继续');if(trust){trust.click();return false}return window.eizhu.session.list().then(rows=>rows.some(r=>r.profile_id===" +
          JSON.stringify(profileId) +
          "&&r.status==='connected'))",
      )
    }
    await wait(
      "for(const dialog of document.querySelectorAll('.connection-dialog'))[...dialog.querySelectorAll('button')].find(b=>b.textContent==='关闭')?.click();return !document.querySelector('.connection-dialog')",
    )
    const sessions = await runtime.call<Array<{ id: string; profile_id: string }>>('session.list')
    targetIds = profiles.map((p) => sessions.find((s) => s.profile_id === p)!.id)
    await js("document.querySelector('button[aria-label=右侧栏]').click()")
    await wait("return !!document.querySelector('.shell-inspector-picker:not([hidden])')")
    await js(
      "[...document.querySelectorAll('.shell-inspector-choices button')].find(b=>b.textContent==='AI').click()",
    )
    await wait("return !!document.querySelector('.ai-composer textarea')")
    await js(
      "[...document.querySelectorAll('.ai-session-controls button')].find(b=>b.textContent.startsWith('连接范围')).click()",
    )
    await js("document.querySelectorAll('.ai-scope input').forEach(b=>{if(!b.checked)b.click()})")
    await js(
      "[...document.querySelectorAll('.ai-scope button')].find(b=>b.textContent==='应用连接范围').click()",
    )
    await js(
      "const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'合成验收：检查两个连接');input.dispatchEvent(new Event('input',{bubbles:true}))",
    )
    await js("[...document.querySelectorAll('.ai-composer button')].find(b=>b.textContent==='发送').click()")
    await wait(
      "return window.__aiV2?.status==='awaiting_confirmation'&&!!document.querySelector('.ai-approval')",
    )
    assert.equal(
      await js(
        "const s=document.querySelector('.ai-command-summary'),p=s.querySelector('.ai-command-purpose').getBoundingClientRect(),t=s.querySelector('.ai-command-status').getBoundingClientRect();return p.width>40&&p.bottom<=t.top+1",
      ),
      true,
    )
    const proposed = await read()
    conversations.push(proposed.id)
    assert.equal(proposed.targets.length, 2)
    assert.equal(commands.length, 0)
    assert.equal(await js("return document.querySelectorAll('.ai-messages .ai-approval').length"), 0)
    window.setContentSize(1280, 800)
    await js('await document.fonts.ready;await new Promise(r=>setTimeout(r,150))')
    await writeFile(join(root, 'ai-v2-approval.png'), (await window.webContents.capturePage()).toPNG())
    screenshots.push('ai-v2-approval.png')
    const pending = proposed.messages.findLast((m) => m.tool?.state === 'pending')!.tool!
    await js(
      "[...document.querySelectorAll('.ai-approval button')].find(b=>b.textContent==='允许本次').click()",
    )
    await assert.rejects(
      call('ai', 'decide', {
        conversationId: proposed.id,
        callId: pending.id,
        decision: 'once',
        revision: proposed.revision,
      }),
    )
    await wait(
      "return window.__aiV2?.messages.filter(m=>m.tool?.state==='completed'&&m.tool.name==='terminal_execute').length===1&&window.__aiV2?.status==='awaiting_confirmation'",
    )
    assert.equal(commands.length, 1)
    await js(
      "[...document.querySelectorAll('.ai-approval button')].find(b=>b.textContent==='允许本次').click()",
    )
    await wait("return window.__aiV2?.status==='idle'")
    assert.equal(commands.length, 2)
    const completed = await read()
    assert.ok(completed.messages.at(-1)?.text.includes('检查完成'))
    assert.ok(
      completed.messages.some(
        (m) => m.tool?.name === 'terminal_execute' && JSON.stringify(m.tool.result).includes('你好'),
      ),
    )
    assert.ok(!execCommands.some((c) => c.includes('eizhuAi;')))
    await wait("return !!document.querySelector('.ai-markdown h2')")
    for (const dark of [false, true]) {
      await js(
        "document.documentElement.classList.toggle('dark',d);await new Promise(r=>setTimeout(r,120))",
        dark,
      )
      const name = dark ? 'ai-v2-dark.png' : 'ai-v2-light.png'
      await writeFile(join(root, name), (await window.webContents.capturePage()).toPNG())
      screenshots.push(name)
    }
    window.setContentSize(900, 760)
    await js('await new Promise(r=>setTimeout(r,150))')
    await writeFile(join(root, 'ai-v2-narrow.png'), (await window.webContents.capturePage()).toPNG())
    screenshots.push('ai-v2-narrow.png')
    const beforeBusy = commands.length
    await call('session', 'input', { id: targetIds[0], data: 'unfinished-input' })
    const blocked = aiConversationSchema.parse(
      await call('ai', 'open', {
        sessionIds: [targetIds[0]],
        backend: { kind: 'custom', providerId: 'responses', model: 'synthetic-ai' },
      }),
    )
    conversations.push(blocked.id)
    await call('ai', 'send', { conversationId: blocked.id, text: '检查忙终端', attachments: [] })
    await wait(
      'return window.__aiV2?.id===' +
        JSON.stringify(blocked.id) +
        "&&window.__aiV2.status==='awaiting_confirmation'",
    )
    const approval = (await read()).messages.findLast((m) => m.tool?.state === 'pending')!.tool!
    await call('ai', 'decide', {
      conversationId: blocked.id,
      callId: approval.id,
      decision: 'once',
      revision: (await read()).revision,
    })
    await wait("return window.__aiV2?.status==='paused'")
    assert.equal(commands.length, beforeBusy)
    await call('session', 'input', { id: targetIds[0], data: '\x03' })
    mode = 'interrupted'
    const cut = aiConversationSchema.parse(
      await call('ai', 'open', {
        sessionIds: [targetIds[0]],
        backend: { kind: 'custom', providerId: 'responses', model: 'synthetic-ai' },
      }),
    )
    conversations.push(cut.id)
    await call('ai', 'send', { conversationId: cut.id, text: '验证断流', attachments: [] })
    await wait('return window.__aiV2?.id===' + JSON.stringify(cut.id) + "&&window.__aiV2.status==='error'")
    assert.ok(!(await read()).messages.some((m) => m.tool?.state === 'pending'))
    mode = 'long'
    const long = aiConversationSchema.parse(
      await call('ai', 'open', {
        sessionIds: [targetIds[0]],
        backend: { kind: 'custom', providerId: 'responses', model: 'synthetic-ai' },
      }),
    )
    conversations.push(long.id)
    await call('ai', 'permission', { conversationId: long.id, permission: 'auto' })
    await call('ai', 'send', { conversationId: long.id, text: '运行长任务等待中断', attachments: [] })
    await wait(
      'return window.__aiV2?.id===' +
        JSON.stringify(long.id) +
        "&&window.__aiV2.jobs.some(j=>j.status==='running')",
    )
    await call('ai', 'cancel', { conversationId: long.id })
    assert.ok((await read()).jobs.every((j) => j.status !== 'running'))
    if (sftpServer) {
      mode = 'file'
      for (const conflict of [true, false]) {
        const chat = aiConversationSchema.parse(
          await call('ai', 'open', {
            sessionIds: [targetIds[0]],
            backend: { kind: 'custom', providerId: 'responses', model: 'synthetic-ai' },
          }),
        )
        conversations.push(chat.id)
        await call('ai', 'send', { conversationId: chat.id, text: '修改远端配置', attachments: [] })
        await wait(
          'return window.__aiV2?.id===' +
            JSON.stringify(chat.id) +
            "&&window.__aiV2.status==='awaiting_confirmation'",
        )
        const pending = (await read()).messages.findLast((m) => m.tool?.state === 'pending')!.tool!
        assert.ok(pending.preview.includes('--- 修改前') && pending.preview.includes('port=2222'))
        if (conflict) await writeFile(remoteFile, '# externally changed\nport=22\n')
        await call('ai', 'decide', {
          conversationId: chat.id,
          callId: pending.id,
          revision: (await read()).revision,
          decision: 'once',
        })
        await wait(
          'return window.__aiV2?.id===' + JSON.stringify(chat.id) + "&&window.__aiV2.status==='idle'",
        )
        const result = (await read()).messages.find((m) => m.tool?.id === pending.id)!.tool!
        if (conflict) {
          assert.equal(result.state, 'failed')
          assert.equal(await readFile(remoteFile, 'utf8'), '# externally changed\nport=22\n')
        } else {
          assert.equal(result.state, 'completed')
          assert.equal(await readFile(remoteFile, 'utf8'), '# externally changed\nport=2222\n')
        }
      }
    }
    await js("document.querySelector('button[aria-label=AI设置]').click()")
    await wait("return !!document.querySelector('.ai-settings #ai-engine')")
    const chooseSetting = async (id: string, label: string) => {
      await wait(
        'const control=document.getElementById(' +
          JSON.stringify(id) +
          ');return !!control&&!control.disabled',
      )
      await js('document.getElementById(d).click()', id)
      await wait("return !!document.querySelector('[role=listbox]')")
      await js("[...document.querySelectorAll('[role=option]')].find(e=>e.textContent===d).click()", label)
    }
    const captureSetting = async (name: string) => {
      await wait("return !document.getElementById('ai-enabled').disabled")
      await js('await document.fonts.ready;await new Promise(r=>setTimeout(r,150))')
      assert.equal(
        await js(
          "const panel=document.querySelector('.ai-settings');return panel.scrollWidth<=panel.clientWidth+1&&[...panel.querySelectorAll('.settings-field')].every(row=>{const label=row.querySelector('.settings-field-info').getBoundingClientRect(),control=row.lastElementChild.getBoundingClientRect();return control.left>=label.right-1||control.top>=label.bottom-1})",
        ),
        true,
      )
      await writeFile(join(root, name), (await window.webContents.capturePage()).toPNG())
      screenshots.push(name)
    }
    window.setContentSize(1280, 900)
    await wait("return !!document.querySelector('#ai-key')")
    assert.equal(await js("return document.querySelectorAll('#ai-key').length"), 1)
    assert.equal(await js("return document.querySelectorAll('#ai-cli-path').length"), 0)
    await captureSetting('ai-settings-provider.png')
    await chooseSetting('ai-source', '新增供应商')
    await chooseSetting('ai-platform', 'DeepSeek')
    assert.equal(await js("return document.getElementById('ai-endpoint').value"), 'https://api.deepseek.com')
    assert.equal(await js("return document.getElementById('ai-protocol').textContent"), 'Chat Completions')
    assert.equal(await js("return document.getElementById('ai-key').value"), '')
    assert.equal(await js("return document.getElementById('ai-model').value"), '')
    assert.equal((await call<{ providers: unknown[] }>('ai', 'settings')).providers.length, 3)
    await captureSetting('ai-settings-platform-deepseek.png')
    await js("document.getElementById('ai-platform').click()")
    await wait("return !!document.querySelector('[role=listbox]')")
    assert.equal(await js("return document.querySelectorAll('[role=option]').length"), 12)
    await captureSetting('ai-settings-platform-options.png')
    await js(
      "[...document.querySelectorAll('[role=option]')].find(e=>e.textContent==='Anthropic（Claude）').click()",
    )
    await wait("return document.getElementById('ai-protocol').textContent==='Anthropic Messages'")
    assert.equal(
      await js("return document.getElementById('ai-endpoint').value"),
      'https://api.anthropic.com/v1',
    )
    window.setContentSize(900, 760)
    await captureSetting('ai-settings-platform-narrow.png')
    window.setContentSize(1280, 900)
    await chooseSetting('ai-source', '合成 responses')
    await chooseSetting('ai-engine', 'Codex')
    await wait("return !!document.querySelector('#ai-cli-path')&&!document.querySelector('#ai-key')")
    for (const dark of [false, true]) {
      await js("document.documentElement.classList.toggle('dark',d)", dark)
      await captureSetting(dark ? 'ai-settings-agent-dark.png' : 'ai-settings-agent-light.png')
    }
    window.setContentSize(900, 760)
    await captureSetting('ai-settings-agent-narrow.png')
    await js("document.getElementById('ai-enabled').click()")
    await wait("return !document.querySelector('#ai-engine')")
    assert.equal((await call<{ enabled: boolean }>('ai', 'settings')).enabled, false)
    await assert.rejects(
      call('ai', 'send', { conversationId: proposed.id, text: '关闭时不得运行', attachments: [] }),
    )
    assert.equal((await call<{ providers: unknown[] }>('ai', 'settings')).providers.length, 3)
    await captureSetting('ai-settings-disabled.png')
    await js("document.getElementById('ai-enabled').click()")
    await wait("return !!document.querySelector('#ai-engine')")
    await chooseSetting('ai-engine', '内置助手')
    await chooseSetting('ai-source', '合成 responses')
    await wait("return !!document.querySelector('#ai-key')")
    await js("document.querySelector('.settings-page-back').click()")
    for (const name of await readdir(root, { recursive: true })) {
      if (!/\.(sqlite|db)(-wal)?$/.test(name)) continue
      const bytes = await readFile(join(root, name))
      assert.ok(!bytes.includes(Buffer.from('synthetic-ai-api-key')))
      assert.ok(!bytes.includes(Buffer.from('合成验收：检查两个连接')))
    }
    const saved = aiConversationSchema.parse(await call('ai', 'read', { conversationId: proposed.id }))
    assert.equal(saved.id, proposed.id)
    assert.ok(fingerprint.startsWith('SHA256:'))
    return {
      passed: true,
      toolsetVersion: 2,
      protocols: ['responses', 'chat', 'anthropic'],
      multiSession: true,
      approvalRequired: true,
      duplicateRejected: true,
      currentTerminalExecution: true,
      pendingTerminalInputBlocked: true,
      finalAnswerRetained: true,
      stopCancelsLongTasks: true,
      incompleteStreamRejected: true,
      encryptedStorage: true,
      settingsSelectedConfiguration: true,
      settingsProviderPresets: true,
      settingsEnableSwitch: true,
      settingsResponsiveLayout: true,
      remoteFileConflictAndEdit: Boolean(sftpServer),
      sftp: sftpServer ? 'installed-openssh-subsystem' : 'unavailable',
      model: 'loopback-synthetic',
      ssh: 'loopback-synthetic',
      screenshots,
    }
  } finally {
    mode = 'normal'
    for (const conversationId of conversations) await call('ai', 'remove', { conversationId })
    for (const s of await runtime.call<Array<{ id: string; profile_id: string }>>('session.list'))
      if (profiles.includes(s.profile_id)) await call('session', 'close', { id: s.id })
    for (const id of profiles) await call('profile', 'delete', { id })
    for (const providerId of ['responses', 'chat', 'anthropic'])
      await call('ai', 'removeProvider', { providerId })
    await call('ai', 'setDefault', { kind: 'official', model: '' })
    for (const client of clients) client.end()
    await Promise.all([
      new Promise<void>((resolve) => ssh.close(() => resolve())),
      new Promise<void>((resolve) => http.close(() => resolve())),
    ])
    window.setContentSize(size[0], size[1])
    const loaded = once(window.webContents, 'did-finish-load')
    window.webContents.reload()
    await loaded
    await wait("return !!document.querySelector('.desktop-shell')")
  }
}
