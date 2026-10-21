import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactLogText } from '../logging.ts'
test('redacts multiline keys, quoted passwords, bearer tokens, query tokens and URL credentials', () => {
  const values = [
    '-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-key\n-----END OPENSSH PRIVATE KEY-----',
    'password="synthetic password"',
    'Bearer synthetic-token',
    'https://example.invalid/?access_token=synthetic-token',
    'https://synthetic-user:synthetic-password@example.invalid/',
  ]
  for (const value of values) assert.equal(redactLogText(value).includes('synthetic'), false)
  assert.equal(redactLogText('WORKSPACE_CHANGED request timed out'), 'WORKSPACE_CHANGED request timed out')
})
