import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import updater from 'electron-updater'
import { Updates } from './updates.ts'

/** Real updater transport and SHA-512 rejection, isolated from user cache/installer. */
export async function verifyStage6(window: BrowserWindow, root: string) {
  const bridgeResult = await window.webContents.executeJavaScript(`(async()=>({
    check:await window.eizhu.update.check({channel:'test'}).then(()=>false,e=>['UPDATE_NOT_CONFIGURED','UPDATE_UNSUPPORTED'].includes(e.code)),
    token:await window.eizhu.update.download({token:crypto.randomUUID()}).then(()=>false,e=>e.code==='UPDATE_EXPIRED')
  }))()`)
  assert.deepEqual(bridgeResult, { check: true, token: true })
  const cache = join(root, 'stage6-update-cache'),
    config = join(root, 'stage6-update.yml')
  await mkdir(cache)
  await writeFile(config, 'updaterCacheDirName: isolated-stage6\n')
  let downloads = 0,
    manifests = 0
  const payload = Buffer.from('synthetic installer with deliberately incorrect declared digest')
  const file = 'eizhu-9999.0.0.exe'
  const server = createServer((request, response) => {
    if (request.url?.split('?')[0].endsWith('.yml')) {
      manifests++
      response.end(
        `version: 9999.0.0\nfiles:\n  - url: ${file}\n    sha512: ${Buffer.alloc(64).toString('base64')}\n    size: ${payload.length}\npath: ${file}\nsha512: ${Buffer.alloc(64).toString('base64')}\nreleaseDate: '2026-10-21T00:00:00.000Z'\n`,
      )
    } else if (request.url?.split('?')[0] === '/' + file) {
      downloads++
      response.setHeader('Content-Length', payload.length)
      response.end(payload)
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const adapter = {
      version: '0.0.0',
      name: 'stage6-smoke',
      isPackaged: true,
      appUpdateConfigPath: config,
      userDataPath: cache,
      baseCachePath: cache,
      whenReady: async () => {},
      relaunch: () => assert.fail('No real relaunch in smoke'),
      quit: () => assert.fail('No real installation in smoke'),
      onQuit: () => {},
    }
    // Exercise the shared downloader without starting a platform installer or Squirrel server.
    const driver = new updater.NsisUpdater(undefined, adapter)
    // v6.8.9 deliberately leaves the executor null with a custom AppAdapter.
    // Reuse the real Electron executor while keeping staging/cache paths isolated.
    Object.assign(driver, { httpExecutor: Reflect.get(updater.autoUpdater, 'httpExecutor') })
    const service = new Updates({
      driver,
      supported: true,
      feeds: { test: `http://127.0.0.1:${(server.address() as { port: number }).port}/` },
      progress: () => {},
      install: async () => assert.fail('Invalid digest cannot install'),
    })
    const candidate = (await service.check('test')).candidate!
    assert.equal(candidate.version, '9999.0.0')
    await assert.rejects(service.download(candidate.token), (error: Error) =>
      error.message.includes('下载或校验失败'),
    )
    await assert.rejects(service.install(candidate.token))
    assert.equal(manifests, 1)
    assert.equal(downloads, 1)
    await window.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,shiftKey:true,bubbles:true}))`,
    )
    const wait = async (expression: string) => {
      for (let i = 0; i < 100; i++) {
        if (await window.webContents.executeJavaScript(expression)) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.fail('Stage6 UI timeout')
    }
    await wait(
      `(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='关于');if(!tab)return false;tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true})()`,
    )
    await wait(
      `(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent==='检查更新');return button?.disabled&&document.body.innerText.includes('手动安装')&&document.body.innerText.includes('版本页面')})()`,
    )
    // Let the settings panel settle before preserving visual evidence.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await writeFile(
      join(root, 'stage6-update.png'),
      (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG(),
    )
    await window.webContents.executeJavaScript(`document.querySelector('.settings-page-back').click()`)
    return {
      passed: true,
      ipcValidation: true,
      uiUnconfiguredFeedback: true,
      realUpdaterMetadata: true,
      sha512MismatchRejected: true,
      noRecheckDuringDownload: true,
      cacheIsolated: true,
      realSignedUpgrade: false,
      transport: 'electron-updater shared HTTP downloader through NsisUpdater',
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
