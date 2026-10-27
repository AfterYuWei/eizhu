import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Windows } from './windows.ts'
import type { AccountFixture } from './account-fixture-server.ts'
import type { SyncStatus } from '@eizhu/contracts'

/** Actual renderer/preload/main/utility/DB/compute + HTTP and flow-controlled SSE on a temporary profile. */
export async function verifySyncDesktop(
  window: BrowserWindow,
  windows: Windows,
  fixture: AccountFixture,
  root: string,
) {
  const js = <T = unknown>(script: string) => window.webContents.executeJavaScript(script) as Promise<T>
  const wait = async (probe: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await probe()) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Sync desktop smoke timed out')
  }
  const status = () => js<SyncStatus>('window.eizhu.sync.status()')
  const originalPreferences = await js<string | null>(
    `window.eizhu.app.bootstrap().then(b=>b.settings['eizhu-settings']??null)`,
  )
  const capture = async (name: string, theme: string, font?: number) => {
    const old = JSON.parse(originalPreferences ?? '{}')
    const value = JSON.stringify({
      ...old,
      state: { ...old.state, theme, ...(font ? { appFontSize: font } : {}) },
    })
    await js(`window.eizhu.settings.write(${JSON.stringify({ key: 'eizhu-settings', value })})`)
    windows.emit(window, 'eizhu-settings-changed', { key: 'eizhu-settings', value })
    await wait(() => js(`document.documentElement.classList.contains(${JSON.stringify(theme)})`))
    await js(
      `(async()=>{let style=document.getElementById('eizhu-sync-capture');if(!style){style=document.createElement('style');style.id='eizhu-sync-capture';style.textContent='*,*::before,*::after{transition:none!important;animation:none!important}';document.head.append(style)}document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(${JSON.stringify(theme)});await document.fonts.ready;getComputedStyle(document.body).backgroundColor;await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(r,250))])})()`,
    )
    await writeFile(
      join(root, name),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
  }
  const click = async (text: string) => {
    await wait(() =>
      js(
        `Boolean([...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled))`,
      ),
    )
    await js(
      `([...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled)).click()`,
    )
  }
  const step = (name: string) => console.log('EIZHU_SYNC_STEP', name)

  const before = await js<Array<{ id: string }>>('window.eizhu.group.list()')
  await js(
    `window.eizhu.account.register({email:'sync-desktop@example.invalid',password:'synthetic-sync-123'})`,
  )
  await js(`window.eizhu.account.verifyEmail({code:'123456'})`)
  const user = await js<{ user: { id: number } }>('window.eizhu.account.status()'),
    peer = fixture.sync(user.user.id)
  assert.equal(peer.seq, 0)
  await js(
    `document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))`,
  )
  await wait(() =>
    js(`Boolean([...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent==='云同步'))`),
  )
  await js(
    `(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent==='云同步');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`,
  )
  await wait(() => js(`Boolean(document.querySelector('#sync-password'))`))
  await js(
    `(()=>{const input=document.querySelector('#sync-password');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'desktop 同步密码 123');input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  )
  await js(`document.querySelector('#sync-password').closest('form').requestSubmit()`)
  await wait(async () => (await status()).unlocked)
  assert.equal(peer.seq, 0)
  step('unlock-ready')
  await click('预览首次接入')
  await wait(() => js(`document.body.innerText.includes('确认合并')`))
  await click('取消预览')
  assert.equal((await status()).initialized, false)
  assert.equal(peer.seq, 0)
  await click('预览首次接入')
  await wait(() => js(`document.body.innerText.includes('确认合并')`))
  await click('确认合并')
  await wait(() => js(`Boolean(document.querySelector('[role="alertdialog"][data-state="open"]'))`))
  await click('确认接入')
  await wait(async () => {
    const s = await status()
    return s.initialized && s.pendingCount === 0 && s.status === 'synced'
  })
  await wait(async () => fixture.subscribers === 1)
  await wait(() => js(`!document.querySelector('#sync-password').disabled`))
  assert.equal(await js(`document.querySelector('#sync-password').value`), '')
  assert.equal(
    await js(
      `([...document.querySelectorAll('button')].find(b=>b.textContent.includes('立即同步'))).disabled`,
    ),
    false,
  )
  await capture('sync-initialized-light.png', 'light')

  step('bootstrap-and-sse-ready')
  const previous = await status(),
    changesBefore = peer.counters.changes ?? 0
  fixture.emitHint(peer.seq + 100)
  await wait(async () => (peer.counters.changes ?? 0) > changesBefore)
  const afterHint = await status()
  assert.equal(afterHint.cursor, previous.cursor)
  assert.equal(afterHint.lastConfirmed, previous.lastConfirmed)
  const connections = fixture.requests['/api/sync/v2/events'] ?? 0
  fixture.disconnectEvents()
  await wait(
    async () => (fixture.requests['/api/sync/v2/events'] ?? 0) > connections && fixture.subscribers === 1,
  )

  await wait(() =>
    js(
      `document.querySelector('#account-sync-enabled').getAttribute('aria-checked')==='true'&&!document.querySelector('#account-sync-enabled').disabled`,
    ),
  )
  step('pause-sync')
  await js(`document.querySelector('#account-sync-enabled').click()`)
  await wait(async () => fixture.subscribers === 0 && (await status()).status === 'paused')
  const pausedSeq = peer.seq
  const group = await js<{ id: string }>(`window.eizhu.group.create({request:{name:'暂停期间本地修改'}})`)
  await wait(async () => (await status()).pendingCount > 0)
  assert.equal(peer.seq, pausedSeq)
  await wait(() =>
    js(
      `document.querySelector('#account-sync-enabled').getAttribute('aria-checked')==='false'&&!document.querySelector('#account-sync-enabled').disabled`,
    ),
  )
  step('resume-sync')
  await js(`document.querySelector('#account-sync-enabled').click()`)
  await wait(async () => {
    const s = await status()
    return s.pendingCount === 0 && peer.seq > pausedSeq
  })
  await wait(async () => fixture.subscribers === 1)

  step('sse-pause-resume-passed')
  peer.dropNextPush = true
  const requestsBefore = peer.pushBodies.length
  await js(`window.eizhu.group.update({id:${JSON.stringify(group.id)},request:{name:'响应丢失后安全恢复'}})`)
  await wait(async () => (await status()).lastErrorCode === 'ACCOUNT_UNAVAILABLE')
  assert.equal(peer.pushBodies.length - requestsBefore, 1)
  const lostSeq = peer.seq
  await js('window.eizhu.sync.now()')
  assert.equal(peer.seq, lostSeq)
  assert.equal(peer.pushBodies.length - requestsBefore, 1)
  assert.equal((await status()).pendingCount, 0)
  step('unknown-request-recovered')
  await js('window.eizhu.runtime.restart()')
  await wait(async () => {
    const s = await status()
    return s.unlocked && s.initialized && fixture.subscribers === 1
  })
  await js(
    `document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))`,
  )
  await wait(() =>
    js(`Boolean([...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent==='云同步'))`),
  )
  await js(
    `(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent==='云同步');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`,
  )
  await wait(() => js(`Boolean(document.querySelector('#sync-password'))`))
  const previousSize = window.getContentSize()
  window.setContentSize(900, 720)
  await js(`document.documentElement.style.setProperty('--sans-size','18px')`)
  await capture('sync-unlocked-dark-narrow.png', 'dark', 18)
  assert.equal(await js(`document.documentElement.classList.contains('dark')`), true)
  assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth+1`), true)
  await js(
    `window.eizhu.settings.write(${JSON.stringify({ key: 'eizhu-settings', value: originalPreferences })})`,
  )
  windows.emit(window, 'eizhu-settings-changed', { key: 'eizhu-settings', value: originalPreferences })
  window.setContentSize(previousSize[0], previousSize[1])

  await js('window.eizhu.account.logout()')
  await wait(async () => fixture.subscribers === 0)
  assert.deepEqual(
    (await js<Array<{ id: string }>>('window.eizhu.group.list()')).map((g) => g.id).sort(),
    before.map((g) => g.id).sort(),
  )
  await js(`window.eizhu.account.login({email:'sync-desktop@example.invalid',password:'synthetic-sync-123'})`)
  assert.equal((await status()).unlocked, false)
  assert.equal((await status()).initialized, true)
  await js('window.eizhu.account.logout()')
  if (await js(`Boolean(document.querySelector('.settings-page-back'))`))
    await js(`document.querySelector('.settings-page-back').click()`)
  return {
    passed: true,
    synthetic: true,
    realBackend: false,
    realEmail: false,
    rendererPasswordForm: true,
    previewCancelNoUpload: true,
    confirmedOfflineMerge: true,
    automaticOutbox: true,
    hintsNotConfirmations: true,
    singleSseConnection: true,
    sseReconnect: true,
    pauseReleasesSse: true,
    pausePreservesOutbox: true,
    lostHttpResponseNotReplayed: true,
    requestLookupRecovery: true,
    restartUnlockCache: true,
    logoutClearsUnlock: true,
    offlineOriginalRetained: true,
    screenshots: ['sync-initialized-light.png', 'sync-unlocked-dark-narrow.png'],
  }
}
