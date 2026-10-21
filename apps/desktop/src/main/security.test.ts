import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assetPath, isTrustedPage } from './security.ts'
test('asset protocol rejects another host, scheme, encoded traversal and path separators', () => {
  const root = resolve('/tmp/eizhu-renderer')
  assert.equal(assetPath(root, 'eizhu://app/index.html'), resolve(root, 'index.html'))
  for (const url of [
    'file:///etc/passwd',
    'eizhu://other/index.html',
    'eizhu://app/%2e%2e%2fsecret',
    'eizhu://app/%5csecret',
  ])
    assert.equal(assetPath(root, url), null)
})
test('page authorization checks exact origin instead of URL prefix matching', () => {
  assert.equal(isTrustedPage('eizhu://app/index.html'), true)
  assert.equal(isTrustedPage('eizhu://attacker/index.html'), false)
  assert.equal(isTrustedPage('http://127.0.0.1:5173/index.html', 'http://127.0.0.1:5173'), true)
  assert.equal(isTrustedPage('http://127.0.0.1:5173.attacker.invalid/', 'http://127.0.0.1:5173'), false)
})
