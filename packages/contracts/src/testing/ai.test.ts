import test from 'node:test'
import assert from 'node:assert/strict'
import { ai, aiEndpointSchema } from '../ai.ts'

const connection = {
  id: 'provider',
  name: '供应商',
  protocol: 'responses',
  endpoint: 'https://provider.invalid/v1',
  clearKey: false,
}

test('model discovery allows an empty or not-yet-chosen model without relaxing save or test validation', () => {
  for (const model of [undefined, '']) {
    const input = { ...connection, model }
    assert.equal(ai['ai.discover'].input.parse(input).model, '')
    assert.equal(ai['ai.configure'].input.safeParse(input).success, false)
    assert.equal(ai['ai.test'].input.safeParse(input).success, false)
  }
  assert.equal(ai['ai.discover'].input.safeParse({ ...connection, model: 'x'.repeat(161) }).success, false)
  assert.equal(ai['ai.discover'].input.safeParse({ ...connection, extra: true }).success, false)
})

test('invalid and empty endpoints fail validation without throwing a URL constructor exception', () => {
  for (const endpoint of ['', 'not a URL', 'https://', 'http://remote.invalid/v1', 'file:///tmp/model'])
    assert.equal(aiEndpointSchema.safeParse(endpoint).success, false)
  for (const endpoint of [
    'https://provider.invalid/v1',
    'http://127.0.0.1:8080/v1',
    'http://localhost:11434/v1',
    'http://[::1]:8080/v1',
  ])
    assert.equal(aiEndpointSchema.safeParse(endpoint).success, true)
})

test('discovery preserves the endpoint credential, query and fragment restrictions', () => {
  for (const endpoint of [
    'https://user:password@provider.invalid/v1',
    'https://provider.invalid/v1?api_key=example',
    'https://provider.invalid/v1#fragment',
  ])
    assert.equal(ai['ai.discover'].input.safeParse({ ...connection, endpoint }).success, false)
})
