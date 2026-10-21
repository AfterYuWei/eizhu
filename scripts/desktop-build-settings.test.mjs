import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSettings } from './desktop-build-settings.mjs'

test('VERSION/channel/target share one deterministic build configuration', () => {
  const stable = buildSettings({ EIZHU_CHANNEL: 'stable' }, 'darwin', 'x64')
  const preview = buildSettings({}, 'darwin', 'x64')
  assert.equal(stable.version, stable.base)
  assert.ok(preview.version.startsWith(`${stable.base}-test.`))
  assert.match(preview.version, /-test\.\d+\.[a-f0-9]{8}$/)
  assert.deepEqual(buildSettings({}, 'darwin', 'x64'), preview)
  assert.throws(() => buildSettings({ EIZHU_CHANNEL: 'invalid' }))
  assert.throws(() => buildSettings({}, 'win32', 'arm64'))
})
test('update feeds isolate Electron, channel and target; reject unsafe URLs', () => {
  const config = buildSettings(
    { EIZHU_UPDATE_TEST_URL: 'https://updates.example.com/electron/test/' },
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
    assert.throws(() => buildSettings({ EIZHU_UPDATE_TEST_URL: value }))
})
