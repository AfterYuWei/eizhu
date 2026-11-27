import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSettings } from './desktop-build-settings.mjs'

test('VERSION/channel/target share one deterministic build configuration', () => {
  const stable = buildSettings({ EIZHU_CHANNEL: 'stable' }, 'darwin', 'x64')
  const preview = buildSettings({ EIZHU_CHANNEL: 'test' }, 'darwin', 'x64')
  const local = buildSettings({}, 'darwin', 'x64')
  assert.equal(stable.version, stable.base)
  for (const release of [stable, preview]) {
    assert.equal(release.appName, 'eizhu')
    assert.equal(release.appId, 'com.yuweinfo.eizhu')
    assert.equal(release.outputDirectory, 'artifacts/desktop')
    assert.deepEqual(release.updateRepository, { owner: 'AfterYuWei', repo: 'eizhu' })
  }
  assert.match(preview.version, /^\d+\.\d+\.\d+-test\.\d+\.[a-f0-9]{8}$/)
  assert.match(local.version, /^\d+\.\d+\.\d+-dev\.\d+\.[a-f0-9]{8}$/)
  assert.equal(local.channel, 'dev')
  assert.equal(local.appName, 'eizhu-dev')
  assert.equal(local.appId, 'com.yuweinfo.eizhu.dev')
  assert.equal(local.outputDirectory, 'artifacts/desktop-dev')
  assert.equal(local.updateRepository, undefined)
  assert.deepEqual(local.feeds, {})
  assert.deepEqual(buildSettings({ EIZHU_UPDATE_TEST_URL: 'https://updates.example.com/electron/test/' }, 'darwin', 'x64'), local)
  assert.throws(() => buildSettings({ EIZHU_CHANNEL: 'invalid' }))
  assert.throws(() => buildSettings({}, 'win32', 'arm64'))
})
test('update feeds isolate Electron, channel and target; reject unsafe URLs', () => {
  const config = buildSettings(
    { EIZHU_CHANNEL: 'test', EIZHU_UPDATE_TEST_URL: 'https://updates.example.com/electron/test/' },
    'darwin',
    'arm64',
  )
  assert.equal(config.feeds.test, 'https://updates.example.com/electron/test/darwin-arm64/')
  assert.equal(config.feeds.stable, undefined)
  for (const value of [
    'http://updates.example.com/electron/test/',
    'https://user:secret@updates.example.com/electron/test/',
    'https://updates.example.com/tauri/',
    'https://updates.example.com/electron/stable/',
    'https://account.eizhu.invalid/electron/test/',
    'https://updates.example.com/electron/test/?token=secret',
  ])
    assert.throws(() => buildSettings({ EIZHU_CHANNEL: 'test', EIZHU_UPDATE_TEST_URL: value }))
})
