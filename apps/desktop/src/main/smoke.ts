import { verifyStage3 } from './stage3-smoke.ts'
import { verifyStage5 } from './stage5-smoke.ts'
import { verifyStage6 } from './stage6-smoke.ts'
import { verifyStage4 } from './stage4-smoke.ts'
import { verifyWorkspaceTabs } from './workspace-tabs-smoke.ts'
import { app, BrowserWindow as TestWindow, screen } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import type { Windows } from './windows.ts'
import type { RuntimeHost } from './runtime-host.ts'
import updater from 'electron-updater'

async function shown(window: BrowserWindow): Promise<void> {
  if (window.isVisible()) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Renderer bootstrap timed out')), 30000)
    window.once('show', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
async function prepareCapture(window: BrowserWindow, theme: 'light' | 'dark'): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      window.webContents.executeJavaScript(`(async()=>{
        await document.fonts.ready;
        let style=document.getElementById('eizhu-smoke-capture');
        if(!style){style=document.createElement('style');style.id='eizhu-smoke-capture';style.textContent='*,*::before,*::after{transition:none!important;animation:none!important}';document.head.append(style)}
        document.documentElement.classList.remove('light','dark');
        document.documentElement.classList.add(${JSON.stringify(theme)});
        getComputedStyle(document.body).backgroundColor;
        await Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),new Promise(resolve=>setTimeout(resolve,250))]);
      })()`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Smoke capture frame timed out')), 10000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
function sidebarBrightness(capture: Electron.NativeImage): number {
  const { width, height } = capture.getSize(),
    data = capture.toBitmap()
  const offset = (Math.floor(height * 0.55) * width + Math.floor(width * 0.05)) * 4
  return (data[offset] + data[offset + 1] + data[offset + 2]) / 3
}
/** Runs only with --smoke-test and an explicit isolated temporary data root. Never loads user data. */
export async function runSmoke(options: {
  windows: Windows
  runtime: () => RuntimeHost
  load: (window: BrowserWindow) => Promise<void>
  root: string
  keyMode: string
  startedAt: number
  assets:string
}): Promise<void> {
  const { windows, root } = options,
    window = windows.main
  const step = (name: string) => console.log('EIZHU_SMOKE_STEP', name)
  step('waiting-renderer')
  try{await shown(window)}catch(error){
    const state=await window.webContents.executeJavaScript(`({ready:document.readyState,bridge:typeof window.eizhu,body:document.body.innerText.slice(0,200),root:document.querySelector('#root')?.childElementCount})`).catch(()=>({probe:'failed'}))
    console.error('EIZHU_SMOKE_BOOTSTRAP_STATE',JSON.stringify(state));throw error
  }
  step('renderer-ready')
  const firstWindowMs = performance.now() - options.startedAt
  const health = await options.runtime().call('runtime.health')
  const crypto = await options.runtime().call('runtime.smoke')
  const renderer = await window.webContents.executeJavaScript(`(async () => ({
    node: typeof process, require: typeof require, bridge: typeof window.eizhu.app.bootstrap,
    health: await window.eizhu.runtime.health(), text: document.body.innerText.includes('新建连接'),
    reserved: await window.eizhu.account.status().then(() => 'unexpected-success', e => e.code),
    local: await window.eizhu.group.list(),
    arbitraryPath: await window.eizhu.backup.preview({ filePath: '/etc/passwd' }).then(() => 'unexpected-success', e => e.code),
    inputValidation: await window.eizhu.settings.write({ key: 'credential', value: 'synthetic' }).then(() => 'unexpected-success', e => e.code)
  }))()`)
  assert.equal(renderer.node, 'undefined')
  assert.equal(renderer.require, 'undefined')
  assert.equal(renderer.text, true)
  assert.equal(renderer.reserved, 'STAGE_NOT_READY')
  assert.equal(renderer.inputValidation, 'BAD_REQUEST')
  assert.deepEqual(renderer.local, [])
  assert.equal(renderer.arbitraryPath, 'FORBIDDEN')
  step('foundation-bridge-passed')
  const stage6 = await verifyStage6(window, root)
  step('stage6-updater-passed')
  const workspaceTabs = await verifyWorkspaceTabs(window, root)
  step('workspace-tabs-passed')
  const localBridge = await window.webContents.executeJavaScript(`(async () => {
    const api=window.eizhu;
    const group=await api.group.create({request:{name:'阶段 2 合成分组'}});
    const key=await api.vault.generateKeyPair({request:{algo:'ed25519',passphrase:'合成私钥密语'}});
    const vault=await api.vault.create({request:{name:'阶段 2 合成密钥',type:'private_key',private_key:key.private_key,public_key:key.public_key,passphrase:'合成私钥密语'}});
    const profile=await api.profile.create({request:{name:'阶段 2 合成服务器',host:'stage2.example.invalid',username:'deploy',auth_type:'vault',vault_id:vault.id,group_id:group.id}});
    const revealed=await api.vault.reveal({id:vault.id});
    const protectedDelete=await api.vault.delete({id:vault.id}).then(()=>false,e=>e.code==='IN_USE');
    const audit=await api.audit.list({limit:100});
    const result={crud:Boolean(profile.id),computeWorker:key.private_key.includes('OPENSSH PRIVATE KEY'),revealed:revealed.public_key===key.public_key,protectedDelete,redacted:!JSON.stringify(await api.vault.list({vaultType:null,q:null})).includes('PRIVATE KEY'),audit:audit.some(row=>row.action==='vault_reveal'),profileId:profile.id,vaultId:vault.id,groupId:group.id};
    return result;
  })()`)
  for (const key of ['crud', 'computeWorker', 'revealed', 'protectedDelete', 'redacted', 'audit'])
    assert.equal(localBridge[key], true)
  step('local-bridge-passed')
  const stage2 = await options
    .runtime()
    .call<{ passed: boolean }>('runtime.verifyStage2', { fixtures: process.env.EIZHU_SMOKE_FIXTURES })
  assert.equal(stage2.passed, true)
  step('stage2-native-passed')
  const stage3=await verifyStage3(window,options.runtime(),root)
  const stage3Storage=await options.runtime().call<{passed:boolean}>('runtime.verifyStage3Storage')
  assert.equal(stage3Storage.passed,true)
  step('stage3-native-passed')
  const stage4=await verifyStage4(window,options.runtime(),windows,root,options.assets)
  step('stage4-native-passed')
  const stage5=await verifyStage5(window,options.runtime(),root)
  step('stage5-native-passed')
  // An occluded smoke window can suspend animation frames. Keep only this test window drawing.
  // This setting is limited to this synthetic smoke window; normal application throttling is unchanged.
  window.webContents.backgroundThrottling = false
  window.setContentSize(1280, 720)
  await prepareCapture(window, 'light')
  step('light-capture-ready')
  const light = await window.webContents.capturePage(undefined, { stayAwake: true })
  await writeFile(join(root, 'home-light.png'), light.toPNG())
  step('light-captured')
  await prepareCapture(window, 'dark')
  const dark = await window.webContents.capturePage(undefined, { stayAwake: true })
  await writeFile(join(root, 'home-dark.png'), dark.toPNG())
  const screenshotContrast = { light: sidebarBrightness(light), dark: sidebarBrightness(dark) }
  assert.ok(
    screenshotContrast.light > 160 &&
      screenshotContrast.dark < 130 &&
      screenshotContrast.light - screenshotContrast.dark > 80,
    'Captured themes must contain distinct painted light/dark surfaces',
  )
  step('dark-captured')

  const editor = windows.create('editor')
  const available = screen.getDisplayMatching(editor.getBounds()).workAreaSize
  const content = editor.getContentSize()
  const outer = editor.getSize()
  const frameWidth = outer[0] - content[0]
  const frameHeight = outer[1] - content[1]
  const editorGeometry = {
    requested: [1280, 800],
    actual: content,
    workArea: [available.width, available.height],
    frame: [frameWidth, frameHeight],
  }
  // Native window managers may preserve the requested size or constrain either axis to the work area.
  const constrained = [
    Math.min(1280, available.width - frameWidth),
    Math.min(800, available.height - frameHeight),
  ]
  for (const [axis, size] of content.entries()) {
    assert.ok(
      size === editorGeometry.requested[axis] || size === constrained[axis],
      `Editor axis ${axis}: ${size}; requested ${editorGeometry.requested[axis]}, work-area limit ${constrained[axis]}`,
    )
  }
  await options.load(editor)
  await shown(editor)
  step('editor-ready')
  assert.equal(await windows.confirmTransition(), true)
  assert.equal(await windows.confirmApplicationClose(), true)
  const persistedValue = JSON.stringify({ state: { theme: 'light' }, version: 1 })
  await window.webContents.executeJavaScript(
    'window.eizhu.settings.write(' + JSON.stringify({ key: 'eizhu-settings', value: persistedValue }) + ')',
  )
  const editorBootstrap = await editor.webContents.executeJavaScript('window.eizhu.app.bootstrap()')
  assert.equal(editorBootstrap.window, 'editor')
  assert.equal(editorBootstrap.context.runtimeId, options.runtime().context.runtimeId)
  await writeFile(join(root, 'editor-empty.png'), (await editor.webContents.capturePage()).toPNG())

  // Kill the real utility process, preserve renderer memory, restart from committed SQLite state.
  const before = options.runtime().context
  await editor.webContents.executeJavaScript(`window.__eizhuSmokeUnsaved = 'synthetic unsaved buffer'`)
  process.kill(options.runtime().processId!, 'SIGTERM')
  const failed = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      const status = await window.eizhu.runtime.health().then(() => 'alive', e => e.code)
      if (status === 'RUNTIME_UNAVAILABLE') return status
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return 'timeout'
  })()`)
  assert.equal(failed, 'RUNTIME_UNAVAILABLE')
  const restored = await window.webContents.executeJavaScript('window.eizhu.runtime.restart()')
  step('runtime-restarted')
  const recoveredVersions=await window.webContents.executeJavaScript('window.eizhu.backup.versions()') as Array<{id:string}>
  assert.ok(recoveredVersions.some(v=>v.id===stage5.persistedVersionId))
  if(stage4.passed){
    const fileRecovery=await window.webContents.executeJavaScript(`(async()=>{
      const api=window.eizhu,id=${JSON.stringify(stage4.restoredTaskId)};
      const task=(await api.sftp.listTransfers({})).find(t=>t.id===id);
      if(task?.status!=='recoverable')throw new Error('Checkpoint did not recover');
      const local=await api.sftp.createSession({profileId:'local'});
      const proof=await api.sftp.uploadCheckpoint({taskId:id});
      const resumed=await api.sftp.resumeUpload({taskId:id,size:6,lastModified:42,restart:false,prefixHash:proof.prefix_hash});
      await api.sftp.uploadChunk({uploadId:resumed.upload_id,sequence:resumed.sequence,data:new TextEncoder().encode('def')});
      await api.sftp.uploadFinish({uploadId:resumed.upload_id});
      for(let i=0;i<300;i++){
        const finished=(await api.sftp.listTransfers({})).find(t=>t.id===id);
        if(finished.status==='failed')throw new Error(finished.error_message);
        if(finished.status==='completed'){
          await api.sftp.closeSession({id:local.session_id});return resumed.received===3;
        }
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      throw new Error('Upload completion timeout');
    })()`)
    assert.equal(fileRecovery,true);step('stage4-checkpoint-restarted')
  }
  assert.notEqual(restored.runtimeId, before.runtimeId)
  assert.equal(restored.generation, before.generation + 1)
  assert.equal(
    await editor.webContents.executeJavaScript('window.__eizhuSmokeUnsaved'),
    'synthetic unsaved buffer',
  )
  assert.equal(await windows.confirmTransition(), true)
  const persisted = await options.runtime().call<Record<string, string>>('settings.read')
  assert.equal(persisted['eizhu-settings'], persistedValue)
  const persistedProfile = await window.webContents.executeJavaScript(
    'window.eizhu.profile.get(' + JSON.stringify({ id: localBridge.profileId }) + ')',
  )
  assert.equal(persistedProfile.host, 'stage2.example.invalid')
  await window.webContents.executeJavaScript(
    `(async()=>{const api=window.eizhu;await api.profile.delete(${JSON.stringify({ id: localBridge.profileId })});await api.vault.delete(${JSON.stringify({ id: localBridge.vaultId })});await api.group.delete(${JSON.stringify({ id: localBridge.groupId })})})()`,
  )
  step('local-persistence-passed')
  const offlineEditor = new TestWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  })
  let monaco: { typescript: boolean; json: boolean; model: boolean }
  try {
    await offlineEditor.loadURL('eizhu://app/smoke.html')
    monaco = await offlineEditor.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 300; i++) {
        const result = document.getElementById('result')
        if (result?.dataset.state === 'passed') return JSON.parse(result.textContent)
        if (result?.dataset.state === 'failed') throw new Error(result.textContent)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Monaco worker timed out')
    })()`)
    assert.deepEqual(monaco, { typescript: true, json: true, model: true })
  } finally {
    offlineEditor.destroy()
  }
  step('monaco-passed')
  const report = {
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    packaged: app.isPackaged,
    dataRoot: root,
    keyMode: options.keyMode,
    health,
    crypto,
    renderer,
    stage2,
    stage3,
    stage3Storage,
    stage4,
    stage5,
    stage6,
    workspaceTabs,
    localBridge,
    editor: true,
    editorGeometry,
    recovery: {
      failed,
      generation: restored.generation,
      retainedEditorMemory: true,
      persistedSettings: true,
    },
    updaterModule: typeof updater.autoUpdater.checkForUpdates === 'function',
    monaco,
    firstWindowMs,
    processMetrics: app.getAppMetrics().map(({ type, memory, cpu }) => ({ type, memory, cpu })),
    screenshots: ['home-light.png', 'home-dark.png', 'editor-empty.png', ...workspaceTabs.screenshots],
    screenshotContrast,
  }
  await writeFile(join(root, 'smoke.json'), JSON.stringify(report, null, 2))
  console.log('EIZHU_SMOKE_OK', JSON.stringify(report))
}
