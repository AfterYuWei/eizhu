import assert from 'node:assert/strict'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { Server, utils, type Connection } from 'ssh2'
import { verifyVaultLayout } from './vault-layout-smoke.ts'

/** Synthetic UI actions in the existing smoke window and its isolated data directory. */
export async function verifyWorkspaceTabs(window: BrowserWindow, root: string) {
  const js = <T = unknown>(source: string): Promise<T> => window.webContents.executeJavaScript(source)
  const wait = async (source: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js<boolean>(source)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Workspace tabs UI timeout: ${source}`)
  }
  const originalSize = window.getContentSize()
  window.webContents.backgroundThrottling = false
  const original = await js<{ theme: string; font: string }>(`({theme:document.documentElement.className,font:document.documentElement.style.getPropertyValue('--sans-size')})`)
  const tabCount = `document.querySelectorAll('.shell-tab-list [role="tab"]').length`
  assert.equal(await js(tabCount), 0, 'Workspace tabs smoke starts with an empty workspace')

  const screenshots: string[] = []
  const capture = async (name: string, theme: 'light' | 'dark') => {
    await js(`(async()=>{
      document.activeElement?.blur();
      document.documentElement.classList.remove('light','dark');document.documentElement.classList.add('${theme}');
      await document.fonts.ready;
      await new Promise(resolve=>setTimeout(resolve,250));
    })()`)
    await writeFile(join(root, name), (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG())
    screenshots.push(name)
  }
  try {
    window.setContentSize(1280, 720)
    const peers = new Set<Connection>()
    let terminalInput = ''
    const server = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, (client) => {
      peers.add(client)
      client.on('error', () => undefined)
      client.once('close', () => peers.delete(client))
      client.on('authentication', (request) => {
        if (request.method === 'password' && request.password === 'synthetic-first-connection') request.accept()
        else request.reject()
      })
      client.on('ready', () => client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (allow) => allow?.())
        session.on('shell', (allow) => {
          const channel = allow()
          channel.on('error', () => undefined)
          channel.on('data', (data: Buffer) => { terminalInput += data.toString('utf8') })
          channel.write('first-connection-ready\r\n')
        })
      }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const click = (label: string) => js(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`)
    let fixtureProfile: { id: string } | undefined
    try {
      await js(`document.querySelector('.shell-tab-add').click()`)
      await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent==='从备份导入')`)
      const draft = await js(`document.querySelector('.shell-tab-list [role="tab"]').id`)
      await click('从备份导入')
      await wait(`Boolean(document.querySelector('#backup-import-title'))`)
      await click('返回应用')
      await click('添加服务器')
      const fill = (id: string, value: string) => js(`(()=>{
        const input=document.getElementById(${JSON.stringify(id)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`)
      await fill('name', '首次连接合成服务')
      await fill('host', '127.0.0.1')
      await fill('port', String(address.port))
      await js(`[...document.querySelectorAll('.pf-tab-list [role="tab"]')].find(tab=>tab.textContent==='身份认证').focus()`)
      await fill('username', 'deploy')
      await fill('password', 'synthetic-first-connection')
      await click('保存并连接')
      await wait(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='仅本次信任')`)
      await click('仅本次信任')
      await wait(`window.eizhu.session.list().then(sessions=>sessions.some(session=>session.status==='connected'))`)
      await wait(`Boolean(document.querySelector('.xterm-helper-textarea'))&&!document.querySelector('.connection-status')`)
      window.focus()
      window.webContents.focus()
      await js(`document.querySelector('.xterm-helper-textarea').focus()`)
      await window.webContents.insertText('first-connection-input')
      for (let attempt = 0; attempt < 100 && !terminalInput.includes('first-connection-input'); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50))
      assert.ok(terminalInput.includes('first-connection-input'))
      assert.equal(await js(tabCount), 1)
      assert.equal(await js(`document.querySelector('.shell-tab-list [role="tab"]').id`), draft)
      fixtureProfile = await js(`window.eizhu.profile.list({groupId:null,search:'首次连接合成服务'}).then(rows=>rows[0])`)
      assert.ok(fixtureProfile)
    } finally {
      try {
        await js(`document.querySelector('.shell-tab-close')?.click()`)
        await wait(`${tabCount}===0`)
        if (fixtureProfile) await js(`window.eizhu.profile.delete({id:${JSON.stringify(fixtureProfile.id)}})`)
      } finally {
        for (const peer of peers) peer.end()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
    const reloaded = once(window.webContents, 'did-finish-load')
    window.webContents.reload()
    await reloaded
    await wait(`Boolean(document.querySelector('.shell-tab-add'))`)
    for (let count = 1; count <= 12; count++) {
      await js(`document.querySelector('.shell-tab-add').click()`)
      await wait(`${tabCount}===${count}`)
    }
    await wait(`document.querySelectorAll('.connection-picker input').length===12`)
    // Store a real DOM reference and enter text through React's controlled input.
    await js(`(()=>{
      const panel=document.querySelector('[role="tabpanel"]');window.__tabsSmokePanel=panel;
      const input=panel.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'保留搜索');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await js(`(()=>{const t=document.querySelector('.shell-tab-list [aria-selected="true"]');t.focus();t.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))})()`)
    await wait(`document.activeElement===document.querySelector('.shell-tab-list [role="tab"]')`)
    assert.equal(await js(`document.querySelector('[role="tabpanel"]')===window.__tabsSmokePanel&&window.__tabsSmokePanel.querySelector('input').value==='保留搜索'`), true)
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}))`)
    await wait(`document.activeElement===document.querySelectorAll('.shell-tab-list [role="tab"]')[11]`)
    await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))`)
    await wait(`document.activeElement===document.querySelector('.shell-tab-list [role="tab"]')`)
    await js(`document.querySelector('.shell-primary-nav [aria-controls="workspace-vault"]').click()`)
    await wait(`!!document.querySelector('.vault-view')&&${tabCount}===12`)
    assert.equal(await js(`document.querySelectorAll('.shell-tab-list [aria-selected="true"]').length`), 0)
    await js(`window.__tabsSmokeVault=document.querySelector('.vault-view');document.querySelector('.shell-primary-nav [aria-controls="workspace-vault"]').click()`)
    assert.equal(await js(`document.querySelectorAll('.vault-view').length===1&&document.querySelector('.vault-view')===window.__tabsSmokeVault`), true)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'w',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`)
    assert.equal(await js(tabCount), 12, 'Closing a tool page must not close a background terminal')
    assert.equal(await js(`!!document.querySelector('.shell-primary-nav [aria-current="page"]')&&!document.querySelector('.shell-workspace-actions button')`), true)
    const vaultLayout = await verifyVaultLayout(window, root)
    screenshots.push(...vaultLayout.screenshots)
    await capture('workspace-vault-light.png', 'light')
    await capture('workspace-vault-dark.png', 'dark')
    await js(`document.querySelectorAll('.shell-tab-list [role="tab"]')[11].click()`)
    await wait(`document.querySelectorAll('.shell-tab-list [aria-selected="true"]').length===1`)
    assert.equal(await js(`document.querySelector('[role="tabpanel"]')===window.__tabsSmokePanel`), true)

    const geometry = async () => {
      await wait(`(()=>{const scroll=document.querySelector('.shell-tab-scroll'),selected=scroll.querySelector('.shell-tab.is-active');const a=scroll.getBoundingClientRect(),b=selected.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1})()`)
      return js<{ headerHeight: number; overflow: boolean; buttonsFit: boolean; noDrag: boolean; oldListRemoved: boolean; draftFillsPane: boolean }>(`(()=>{
        const header=document.querySelector('.shell-workspace-header'),scroll=document.querySelector('.shell-tab-scroll'),action=document.querySelector('.shell-workspace-actions'),add=document.querySelector('.shell-tab-add');
        const a=action.getBoundingClientRect(),b=header.getBoundingClientRect(),c=add.getBoundingClientRect();
        const card=document.querySelector('.term-pane:not(.is-hidden) .term-pane-card.is-draft'),picker=card.querySelector('.connection-picker');
        const pane=card.getBoundingClientRect(),page=picker.getBoundingClientRect();
        return {headerHeight:b.height,overflow:scroll.scrollWidth>scroll.clientWidth,
          draftFillsPane:['left','top','right','bottom'].every(edge=>Math.abs(pane[edge]-page[edge])<1),
          buttonsFit:a.right<=b.right&&c.right<=a.left&&c.left>=b.left,
          noDrag:getComputedStyle(scroll).webkitAppRegion==='no-drag'&&getComputedStyle(add).webkitAppRegion==='no-drag'&&getComputedStyle(header).webkitAppRegion==='drag',
          oldListRemoved:!document.querySelector('.shell-open-section')&&!document.querySelector('[aria-label="调整服务器和已打开区域比例"]')};
      })()`)
    }
    const wide = await geometry()
    assert.ok(wide.headerHeight >= 48 && wide.overflow && wide.buttonsFit && wide.noDrag && wide.oldListRemoved && wide.draftFillsPane)
    await capture('workspace-tabs-light.png', 'light')
    window.setContentSize(900, 650)
    await wait(`innerWidth===900`)
    const narrow = await geometry()
    assert.ok(narrow.overflow && narrow.buttonsFit && narrow.draftFillsPane)
    await capture('workspace-tabs-dark-narrow.png', 'dark')
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`)
    await wait(`!!document.querySelector('.desktop-shell.sidebar-is-hidden')`)
    await js(`document.documentElement.style.setProperty('--sans-size','22px')`)
    const enlarged = await geometry()
    assert.ok(enlarged.headerHeight >= 48 && enlarged.buttonsFit && enlarged.noDrag && enlarged.draftFillsPane)
    await capture('workspace-tabs-large-collapsed.png', 'light')
    assert.equal(await js(`window.eizhu.localState.read({key:'terminal_layout'})`), null, 'Terminal tabs must remain in memory only')
    // Close through the same button path, checking the restored keyboard focus.
    await js(`(()=>{const close=document.querySelector('.shell-tab.is-active .shell-tab-close');close.focus();close.click()})()`)
    await wait(`${tabCount}===11&&document.activeElement===document.querySelector('.shell-tab-list [aria-selected="true"]')`)

    const folders = await js<{ parent: string; child: string }>(`(async()=>{
      const parent=await window.eizhu.group.create({request:{name:'展开状态父文件夹'}});
      const child=await window.eizhu.group.create({request:{name:'展开状态子文件夹',parent_id:parent.id}});
      // Old versions saved references even when no SSH connection could be resumed.
      await window.eizhu.localState.write({key:'terminal_layout',value:{version:1,tree:{type:'leaf',tabId:'old'},focusedId:'old',tabs:[{id:'old',profileId:'removed-profile'}]}});
      return {parent:parent.id,child:child.id};
    })()`)
    const reload = async (withFolders = true) => {
      await new Promise<void>((resolve) => {
        window.webContents.once('did-finish-load', () => resolve())
        window.webContents.reload()
      })
      await wait(`!!document.querySelector('.shell-section-title')&&${withFolders ? "document.querySelectorAll('.grp-label[aria-expanded]').length>0" : "!!document.querySelector('.sidebar-empty')"}`)
    }
    const parentFolder = `Array.from(document.querySelectorAll('.grp-label[aria-expanded]')).find(el=>el.textContent.includes('展开状态父文件夹'))`
    const childFolder = `Array.from(document.querySelectorAll('.grp-label[aria-expanded]')).find(el=>el.textContent.includes('展开状态子文件夹'))`
    await reload()
    assert.equal(await js(tabCount), 0, 'Reload must discard all previous tabs, including legacy saved references')
    assert.equal(await js(`document.querySelector('.shell-section-title').tagName==='H2'&&!document.querySelector('.shell-section-title svg')&&document.querySelectorAll('.shell-section-heading button').length===1`), true)
    await js(`(${childFolder}).click()`)
    await wait(`(${childFolder})?.getAttribute('aria-expanded')==='false'`)
    await js(`(${parentFolder}).click()`)
    await wait(`(${parentFolder})?.getAttribute('aria-expanded')==='false'`)
    const savedFolders = await js<Record<string, boolean>>(`window.eizhu.localState.read({key:'sidebar_groups'})`)
    assert.equal(savedFolders[folders.parent], true)
    assert.equal(savedFolders[folders.child], true)
    await reload()
    await wait(`(${parentFolder})?.getAttribute('aria-expanded')==='false'`)
    assert.equal(await js(`(${parentFolder}).getAttribute('aria-expanded')`), 'false', 'Collapsed parent folder survives reload')
    await js(`(${parentFolder}).click()`)
    await wait(`(${childFolder})?.getAttribute('aria-expanded')==='false'`)
    await reload()
    await wait(`(${parentFolder})?.getAttribute('aria-expanded')==='true'&&(${childFolder})?.getAttribute('aria-expanded')==='false'`)
    assert.equal(await js(`(${parentFolder}).getAttribute('aria-expanded')`), 'true', 'Expanded parent folder survives reload')
    assert.equal(await js(`(${childFolder}).getAttribute('aria-expanded')`), 'false', 'Child folder remembers its own state')
    await capture('sidebar-folders-remembered.png', 'light')
    await js(`(async()=>{
      await window.eizhu.group.delete({id:${JSON.stringify(folders.child)}});
      await window.eizhu.group.delete({id:${JSON.stringify(folders.parent)}});
      await window.eizhu.localState.write({key:'sidebar_groups',value:{}});
      await window.eizhu.localState.write({key:'terminal_layout',value:{version:1,tree:null,focusedId:null,tabs:[]}});
    })()`)
    await reload(false)
    return { passed: true, synthetic: true, firstConnection: true, keyboard: true, mountedContentRetained: true, singletonTools: true, toolShortcutIsolation: true, closeFocus: true, freshSessions: true, fixedServerHeading: true, rememberedFolders: true, vaultLayout, wide, narrow, enlarged, screenshots }
  } finally {
    await js(`document.documentElement.className=${JSON.stringify(original.theme)};document.documentElement.style.setProperty('--sans-size',${JSON.stringify(original.font)});delete window.__tabsSmokePanel;delete window.__tabsSmokeVault`)
    await js(`(()=>{if(document.querySelector('.desktop-shell.sidebar-is-hidden'))document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))})()`)
    for (let count = await js<number>(tabCount); count > 0; count--) {
      await js(`document.querySelector('.shell-tab-close').click()`)
      await wait(`${tabCount}===${count - 1}`)
    }
    window.setContentSize(originalSize[0], originalSize[1])
  }
}
