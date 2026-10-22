import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

/** 仅在隔离数据目录验证实际密钥界面，截图始终隐藏凭据。 */
export async function verifyVaultLayout(window: BrowserWindow, root: string) {
  const js = <T = unknown>(source: string): Promise<T> => window.webContents.executeJavaScript(source)
  const wait = async (source: string) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await js<boolean>(source)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Vault layout UI timeout: ${source}`)
  }
  const originalSize = window.getContentSize()
  const original = await js<{ theme: string; font: string }>(`({theme:document.documentElement.className,font:document.documentElement.style.getPropertyValue('--sans-size')})`)
  const ids = await js<{ key: string; password: string; profile: string }>(`(async()=>{
    const api=window.eizhu,key=await api.vault.generateKeyPair({request:{algo:'ed25519'}});
    const entry=await api.vault.create({request:{name:'布局验收密钥',type:'private_key',private_key:key.private_key,public_key:key.public_key}});
    const password=await api.vault.create({request:{name:'布局验收密码',type:'password',username:'deploy',password:'synthetic-vault-layout-password'}});
    const profile=await api.profile.create({request:{name:'布局验收关联连接',host:'vault-layout.example.invalid',username:'deploy',auth_type:'vault',vault_id:entry.id}});
    return {key:entry.id,password:password.id,profile:profile.id};
  })()`)
  const search = (value: string) => js(`(()=>{const input=document.querySelector('.vault-toolbar-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const select = (id: string) => js(`document.querySelector('[data-vault-item="'+${JSON.stringify(id)}+'"]').click()`)
  const selectMenu = async () => {
    await js(`document.querySelector('[aria-label="更多凭据操作"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',bubbles:true}))`)
    await wait(`!![...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.includes('删除凭据'))`)
    await js(`[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.includes('删除凭据')).click()`)
  }
  const screenshots: string[] = []
  const capture = async (name: string, theme: string) => {
    await js(`(async()=>{document.activeElement?.blur();document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(${JSON.stringify(theme)});await document.fonts.ready;await new Promise(resolve=>setTimeout(resolve,200))})()`)
    await writeFile(join(root, name), (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG())
    screenshots.push(name)
  }
  try {
    window.setContentSize(1320, 820)
    await search('布局验收')
    await wait(`document.querySelectorAll('[data-vault-item]').length===2`)
    await select(ids.key)
    await wait(`document.querySelector('.vault-detail-heading h2')?.textContent==='布局验收密钥'`)
    assert.equal(await js(`document.querySelector('.vault-inspector').textContent.includes('OPENSSH PRIVATE KEY')`), false)
    await js(`document.querySelector('[aria-label="显示私钥"]').click()`)
    await wait(`document.querySelector('[aria-label="私钥内容"]').textContent.includes('OPENSSH PRIVATE KEY')`)
    await js(`document.querySelector('[aria-label="隐藏私钥"]').click()`)
    assert.equal(await js(`document.querySelector('.vault-inspector').textContent.includes('OPENSSH PRIVATE KEY')`), false)
    await js(`document.querySelector('.vault-reference-toggle').click()`)
    await wait(`document.querySelector('.vault-reference-list')?.textContent.includes('布局验收关联连接')`)
    await selectMenu()
    await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('无法删除')`)
    assert.equal(await js(`document.querySelector('[role="dialog"]').textContent.includes('布局验收关联连接')`), true)
    await js(`[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent==='知道了').click()`)
    await wait(`!document.querySelector('[role="dialog"]')`)
    await js(`document.querySelector('.vault-detail-heading-actions button').click()`)
    await wait(`!!document.querySelector('.vault-inline-editor input[id$="-name"]')&&!document.querySelector('.vault-editor-fields').disabled`)
    await js(`(()=>{const input=document.querySelector('.vault-inline-editor input[id$="-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'布局验收已编辑');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await select(ids.password)
    await wait(`!!document.querySelector('[role="alertdialog"]')`)
    await js(`[...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='继续编辑').click()`)
    await wait(`!document.querySelector('[role="alertdialog"]')`)
    assert.equal(await js(`document.querySelector('.vault-inline-editor input[id$="-name"]').value`), '布局验收已编辑')
    await js(`document.querySelector('.vault-inline-editor form').requestSubmit()`)
    await wait(`!document.querySelector('.vault-inline-editor')&&document.querySelector('.vault-detail-heading h2')?.textContent==='布局验收已编辑'`)
    await select(ids.password)
    await wait(`document.querySelector('.vault-detail-heading h2')?.textContent==='布局验收密码'`)
    await js(`document.querySelector('[aria-label="复制密码"]').click()`)
    await wait(`window.eizhu.clipboard.read().then(text=>text==='synthetic-vault-layout-password')`)
    await selectMenu()
    await wait(`document.querySelector('[role="dialog"]')?.textContent.includes('确认删除')`)
    await js(`[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent==='删除').click()`)
    await wait(`!document.querySelector('[data-vault-item="'+${JSON.stringify(ids.password)}+'"]')&&!document.querySelector('[role="dialog"]')`)
    await select(ids.key)
    await wait(`!!document.querySelector('.vault-detail-view')`)
    await wait(`!document.querySelector('[data-sonner-toast]')`)
    const geometry = await js<{ gap: number; round: number; toolbarLine: string; fits: boolean; controlsEnabled: boolean }>(`(()=>{
      const list=document.querySelector('.vault-list-panel'),detail=document.querySelector('.vault-inspector'),columns=document.querySelector('.vault-columns');
      const l=list.getBoundingClientRect(),d=detail.getBoundingClientRect(),c=columns.getBoundingClientRect();
      return {gap:d.left-l.right,round:parseFloat(getComputedStyle(list).borderRadius),toolbarLine:getComputedStyle(document.querySelector('.vault-toolbar')).borderBottomWidth,fits:d.right<=c.right+1&&list.scrollWidth<=list.clientWidth+1,controlsEnabled:!document.querySelector('.vault-toolbar-search').disabled&&[...document.querySelectorAll('.vault-toolbar-actions button')].every(el=>!el.disabled)};
    })()`)
    assert.ok(geometry.gap >= 20 && geometry.round === 12 && geometry.toolbarLine === '0px' && geometry.fits && geometry.controlsEnabled)
    await capture('vault-layout-light.png', 'light')
    await capture('vault-layout-dark.png', 'dark')
    window.setContentSize(1000, 680)
    await js(`document.documentElement.style.setProperty('--sans-size','20px')`)
    await wait(`innerWidth===1000`)
    await capture('vault-layout-large-narrow.png', 'light')
    assert.equal(await js(`(()=>{const v=document.querySelector('.vault-view'),r=v.getBoundingClientRect();return [...v.querySelectorAll('.vault-toolbar,.vault-list-panel,.vault-inspector')].every(el=>el.getBoundingClientRect().right<=r.right+1)&&v.scrollWidth<=v.clientWidth+1})()`), true)
    return { passed: true, synthetic: true, lazyReveal: true, guardedEditing: true, save: true, protectedDelete: true, unreferencedDelete: true, sensitiveClipboard: true, geometry, screenshots }
  } finally {
    await js(`(async()=>{await window.eizhu.profile.delete({id:${JSON.stringify(ids.profile)}});for(const id of ${JSON.stringify([ids.key, ids.password])})await window.eizhu.vault.delete({id}).catch(error=>{if(error.code!=='NOT_FOUND')throw error});await window.eizhu.clipboard.write({text:''});document.documentElement.className=${JSON.stringify(original.theme)};document.documentElement.style.setProperty('--sans-size',${JSON.stringify(original.font)})})()`)
    await search('')
    window.setContentSize(originalSize[0], originalSize[1])
  }
}
