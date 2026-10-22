import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
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
    await js(`document.querySelectorAll('.shell-primary-nav > button')[2].click()`)
    await wait(`!!document.querySelector('.vault-view')&&${tabCount}===12`)
    assert.equal(await js(`document.querySelectorAll('.shell-tab-list [aria-selected="true"]').length`), 0)
    await js(`window.__tabsSmokeVault=document.querySelector('.vault-view');document.querySelectorAll('.shell-primary-nav > button')[2].click()`)
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
      return js<{ headerHeight: number; overflow: boolean; buttonsFit: boolean; noDrag: boolean; oldListRemoved: boolean }>(`(()=>{
        const header=document.querySelector('.shell-workspace-header'),scroll=document.querySelector('.shell-tab-scroll'),action=document.querySelector('.shell-workspace-actions'),add=document.querySelector('.shell-tab-add');
        const a=action.getBoundingClientRect(),b=header.getBoundingClientRect(),c=add.getBoundingClientRect();
        return {headerHeight:b.height,overflow:scroll.scrollWidth>scroll.clientWidth,
          buttonsFit:a.right<=b.right&&c.right<=a.left&&c.left>=b.left,
          noDrag:getComputedStyle(scroll).webkitAppRegion==='no-drag'&&getComputedStyle(add).webkitAppRegion==='no-drag'&&getComputedStyle(header).webkitAppRegion==='drag',
          oldListRemoved:!document.querySelector('.shell-open-section')&&!document.querySelector('[aria-label="调整服务器和已打开区域比例"]')};
      })()`)
    }
    const wide = await geometry()
    assert.ok(wide.headerHeight >= 48 && wide.overflow && wide.buttonsFit && wide.noDrag && wide.oldListRemoved)
    await capture('workspace-tabs-light.png', 'light')
    window.setContentSize(900, 650)
    await wait(`innerWidth===900`)
    const narrow = await geometry()
    assert.ok(narrow.overflow && narrow.buttonsFit)
    await capture('workspace-tabs-dark-narrow.png', 'dark')
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`)
    await wait(`!!document.querySelector('.desktop-shell.sidebar-is-hidden')`)
    await js(`document.documentElement.style.setProperty('--sans-size','22px')`)
    const enlarged = await geometry()
    assert.ok(enlarged.headerHeight >= 48 && enlarged.buttonsFit && enlarged.noDrag)
    await capture('workspace-tabs-large-collapsed.png', 'light')
    assert.equal(await js(`document.body.innerText.includes('终端布局保存失败')`), false, 'Draft tabs must not break layout persistence')
    // Close through the same button path, checking the restored keyboard focus.
    await js(`(()=>{const close=document.querySelector('.shell-tab.is-active .shell-tab-close');close.focus();close.click()})()`)
    await wait(`${tabCount}===11&&document.activeElement===document.querySelector('.shell-tab-list [aria-selected="true"]')`)
    return { passed: true, synthetic: true, keyboard: true, mountedContentRetained: true, singletonTools: true, toolShortcutIsolation: true, closeFocus: true, vaultLayout, wide, narrow, enlarged, screenshots }
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
