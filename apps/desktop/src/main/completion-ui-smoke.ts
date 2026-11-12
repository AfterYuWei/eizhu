import { once } from 'node:events'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { RuntimeHost } from './runtime-host.ts'

/** Actual xterm input and popup rendering against the Stage 3 loopback fixtures. */
export async function verifyCompletionUi(
  window: BrowserWindow,
  runtime: RuntimeHost,
  sessionId: string,
  root: string,
  receivedInputs: string[],
  dropFileChannel: () => void,
) {
  const js = <T = unknown>(source: string, data?: unknown): Promise<T> =>
    window.webContents.executeJavaScript(`(async d=>{${source}})(${JSON.stringify(data)})`)
  const wait = async (read: () => Promise<boolean>, label: string) => {
    for (let i = 0; i < 200; i++) {
      if (await read()) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Completion UI timeout: ' + label)
  }
  const originalSize = window.getContentSize()
  const originalTheme = await js<string>('return document.documentElement.className')
  const snapshot = await js('return window.__stage3')
  const previousIds = new Set((await runtime.call<Array<{ id: string }>>('session.list')).map((s) => s.id))
  let uiSession: string | undefined
  const screenshots: string[] = []
  try {
    const loaded = once(window.webContents, 'did-finish-load')
    window.webContents.reload()
    await loaded
    await wait(
      () =>
        js<boolean>(
          `return [...document.querySelectorAll('.srv')].some(row=>row.title.startsWith('阶段 3 合成服务 ·'))`,
        ),
      'fixture profile loaded',
    )
    await js('window.__stage3=d', snapshot)
    // Reload replaces the original subscriber; retain its synthetic evidence and restore live delivery.
    await js(
      `return window.eizhu.session.subscribe({id:d},async message=>{const s=window.__stage3;s.messages.push(message);if(message.type==='output')s.output+=message.data;if(message.type==='connection_state')s.states.push(message.payload)})`,
      sessionId,
    )
    await js(
      `const row=[...document.querySelectorAll('.srv')].find(row=>row.title.startsWith('阶段 3 合成服务 ·'));row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    )
    await wait(async () => {
      const sessions = await runtime.call<Array<{ id: string; status: string }>>('session.list')
      const session = sessions.find((s) => !previousIds.has(s.id) && s.status === 'connected')
      uiSession = session?.id
      return Boolean(session)
    }, 'UI SSH session connected')
    await wait(
      () =>
        js<boolean>(
          `return !!document.querySelector('.xterm-helper-textarea')&&!document.querySelector('[role="dialog"][data-state="open"]')`,
        ),
      'terminal ready',
    )
    window.webContents.backgroundThrottling = false
    window.focus()
    window.webContents.focus()
    const key = (keyCode: string, modifiers: Array<'control'> = []) => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }
    const type = async (input: string, expected: string) => {
      await js(`document.querySelector('.xterm-helper-textarea').focus()`)
      const interruptOffset = receivedInputs.length
      key('C', ['control'])
      await wait(async () => receivedInputs.slice(interruptOffset).join('').includes('\x03'), input + ' interrupt delivered')
      const inputOffset = receivedInputs.length
      await window.webContents.insertText(input)
      await wait(async () => receivedInputs.slice(inputOffset).join('').includes(input), input + ' input delivered')
      await wait(
        () =>
          js<boolean>(
            `const p=document.querySelector('.xctrl-completion-panel');if(!p||!p.textContent.includes(d))return false;const r=p.getBoundingClientRect();return getComputedStyle(p).visibility==='visible'&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1`,
            expected,
          ),
        input,
      )
    }
    const capture = async (name: string) => {
      await writeFile(
        join(root, name),
        (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
      )
      screenshots.push(name)
    }
    // Exercise the CWD event through the real renderer and inspector, including
    // the initial directory emitted before the connection-ready metadata.
    await js(`document.querySelector('button[aria-label="右侧栏"]').click()`)
    await js(`[...document.querySelectorAll('.shell-inspector-choices button')].find(b=>b.textContent==='SFTP').click()`)
    await wait(
      () => js<boolean>(`return document.querySelector('.sdetail-pane[aria-hidden="false"] .sdetail-file-path')?.textContent==='/tmp/stage3'&&!!document.querySelector('button[title="自动跟随已开启：点击关闭"]')`),
      'inspector follows initial shell directory',
    )
    await runtime.call('session.input', { id: uiSession, data: 'cd /tmp/stage3-project\r' })
    await wait(
      () => js<boolean>(`return document.querySelector('.sdetail-pane[aria-hidden="false"] .sdetail-file-path')?.textContent==='/tmp/stage3-project'&&document.querySelector('.sdetail-file-area')?.getAttribute('aria-busy')==='false'`),
      'inspector follows shell cd',
    )
    await capture('server-detail-follow-cwd.png')
    await js(`document.querySelector('.sdetail-pane[aria-hidden="false"] button[title="自动跟随已开启：点击关闭"]').click()`)
    dropFileChannel()
    await js(`document.querySelector('.sdetail-pane[aria-hidden="false"] button[title="刷新"]').click()`)
    await wait(() => js<boolean>(`return document.querySelector('.sdetail-pane[aria-hidden="false"] [role="status"]')?.textContent.includes('自动重连')`), 'inspector detects closed SFTP channel')
    await wait(() => js<boolean>(`return !document.querySelector('.sdetail-pane[aria-hidden="false"] .sdetail-file-error')&&document.querySelector('.sdetail-pane[aria-hidden="false"] .sdetail-file-path')?.textContent==='/tmp/stage3-project'&&document.querySelector('.sdetail-pane[aria-hidden="false"] .sdetail-file-area')?.getAttribute('aria-busy')==='false'`), 'inspector automatically reconnects at original directory')
    await capture('server-detail-auto-reconnected.png')
    await js(`document.querySelector('.shell-inspector:not([hidden]) button[aria-label="关闭右侧栏"]').click()`)
    let cases = 0
    for (const command of [
      'git',
      'docker',
      'kubectl',
      'npm',
      'ls',
      'cd',
      'cat',
      'grep',
      'find',
      'ssh',
      'systemctl',
      'vim',
      'vi',
      'nano',
      'less',
      'tail',
      'head',
      'cp',
      'mv',
      'rm',
      'touch',
      'mkdir',
      'chmod',
      'chown',
      'tar',
      'source',
      'bash',
    ]) {
      await type(command.slice(0, 2), command)
      cases++
    }
    for (const [input, expected] of [
      ['git ', 'checkout'],
      ['docker ', 'compose'],
      ['kubectl ', 'rollout'],
      ['npm ', 'install'],
      ['systemctl ', 'restart'],
    ]) {
      await type(input, expected)
      cases++
    }
    for (const [input, expected, suffix] of [
      ['git checkout fe', 'feature/stage3', 'ature/stage3'],
      ['git remote remove or', 'origin', 'igin'],
      ['docker logs we', 'web', 'b'],
      ['kubectl get pods we', 'web', 'b'],
      ['kubectl config use-context pr', 'prod', 'od'],
      ['systemctl start wo', 'worker.service', 'rker.service'],
      ['systemctl status ap', 'app.service', 'p.service'],
      ['systemctl is-failed br', 'broken.service', 'oken.service'],
      ['npm run bu', 'build:qa', 'ild\\:qa'],
      ['git -C /other-repo checkout fe', 'feature/other', 'ature/other'],
      ['docker -H tcp://qa.invalid:2375 logs qa', 'qa-web', '-web'],
      ['kubectl --kubeconfig=/tmp/qa-config get pods co', 'config-web', 'nfig-web'],
      ['systemctl --user start us', 'user-app.service', 'er-app.service'],
    ]) {
      await type(input, expected)
      const offset = receivedInputs.length
      key('Down')
      key('Return')
      await wait(
        () => js<boolean>(`return !document.querySelector('.xctrl-completion-panel')`),
        input + ' applied',
      )
      await wait(async () => receivedInputs.slice(offset).join('').includes(suffix), input + ' remote insertion')
      cases++
    }
    await js(`document.documentElement.classList.remove('dark');document.documentElement.classList.add('light')`)
    await type('docker logs we', 'web')
    await capture('completion-docker-light.png')
    await type('docker -H tcp://qa.invalid:2375 logs qa', 'qa-web')
    await capture('completion-context-host.png')
    await js(
      `document.documentElement.classList.remove('light');document.documentElement.classList.add('dark')`,
    )
    await type('kubectl get pods we', 'web')
    await capture('completion-kubectl-dark.png')
    window.setContentSize(900, 650)
    await wait(() => js<boolean>('return innerWidth===900'), 'narrow viewport')
    await type('npm run bu', 'build:qa')
    await capture('completion-npm-narrow.png')
    for (const command of [
      'cd',
      'ls',
      'cat',
      'less',
      'more',
      'head',
      'tail',
      'vi',
      'vim',
      'nano',
      'rm',
      'cp',
      'mv',
      'touch',
      'chmod',
      'chown',
      'find',
      'grep',
      'mkdir',
      'rmdir',
      'tar',
      'unzip',
      'source',
      'bash',
      'sh',
    ]) {
      // insertText commits Unicode through the renderer input path, without a native IME candidate window.
      await type(command + ' 子', '子目录/')
      cases++
    }
    await capture('completion-path-narrow.png')
    await type('cd 子', '子目录/')
    key('Right')
    await wait(() => js<boolean>(`return !!document.querySelector('.xctrl-completion-panel [data-selected="true"]')`), 'cascade selects first directory')
    key('Right')
    await wait(() => js<boolean>(`return document.querySelector('.xctrl-completion-panel')?.children.length===2`), 'cascade opens child directory')
    await capture('completion-cascade-narrow.png')
    cases++
    key('Escape')
    await wait(
      () => js<boolean>(`return !document.querySelector('.xctrl-completion-panel')`),
      'Escape dismisses',
    )
    // Verify the production hook, settings UI and persistence together over the same SSH port.
    await runtime.call('session.input', { id: uiSession, data: 'terminal-colors-smoke\r' })
    await wait(() => js<boolean>(`return document.querySelectorAll('.xterm-decoration').length===0`), 'terminal has no command strips')
    await capture('terminal-highlighting-shell.png')
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))`)
    await wait(() => js<boolean>(`return [...document.querySelectorAll('[role="tab"]')].some(tab=>tab.textContent==='终端')`), 'terminal settings available')
    await js(`const tab=[...document.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='终端');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    await wait(() => js<boolean>(`return !document.querySelector('#settings-terminal-command-marker')&&document.querySelector('#settings-terminal-log-highlight')?.getAttribute('aria-checked')==='false'`), 'command strip setting removed and log default preserved')
    await js(`document.querySelector('#settings-terminal-log-highlight').click()`)
    await wait(() => js<boolean>(`return document.querySelectorAll('.xterm-decoration').length===3&&document.querySelectorAll('.eizhu-command-marker').length===0`), 'log levels decorated without command strips')
    await js(`document.querySelector('#settings-terminal-log-highlight').click()`)
    await wait(() => js<boolean>(`return document.querySelectorAll('.xterm-decoration').length===0`), 'original colors restored')
    await wait(async () => {
      const values = await runtime.call<Record<string, string>>('settings.read')
      const state = JSON.parse(values['eizhu-settings']).state
      return state.terminalLogHighlight === false
    }, 'highlight preferences persisted')
    await capture('terminal-highlighting-settings.png')
    await js(`document.querySelector('.settings-page-back').click()`)
    await wait(() => js<boolean>(`return !document.querySelector('.settings-page')&&document.querySelectorAll('.xterm-decoration').length===0`), 'terminal retained without command strips after settings')
    // Use the actual menu and xterm input path; direct session.input bypasses its readiness guard.
    for (let attempt = 0; attempt < 2; attempt++) {
      await js(`document.querySelector('button[aria-label="更多操作"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',bubbles:true}))`)
      await wait(() => js<boolean>(`return [...document.querySelectorAll('[role="menuitem"]')].some(item=>item.textContent==='重新连接')`), 'reconnect menu available')
      await js(`[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='重新连接').click()`)
      await wait(() => js<boolean>(`return !!document.querySelector('.connection-status')`), 'reconnect started')
      await wait(() => js<boolean>(`const label=document.querySelector('.shell-tab.is-active [role="tab"]')?.getAttribute('aria-label');return !document.querySelector('.connection-status')&&(label?.includes('已连接')||label?.endsWith(' ms'))`), 'reconnected terminal ready')
      await type('git', 'git')
      key('Escape')
      const offset = receivedInputs.length
      key('Enter')
      await wait(async () => receivedInputs.slice(offset).join('').includes('\r'), 'reconnected command submitted')
    }
    // Populate scrollback, then inspect the painted scrollbar geometry in both themes.
    await runtime.call('session.input', { id: uiSession, data: 'burst' })
    await wait(() => js<boolean>(`const bar=document.querySelector('.xterm .scrollbar.vertical');const thumb=bar?.querySelector('.slider')?.getBoundingClientRect();return !!thumb&&thumb.height>0&&thumb.height<bar.getBoundingClientRect().height/2`), 'terminal scrollback rendered')
    await js(`document.querySelector('.xterm').dispatchEvent(new WheelEvent('wheel',{deltaY:100000,bubbles:true}))`)
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.className=d`, theme)
      const geometry = await js<{ native: string; thumb: number; radius: string; hidden: string }>(`
        const probe=document.createElement('div');probe.style.cssText='width:160px;height:100px;overflow:scroll';document.body.append(probe);
        const native=getComputedStyle(probe,'::-webkit-scrollbar').width;
        const slider=document.querySelector('.xterm .scrollbar.vertical .slider');const style=getComputedStyle(slider);
        const thumb=slider.getBoundingClientRect().width-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth);
        const radius=style.borderRadius;const hidden=getComputedStyle(document.querySelector('.shell-tab-scroll')).scrollbarWidth;
        probe.remove();return {native,thumb,radius,hidden};
      `)
      assert.equal(geometry.native, '8px')
      assert.equal(geometry.thumb, 6)
      assert.equal(geometry.radius, '999px')
      assert.equal(geometry.hidden, 'none')
      await js(`document.querySelector('.xterm-scrollable-element').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await new Promise(resolve=>setTimeout(resolve,150))`)
      await capture(`scrollbar-terminal-${theme}.png`)
    }
    return {
      passed: true,
      cases,
      commandPrefixes: 27,
      commandFamilies: 5,
      dynamicSelections: 13,
      fileCommands: 25,
      screenshots,
      syntheticRemote: true,
      serverDetailFollowCwd: true,
      serverDetailAutoReconnect: true,
      nativeIme: false,
      terminalHighlighting: true,
      terminalCommandStripsRemoved: true,
      reconnectInput: true,
      reconnectAttempts: 2,
      roundedScrollbars: true,
    }
  } catch (error) {
    const state = await js(`const p=document.querySelector('.xctrl-completion-panel');return {focus:document.activeElement?.className,popup:p?.textContent,rect:p?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight]}`)
    console.error('EIZHU_COMPLETION_UI_FAILED', JSON.stringify({ state, inputs: receivedInputs.slice(-8) }))
    await writeFile(join(root, 'completion-ui-failed.png'), (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG())
    throw error
  } finally {
    await js(`document.querySelector('.settings-page-back')?.click()`)
    await js(
      `document.documentElement.className=d;document.querySelector('.shell-tab.is-active .shell-tab-close')?.click()`,
      originalTheme,
    )
    if (uiSession) await runtime.call('session.close', { id: uiSession })
    window.setContentSize(originalSize[0], originalSize[1])
  }
}
