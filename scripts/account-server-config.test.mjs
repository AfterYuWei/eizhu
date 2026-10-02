import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountServerForChannel, validateAccountServer } from './account-server-config.mjs'

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
