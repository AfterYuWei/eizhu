import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Updates, validateUpdateInfo } from './updates.ts'
import type { UpdateInfo } from 'electron-updater'
import { updateProgressSchema, foundation } from '@eizhu/contracts'

const info: UpdateInfo = {
  version: '1.0.0',
  releaseDate: '',
  path: 'eizhu-1.0.0.zip',
  sha512: Buffer.alloc(64).toString('base64'),
  files: [{ url: 'eizhu-1.0.0.zip', sha512: Buffer.alloc(64).toString('base64'), size: 1024 }],
}
function setup() {
  const driver = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    allowPrerelease: false,
    disableDifferentialDownload: false,
    logger: null,
    feed: '',
    installs: 0,
    downloads: 0,
    setFeedURL(config: { url: string }) {
      this.feed = config.url
    },
    async checkForUpdates() {
      return { isUpdateAvailable: true, updateInfo: info }
    },
    async downloadUpdate() {
      this.downloads++
      return ['private-cache-path']
    },
    quitAndInstall() {
      this.installs++
    },
  })
  let accept = false
  const progress: unknown[] = []
  const service = new Updates({
    driver: driver as unknown as ConstructorParameters<typeof Updates>[0]['driver'],
    supported: true,
    feeds: { test: 'https://updates.example.com/electron/test/darwin-x64/' },
    progress: (value) => progress.push(value),
    install: async (action) => {
      if (accept) action()
      return accept
    },
  })
  return {
    driver,
    service,
    progress,
    accept: () => {
      accept = true
    },
  }
}
test('candidate is pinned, old token expires, cancelled close never installs, retry uses verified cache', async () => {
  const s = setup()
  assert.equal(s.driver.autoDownload, false)
  assert.equal(s.driver.autoInstallOnAppQuit, false)
  assert.equal(s.driver.allowDowngrade, false)
  await assert.rejects(s.service.check('stable'), {
    error: { code: 'UPDATE_NOT_CONFIGURED', message: '此通道尚未配置独立 Electron 更新源，请手动安装' },
  })
  const first = (await s.service.check('test')).candidate!
  const second = (await s.service.check('test')).candidate!
  await assert.rejects(s.service.download(first.token))
  await assert.rejects(s.service.install(second.token))
  await s.service.download(second.token)
  await assert.rejects(s.service.install(second.token))
  assert.equal(s.driver.installs, 0)
  s.accept()
  await s.service.download(second.token)
  await s.service.install(second.token)
  assert.equal(s.driver.downloads, 1)
  assert.equal(s.driver.installs, 1)
  assert.equal(updateProgressSchema.parse(s.progress[0]).token, second.token)
})
test('busy update prevents provider replacement; failed download invalidates candidate and redacts errors', async () => {
  const s = setup(),
    selected = (await s.service.check('test')).candidate!
  let release!: () => void
  s.driver.downloadUpdate = async () => {
    await new Promise<void>((r) => {
      release = r
    })
    throw new Error('secret-url-token')
  }
  const pending = s.service.download(selected.token)
  await assert.rejects(s.service.check('test'))
  assert.throws(() => s.service.invalidate())
  release()
  await assert.rejects(pending, (error: Error) => !error.message.includes('secret-url-token'))
  await assert.rejects(s.service.install(selected.token))
})
test('release metadata rejects external paths, traversal, wrong channel and missing digest', () => {
  validateUpdateInfo(info, 'stable')
  for (const url of [
    'https://other.example.com/eizhu.zip',
    '../eizhu.zip',
    'file:///tmp/eizhu.zip',
    '%2fsecret.zip',
  ])
    assert.throws(() => validateUpdateInfo({ ...info, files: [{ ...info.files[0], url }] }, 'stable'))
  assert.throws(() => validateUpdateInfo({ ...info, version: '1.0.0-test.2.abc' }, 'stable'))
  assert.throws(() => validateUpdateInfo({ ...info, files: [{ ...info.files[0], sha512: '' }] }, 'test'))
  assert.throws(() =>
    foundation['update.download'].input.parse({ token: 'path', url: 'https://example.com' }),
  )
  assert.throws(() =>
    updateProgressSchema.parse({ token: crypto.randomUUID(), phase: 'downloading', percent: Infinity }),
  )
})
test('synchronous installer errors cannot be reported as a successful install', async () => {
  const s = setup(),
    selected = (await s.service.check('test')).candidate!
  await s.service.download(selected.token)
  s.accept()
  s.driver.quitAndInstall = () => {
    s.driver.emit('error', new Error('private cache path'))
  }
  await assert.rejects(
    s.service.install(selected.token),
    (error: Error) => error.message.includes('无法启动更新安装') && !error.message.includes('private cache'),
  )
  await assert.rejects(s.service.install(selected.token), (error: Error) =>
    error.message.includes('重启应用'),
  )
})
