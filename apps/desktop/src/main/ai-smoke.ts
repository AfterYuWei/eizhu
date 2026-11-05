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
    execCommands: string[] = [],
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
          channel.on('data', (data: Buffer) => {
            const script = data.toString()
            channel.write(script + '\r\n')
            if (!script.includes('\r') && !script.includes('\n') && !script.includes('\x03')) return
            const token = script.match(/eizhuAi;([\w-]+);start/)?.[1]
            if (token) {
              commands.push(script)
              channel.write(`\x1b]1337;eizhuAi;${token};start\x07`)
              const bytes = Buffer.from('你好 🧪\r\nsynthetic warning\r\n')
              channel.write(bytes.subarray(0, 2))
              channel.write(bytes.subarray(2))
              channel.write(`\x1b]1337;eizhuAi;${token};end;3\x07`)
            }
            channel.write('\x1b]7;file:///tmp\x07\x1b]1337;eizhuPrompt\x07')
            if (script.includes('__eizhu_osc7')) channel.write('\x1b]1337;eizhuOsc7Ready\x07')
            channel.write('$ ')
          })
        })
        s.on('exec', (accept, _reject, info) => {
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
      requests.push(body)
      assert.equal(req.headers.authorization, 'Bearer synthetic-ai-api-key')
      if (modelMode === 'quota' || modelMode === 'unauthorized') {
        res.writeHead(modelMode === 'quota' ? 429 : 401)
        res.end()
        return
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'synthetic-ai' }, { id: 'synthetic-second' }] }))
        return
      }
      assert.equal(req.url, '/v1/responses')
      const data = JSON.parse(body) as { input: Array<{ type?: string }> }
      const done = data.input.some((item) => item.type === 'function_call_output')
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const command = {
        command: "printf '你好'",
        cwd: '/tmp',
        purpose: '检查远端命令输出',
        impact: '只读，不修改服务器文件',
      }
      const text =
        modelMode === 'unsupported'
          ? '此模型仅支持文本'
          : done
            ? "## 检查结论\n\n命令退出码为 **3**，需要在当前终端继续核查。\n\n| 检查项 | 结果 |\n| --- | --- |\n| 命令状态 | 非零退出码 |\n| 后续操作 | 仍需逐条确认 |\n\n```sh\nprintf '检查完成'\n```"
            : '我会先检查命令输出。'
      const output = [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
        ...(!done && modelMode !== 'unsupported'
          ? [
              {
                type: 'function_call',
                call_id: 'synthetic-call',
                name: 'run_command',
                arguments: JSON.stringify(command),
              },
            ]
          : []),
      ]
      const payload = Buffer.from(
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n${modelMode === 'interrupted' ? '' : `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`}`,
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
    await wait("return !!document.querySelector('.desktop-shell')")
    await js(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))",
    )
    await wait("return [...document.querySelectorAll('[role=\"tab\"]')].some(t=>t.textContent==='AI 助手')")
    await js(
      "const tab=[...document.querySelectorAll('[role=\"tab\"]')].find(t=>t.textContent==='AI 助手');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
    )
    await wait("return !!document.querySelector('#ai-model')")
    assert.equal(
      await js('return document.querySelectorAll(\'.ai-settings button[role="combobox"]\').length'),
      2,
    )
    await js(
      "[...document.querySelectorAll('.ai-settings button')].find(b=>b.textContent==='自动发现模型').click()",
    )
    await wait("return document.querySelector('.ai-notice')?.textContent.includes('已发现 2 个模型')")
    await js(
      "const trigger=document.querySelector('#ai-model');trigger.focus();trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))",
    )
    await wait('return !!document.querySelector(\'[role="listbox"]\')')
    await js('await document.fonts.ready;await new Promise(r=>setTimeout(r,150))')
    const selectName = 'ai-settings-models.png'
    await writeFile(
      join(root, selectName),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    screenshots.push(selectName)
    await js(
      "const option=[...document.querySelectorAll('[role=\"option\"]')].find(o=>o.textContent==='synthetic-second');option.focus();option.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
    )
    await wait('return !document.querySelector(\'[role="listbox"]\')')
    await js(
      "[...document.querySelectorAll('.ai-settings button')].find(b=>b.textContent==='测试连接').click()",
    )
    await wait("return document.querySelector('.ai-notice')?.textContent.includes('连接成功')")
    assert.equal(commands.length, 0, 'Settings test never executes its proposed command')
    assert.equal(
      (await call<{ model: string }>('ai', 'settings')).model,
      'synthetic-ai',
      'Discovering and testing a draft must not save it',
    )
    const settingsName = 'ai-settings-responses.png'
    await writeFile(
      join(root, settingsName),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    screenshots.push(settingsName)
    await js("document.querySelector('.settings-page-back').click()")
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
      'return !!document.querySelector(\'button[aria-label="右侧栏"]\')&&!document.querySelector(\'[role="dialog"]\')',
    )
    await js('document.querySelector(\'button[aria-label="右侧栏"]\').click()')
    await wait("return !!document.querySelector('.shell-inspector-picker:not([hidden])')")
    window.setContentSize(1280, 800)
    await js('await document.fonts.ready;await new Promise(r=>setTimeout(r,150))')
    const sidebarFrame = await js<{
      gap: number
      topAligned: boolean
      heightAligned: boolean
      radius: number
      independent: boolean
    }>(
      "const main=document.querySelector('.shell-workspace'),pane=document.querySelector('.shell-inspector-picker');const a=main.getBoundingClientRect(),b=pane.getBoundingClientRect();return {gap:b.left-a.right,topAligned:Math.abs(a.top-b.top)<=1,heightAligned:Math.abs(a.height-b.height)<=1,radius:parseFloat(getComputedStyle(pane).borderRadius),independent:!main.contains(pane)}",
    )
    assert.ok(
      sidebarFrame.gap >= 7 &&
        sidebarFrame.topAligned &&
        sidebarFrame.heightAligned &&
        sidebarFrame.radius >= 12 &&
        sidebarFrame.independent,
    )
    const pickerName = 'right-sidebar-picker.png'
    await writeFile(
      join(root, pickerName),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    screenshots.push(pickerName)
    await js(
      "[...document.querySelectorAll('.shell-inspector-choices button')].find(b=>b.textContent==='AI').click()",
    )
    await wait("return !!window.__aiSmoke&&!!document.querySelector('.ai-composer textarea:not([disabled])')")
    await js(
      "const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'检查命令输出');input.dispatchEvent(new Event('input',{bubbles:true}))",
    )
    await js('document.querySelector(\'.ai-composer button[aria-label="发送"]\').click()')
    await wait(
      "return window.__aiSmoke?.status==='awaiting_confirmation'&&!!document.querySelector('.ai-composer .ai-approval')",
    )
    assert.equal(commands.length, 0, 'No AI terminal input before user confirmation')
    const proposed = aiConversationSchema.parse(await js('return window.__aiSmoke'))
    const proposalId = proposed.messages.at(-1)!.proposal!.id
    assert.equal(await js("return document.querySelectorAll('.ai-messages .ai-approval').length"), 0)
    assert.equal(await js("return document.querySelectorAll('.ai-composer textarea').length"), 0)
    assert.equal(await js("return document.querySelectorAll('.ai-approval input').length"), 0)
    await js('document.querySelector(\'.ai-approval button[aria-label="复制命令"]\').click()')
    await wait(
      `return window.eizhu.clipboard.read().then(text=>text===${JSON.stringify(proposed.messages.at(-1)!.proposal!.command)})`,
    )
    assert.equal(
      await js("return document.querySelectorAll('.ai-command-heading button').length"),
      0,
      'Copy belongs to the code block rather than the whole card',
    )
    assert.equal(commands.length, 0, 'Copying a code block must not execute the command')
    await wait('return !document.querySelector(\'.ai-code-block [role="status"]\')')
    await js('document.activeElement?.blur();await new Promise(r=>setTimeout(r,100))')
    const approvalName = 'ai-chat-approval.png'
    await writeFile(
      join(root, approvalName),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    screenshots.push(approvalName)
    await js(
      "[...document.querySelectorAll('.ai-approval button')].find(b=>b.textContent==='允许执行').click()",
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
    assert.equal(result.stdout, '你好 🧪\r\nsynthetic warning\r\n')
    assert.equal(result.stderr, '')
    assert.ok(
      execCommands.every((command) => !command.includes('eizhuAi') && !command.startsWith('cd -- ')),
      'AI must reuse the current shell instead of opening an exec channel',
    )
    assert.equal(await js("return document.querySelector('.ai-command').open"), false)
    assert.equal(await js("return document.querySelectorAll('.ai-approval,.ai-result').length"), 0)
    assert.ok(await js("return !!document.querySelector('.ai-composer textarea')"))
    assert.ok(
      await js(
        "return !/你好 🧪|synthetic warning/.test(document.querySelector('.ai-messages').textContent)",
      ),
      'Raw terminal output must not be repeated in chat',
    )
    assert.equal(await js("return document.querySelectorAll('.ai-message-role').length"), 1)
    assert.equal(await js("return document.querySelectorAll('.ai-reply-actions').length"), 0)
    assert.equal(await js("return document.querySelectorAll('.ai-message.is-assistant').length"), 1)
    assert.ok(
      await js("return !document.querySelector('.ai-messages').textContent.includes('检查结论')"),
      'Post-command interpretation must not appear in chat',
    )
    assert.ok(
      await js<boolean>(
        "return ['.ai-message.is-assistant','.ai-command'].every(selector=>{const s=getComputedStyle(document.querySelector(selector));return parseFloat(s.borderTopWidth)===0&&parseFloat(s.borderBottomWidth)===0})",
      ),
      'AI content uses spacing and surfaces rather than internal divider lines',
    )
    assert.ok(commands[0].includes("cd -- '/tmp' && eval "))
    assert.ok(!commands[0].includes('exec sh -c'))
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
    await js(
      "document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.querySelector('.ai-messages').scrollTop=0;await new Promise(r=>setTimeout(r,100))",
    )
    const startName = 'ai-chat-start.png'
    await writeFile(
      join(root, startName),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    screenshots.push(startName)
    const transcriptOverflows = await js<boolean>(
      "const node=document.querySelector('.ai-messages');return node.scrollHeight-node.clientHeight>=48",
    )
    if (transcriptOverflows) {
      await wait('return !!document.querySelector(\'.ai-inspector button[aria-label="滚动到最新回复"]\')')
      await js('document.querySelector(\'.ai-inspector button[aria-label="滚动到最新回复"]\').click()')
    } else {
      assert.equal(
        await js('return !!document.querySelector(\'.ai-inspector button[aria-label="滚动到最新回复"]\')'),
        false,
      )
    }
    window.setContentSize(900, 720)
    await wait("return document.querySelector('.ai-inspector')?.classList.contains('is-overlay')")
    const name = 'ai-chat-narrow.png'
    await writeFile(
      join(root, name),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    screenshots.push(name)
    await js('document.querySelector(\'.ai-inspector button[aria-label="切换侧栏内容"]\').click()')
    await js(
      "[...document.querySelectorAll('.shell-inspector-choices button')].find(b=>b.textContent==='SFTP').click()",
    )
    await wait(
      "return !!document.querySelector('.shell-inspector:not([hidden]) .sdetail-pane')&&document.querySelector('.ai-inspector').hidden",
    )
    await js(
      'document.querySelector(\'.shell-inspector:not([hidden]) button[aria-label="切换侧栏内容"]\').click()',
    )
    await js(
      "[...document.querySelectorAll('.shell-inspector-choices button')].find(b=>b.textContent==='AI').click()",
    )
    await wait(
      "return !document.querySelector('.ai-inspector').hidden&&document.querySelector('.ai-command')?.textContent.includes('退出码 3')",
    )
    assert.equal(commands.length, 1, 'Switching sidebar content must retain the conversation without replay')
    const sessionId = proposed.target.sessionId
    const blocked = aiConversationSchema.parse(await call('ai', 'open', { sessionId }))
    await call('ai', 'send', { conversationId: blocked.id, text: '验证终端输入占用', attachments: [] })
    await wait(
      `return window.__aiSmoke?.id===${JSON.stringify(blocked.id)}&&window.__aiSmoke.status==='awaiting_confirmation'`,
    )
    const blockedProposal = aiConversationSchema
      .parse(await js('return window.__aiSmoke'))
      .messages.at(-1)!.proposal!
    await call('session', 'input', { id: sessionId, data: 'unfinished-input' })
    await call('ai', 'decide', { proposalId: blockedProposal.id, accepted: true })
    await wait(
      `return window.__aiSmoke?.id===${JSON.stringify(blocked.id)}&&window.__aiSmoke.status==='error'`,
    )
    assert.ok(aiConversationSchema.parse(await js('return window.__aiSmoke')).error.includes('未提交输入'))
    assert.equal(commands.length, 1, 'AI must not append commands to pending manual terminal input')
    await call('session', 'input', { id: sessionId, data: '\x03' })
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
      currentTerminalExecution: true,
      pendingTerminalInputBlocked: true,
      encryptedStorage: true,
      historyDeletion: true,
      quotaAndAuthErrors: true,
      responsesOnly: true,
      settingsDiscoveryAndTest: true,
      sharedSettingsSelect: true,
      incompleteStreamRejected: true,
      unsupportedToolsRejected: true,
      codeBlockCopyOnly: true,
      borderlessAiContent: true,
      sharedSidebar: sidebarFrame,
      screenshots,
    }
  } finally {
    for (const s of await runtime.call<Array<{ id: string; profile_id: string }>>('session.list'))
      if (s.profile_id === profileId) await call('session', 'close', { id: s.id })
    if (profileId) await call('profile', 'delete', { id: profileId })
    await call('ai', 'configure', {
      source: 'official',
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
