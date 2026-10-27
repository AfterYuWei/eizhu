import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Windows } from './windows.ts'
import type { AccountFixture } from './account-fixture-server.ts'
import { displayPath } from '@eizhu/core/sftp/endpoint'

async function waitFor(window: BrowserWindow, script: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await window.webContents.executeJavaScript(script)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Account smoke UI did not become ready')
}
async function openAccount(window: BrowserWindow): Promise<void> {
  if (!(await window.webContents.executeJavaScript(`Boolean(document.querySelector('.settings-page'))`)))
    await window.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))`,
    )
  await waitFor(
    window,
    `Boolean([...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent==='账号'))`,
  )
  await window.webContents.executeJavaScript(
    `(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent==='账号');tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`,
  )
  await waitFor(window, `Boolean(document.querySelector('[aria-label="账号设置"]'))`)
}
async function capture(window: BrowserWindow, root: string, name: string, theme: string): Promise<void> {
  await window.webContents.executeJavaScript(
    `(async()=>{document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(${JSON.stringify(theme)});await document.fonts.ready;await new Promise(r=>setTimeout(r,100))})()`,
  )
  await writeFile(
    join(root, name),
    (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
  )
}

/** Exercises the actual renderer→preload→main→utilityProcess→SQLite Worker path against synthetic HTTP. */
export async function verifyAccountClosure(
  window: BrowserWindow,
  windows: Windows,
  fixture: AccountFixture,
  root: string,
  assets: string,
) {
  const emailA = 'account-a@example.invalid',
    emailB = 'account-b@example.invalid',
    emailC = 'account-unknown@example.invalid'
  const password = 'synthetic-password123',
    newPassword = 'synthetic-password456'
  const js = <T = unknown>(script: string) => window.webContents.executeJavaScript(script) as Promise<T>
  const expectCode = async (script: string, code: string) =>
    assert.equal(await js(`(${script}).then(()=> 'unexpected-success', e=>e.code)`), code)
  const credentials = (email: string, pass = password) => JSON.stringify({ email, password: pass })
  const count = (name: string) => fixture.requests[`/api/auth/${name}`] ?? 0
  const step = (name: string) => console.log('EIZHU_ACCOUNT_STEP', name)
  // Existing editor evidence has already completed; all windows/data here are isolated synthetic smoke state.
  windows.editor?.destroy()
  const offline = await js<{ id: string; generation: number }>('window.eizhu.workspace.status()')
  const sentinel = await js<{ id: string }>(`window.eizhu.group.create({request:{name:'账号闭环离线哨兵'}})`)
  await openAccount(window)
  assert.equal(await js(`Boolean(document.querySelector('#account-email'))`), true)
  await capture(window, root, 'account-login-light.png', 'light')
  fixture.setupRequired = true
  const registerBefore = count('register')
  await expectCode(`window.eizhu.account.register(${credentials(emailA)})`, 'ACCOUNT_SETUP_REQUIRED')
  assert.equal(count('register'), registerBefore)
  fixture.setupRequired = false
  fixture.denyRegister = true
  await expectCode(`window.eizhu.account.register(${credentials(emailA)})`, 'ACCOUNT_ACCESS_DENIED')
  fixture.denyRegister = false
  step('setup-and-restricted-gates')

  const localRoot = join(root, 'stage4', 'local')
  await mkdir(localRoot, { recursive: true })
  const file = join(localRoot, 'account-dirty.txt')
  await writeFile(file, '合成编辑器原内容')
  const local = await js<{ session_id: string }>(`window.eizhu.sftp.createSession({profileId:'local'})`)
  await js(
    `window.eizhu.editor.open(${JSON.stringify({ sessionId: local.session_id, sessionType: 'sftp', path: displayPath(file) })})`,
  )
  const editor = windows.editor!
  await waitFor(editor, `Boolean(document.querySelector('.monaco-editor textarea'))`)
  const monacoAsset = (await readdir(assets)).find((name) => /^monaco-.*\.js$/.test(name))!
  const readOnlyProbe = `(async()=>{const loaded=await import(${JSON.stringify('eizhu://app/assets/' + monacoAsset)});const loader=Object.values(loaded).find(v=>v&&typeof v.init==='function'&&typeof v.config==='function');const monaco=await loader.init();return monaco.editor.getEditors().some(e=>e.getOption(monaco.editor.EditorOption.readOnly))})()`
  await editor.webContents.executeJavaScript(
    `(async()=>{const loaded=await import(${JSON.stringify('eizhu://app/assets/' + monacoAsset)});const loader=Object.values(loaded).find(v=>v&&typeof v.init==='function'&&typeof v.config==='function');const monaco=await loader.init();monaco.editor.getModels().find(m=>!m.isDisposed()).applyEdits([{range:{startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:1},text:'账号切换前未保存'}])})()`,
  )
  await waitFor(editor, `Boolean(document.querySelector('.editor-dirty-dot'))`)
  assert.equal(
    await editor.webContents.executeJavaScript(
      `window.eizhu.account.status().then(()=> 'unexpected-success',e=>e.code)`,
    ),
    'FORBIDDEN',
  )
  const beforeCancel = count('register')
  const cancelled = js<string>(
    `window.eizhu.account.register(${credentials(emailA)}).then(()=> 'unexpected-success',e=>e.code)`,
  )
  await waitFor(editor, `Boolean(document.querySelector('[role="alertdialog"][data-state="open"]'))`)
  await editor.webContents.executeJavaScript(
    `[...document.querySelector('[role="alertdialog"][data-state="open"]').querySelectorAll('button')].find(b=>b.textContent==='继续编辑').click()`,
  )
  assert.equal(await cancelled, 'CANCELLED')
  assert.equal(count('register'), beforeCancel)
  assert.equal((await js<{ id: string }>('window.eizhu.workspace.status()')).id, offline.id)
  assert.equal(
    await editor.webContents.executeJavaScript(`Boolean(document.querySelector('.editor-dirty-dot'))`),
    true,
  )
  step('editor-cancel-before-authentication')

  const rejected = expectCode(
    `window.eizhu.account.login(${credentials(emailA)})`,
    'ACCOUNT_INVALID_CREDENTIALS',
  )
  await waitFor(editor, `Boolean(document.querySelector('[role="alertdialog"][data-state="open"]'))`)
  await editor.webContents.executeJavaScript(
    `[...document.querySelector('[role="alertdialog"][data-state="open"]').querySelectorAll('button')].find(b=>b.textContent==='放弃修改').click()`,
  )
  await rejected
  assert.equal(editor.isDestroyed(), false)
  await waitFor(editor, `!document.querySelector('[role="alertdialog"][data-state="open"]')`)
  await waitFor(editor, `(${readOnlyProbe}).then(locked=>!locked)`)

  fixture.authDelayMs = 300
  const loggingIn = js<{ loggedIn: boolean; syncEnabled: boolean; user: { emailVerified: boolean } }>(
    `window.eizhu.account.register(${credentials(emailA)})`,
  )
  await waitFor(editor, `Boolean(document.querySelector('[role="alertdialog"][data-state="open"]'))`)
  await editor.webContents.executeJavaScript(
    `[...document.querySelector('[role="alertdialog"][data-state="open"]').querySelectorAll('button')].find(b=>b.textContent==='放弃修改').click()`,
  )
  await waitFor(editor, readOnlyProbe)
  const logged = await loggingIn
  fixture.authDelayMs = 0
  assert.equal(editor.isDestroyed(), true)
  assert.equal(logged.loggedIn, true)
  assert.equal(logged.syncEnabled, false)
  assert.equal(logged.user.emailVerified, false)
  const accountA = await js<{ id: string; generation: number }>('window.eizhu.workspace.status()')
  assert.notEqual(accountA.id, offline.id)
  assert.ok(accountA.generation > offline.generation)
  assert.deepEqual(await js('window.eizhu.group.list()'), [])
  const accountGroup = await js<{ id: string }>(
    `window.eizhu.group.create({request:{name:'账号 A 私有分组'}})`,
  )
  await js('window.eizhu.account.sendVerificationEmail()')
  await expectCode(`window.eizhu.account.verifyEmail({code:'000000'})`, 'INVALID_EMAIL_CODE')
  await js(`window.eizhu.account.verifyEmail({code:'123456'})`)
  assert.equal(await js(`window.eizhu.account.status().then(s=>s.user.emailVerified)`), true)
  await openAccount(window)
  await waitFor(window, `document.body.innerText.includes('邮箱已验证')`)
  await capture(window, root, 'account-signed-in-dark.png', 'dark')
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('[aria-label="账号设置"] .settings-card-footer button')).every(button=>!button.disabled)`,
    ),
    true,
  )
  const previousSize = window.getContentSize()
  window.setContentSize(900, 720)
  await js(`document.documentElement.style.setProperty('--sans-size','18px')`)
  await capture(window, root, 'account-signed-in-narrow.png', 'dark')
  assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth+1`), true)
  await js(`document.documentElement.style.removeProperty('--sans-size')`)
  window.setContentSize(previousSize[0], previousSize[1])
  step('register-verify-and-isolated-space')

  fixture.rejectMeCount = 2
  const beforeRefresh = count('refresh')
  const users = await js<Array<{ id: number }>>(
    'Promise.all([window.eizhu.account.me(),window.eizhu.account.me()])',
  )
  assert.equal(users.length, 2)
  assert.equal(users[0].id, users[1].id)
  assert.equal(count('refresh') - beforeRefresh, 1)
  fixture.offline = true
  await expectCode('window.eizhu.account.me()', 'ACCOUNT_UNAVAILABLE')
  assert.equal(await js(`window.eizhu.account.status().then(s=>s.sessionState)`), 'authenticated')
  await js('window.eizhu.runtime.restart()')
  assert.equal((await js<{ id: string }>('window.eizhu.workspace.status()')).id, accountA.id)
  assert.ok(
    (await js<Array<{ id: string }>>('window.eizhu.group.list()')).some(
      (group) => group.id === accountGroup.id,
    ),
  )
  fixture.offline = false
  fixture.rejectMeCount = 1
  fixture.dropNextRefresh = true
  const beforeLostRefresh = count('refresh')
  await expectCode('window.eizhu.account.me()', 'ACCOUNT_UNAVAILABLE')
  assert.equal(count('refresh') - beforeLostRefresh, 1)
  assert.equal(await js(`window.eizhu.account.status().then(s=>s.sessionState)`), 'reauth_required')
  const afterLostRefresh = count('refresh')
  await expectCode('window.eizhu.account.me()', 'ACCOUNT_NOT_LOGGED_IN')
  assert.equal(count('refresh'), afterLostRefresh)
  const beforeReauth = await js<{ runtimeId: string }>('window.eizhu.app.bootstrap().then(s=>s.context)')
  await js(`window.eizhu.account.login(${credentials(emailA)})`)
  assert.equal(await js(`window.eizhu.app.bootstrap().then(s=>s.context.runtimeId)`), beforeReauth.runtimeId)
  step('refresh-rotation-lost-response-and-offline-restart')

  await js(`window.eizhu.account.requestPasswordReset({email:${JSON.stringify(emailA)}})`)
  await expectCode(
    `window.eizhu.account.resetPassword(${JSON.stringify({ email: emailA, code: '000000', newPassword })})`,
    'INVALID_EMAIL_CODE',
  )
  await js(
    `window.eizhu.account.resetPassword(${JSON.stringify({ email: emailA, code: '654321', newPassword })})`,
  )
  assert.equal(await js(`window.eizhu.account.status().then(s=>s.sessionState)`), 'reauth_required')
  await js(`window.eizhu.account.login(${credentials(emailA, newPassword)})`)
  fixture.dropNextLogout = true
  await js('window.eizhu.account.logout()')
  assert.equal((await js<{ id: string }>('window.eizhu.workspace.status()')).id, 'offline')
  assert.equal(await js(`window.eizhu.account.status().then(s=>s.loggedIn)`), false)
  assert.ok(
    (await js<Array<{ id: string }>>('window.eizhu.group.list()')).some((group) => group.id === sentinel.id),
  )

  await js(`window.eizhu.account.register(${credentials(emailB)})`)
  assert.deepEqual(await js('window.eizhu.group.list()'), [])
  await js('window.eizhu.account.logout()')
  await expectCode(`window.eizhu.account.register(${credentials(emailA)})`, 'ACCOUNT_EMAIL_TAKEN')
  fixture.dropNextAuth = true
  const beforeLostAuth = count('register')
  await expectCode(`window.eizhu.account.register(${credentials(emailC)})`, 'ACCOUNT_UNAVAILABLE')
  assert.equal(count('register') - beforeLostAuth, 1)
  assert.equal(await js(`window.eizhu.account.status().then(s=>s.loggedIn)`), false)
  await js(`window.eizhu.account.login(${credentials(emailC)})`)
  await js('window.eizhu.account.logout()')
  await js(`window.eizhu.account.login(${credentials(emailA, newPassword)})`)
  assert.ok(
    (await js<Array<{ id: string }>>('window.eizhu.group.list()')).some(
      (group) => group.id === accountGroup.id,
    ),
  )
  assert.equal(
    await js(
      `window.eizhu.account.status().then(s=>JSON.stringify(s).includes('accessToken')||JSON.stringify(s).includes('refreshToken'))`,
    ),
    false,
  )
  assert.equal((await js<{initialized:boolean}>('window.eizhu.sync.status()')).initialized,false)
  assert.equal((await js<{syncEnabled:boolean}>('window.eizhu.account.setSyncEnabled({enabled:false})')).syncEnabled,false)
  await js('window.eizhu.account.logout()')
  await js(`window.eizhu.group.delete({id:${JSON.stringify(sentinel.id)}})`)
  if (await js(`Boolean(document.querySelector('.settings-page-back'))`))
    await js(`document.querySelector('.settings-page-back').click()`)
  step('password-reset-local-logout-and-account-isolation')
  return {
    passed: true,
    synthetic: true,
    realBackend: false,
    realEmail: false,
    setupGate: true,
    restrictedGate: true,
    editorCancellation: true,
    editorLockedDuringTransition: true,
    editorUnlockedOnAuthFailure: true,
    rendererTransition: true,
    register: true,
    emailVerification: true,
    passwordReset: true,
    concurrentRefresh: true,
    lostRefreshRequiresLogin: true,
    lostAuthenticationNotReplayed: true,
    localLogoutOnRemoteFailure: true,
    offlineRestart: true,
    accountIsolation: true,
    publicTokenRedaction: true,
    syncRequiresConfirmation: true,
    screenshots: ['account-login-light.png', 'account-signed-in-dark.png', 'account-signed-in-narrow.png'],
  }
}
