import test from 'node:test'
import assert from 'node:assert/strict'
import { completionCommand, quote } from './completion.ts'
import { parseMetrics, parseInfo } from './metrics.ts'
test('fixed generators quote path and namespace operands and never run package scripts', () => {
  assert.equal(quote("a'b"), "'a'\\''b'")
  const command = completionCommand(
    { generatorId: 'kubectl-resources', params: { namespace: "x'; touch /tmp/pwn; '" } },
    "/tmp/a'b",
  )
  assert.ok(command.includes("cd -- '/tmp/a'\\''b'"))
  assert.ok(command.includes(quote("x'; touch /tmp/pwn; '")))
  assert.ok(!completionCommand({ generatorId: 'npm-scripts', params: {} }).includes('npm run'))
})
test('metrics preserve CPU, memory, disk and network delta semantics', () => {
  const m = parseMetrics(
    '===CPU1===\nT 10 0 0 90 0 0 0 0\nC0 10 0 0 90 0 0 0 0\n===CPU2===\nT 30 0 0 170 0 0 0 0\nC0 30 0 0 170 0 0 0 0\n===NET1===\neth0 10 20\n===NET2===\neth0 110 220\n===STATIC===\nMT 1000\nMU 400\nDU 100\nDT 200\nMP shell 2 40\nCM 2400',
  )
  assert.equal(m.cpu, 20)
  assert.equal(m.mem_percent, 40)
  assert.equal(m.net_rx, 100)
  assert.equal(m.disk_percent, 50)
  assert.throws(() => parseMetrics(''), /proc/)
  assert.equal(parseInfo('===PRODUCT===\nproxmox\n===HOSTNAME===\nhost\n===OS===\nDebian').icon, 'os-proxmox')
})
