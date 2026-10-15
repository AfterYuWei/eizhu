import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountServerForChannel, TEST_ACCOUNT_SERVER_PLACEHOLDER, validateAccountServer } from './account-server-config.mjs'

test('rejects missing, placeholder and credential-bearing package addresses', () => {
  for (const value of [undefined, '', 'not a URL', 'http://host.test', 'https://account.eizhu.invalid',
    'https://example.com', 'https://example.org', 'https://account.eizhu.invalid.', 'https://foo\nbar.test',
    'https://u:p@host.test', 'https://host.test/?token=x', 'https://host.test/#x']) {
    assert.throws(() => validateAccountServer(value), undefined, String(value))
  }
  assert.equal(validateAccountServer(' https://accounts.host.test/api '), 'https://accounts.host.test/api')
})

test('stable never falls back to the test service', () => {
  const environment = { EIZHU_ACCOUNT_SERVER_TEST: 'https://test.host.test', EIZHU_ACCOUNT_SERVER_STABLE: 'https://stable.host.test' }
  assert.equal(accountServerForChannel('stable', environment), 'https://stable.host.test/')
  assert.equal(accountServerForChannel('test', environment), 'https://test.host.test/')
  assert.throws(() => accountServerForChannel('stable', { EIZHU_ACCOUNT_SERVER_TEST: environment.EIZHU_ACCOUNT_SERVER_TEST }))
  assert.throws(() => accountServerForChannel('dev', environment))
})

test('test channel uses the reserved placeholder until its service is configured', () => {
  for (const value of [undefined, '', '   ']) {
    assert.equal(accountServerForChannel('test', { EIZHU_ACCOUNT_SERVER_TEST: value }), TEST_ACCOUNT_SERVER_PLACEHOLDER)
  }
  assert.equal(validateAccountServer(TEST_ACCOUNT_SERVER_PLACEHOLDER, { channel: 'test' }), TEST_ACCOUNT_SERVER_PLACEHOLDER)
  assert.throws(() => validateAccountServer(TEST_ACCOUNT_SERVER_PLACEHOLDER, { channel: 'stable' }))
  assert.throws(() => accountServerForChannel('stable', {}))
  assert.throws(() => accountServerForChannel('stable', { EIZHU_ACCOUNT_SERVER_STABLE: TEST_ACCOUNT_SERVER_PLACEHOLDER }))
})

test('test channel still rejects invalid configured addresses and credentials', () => {
  for (const value of ['not a URL', 'http://host.test', 'https://example.com', 'https://other.invalid',
    'https://u:p@account.eizhu.invalid/', 'https://account.eizhu.invalid/?token=x']) {
    assert.throws(() => accountServerForChannel('test', { EIZHU_ACCOUNT_SERVER_TEST: value }), undefined, value)
  }
})
