import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SUMMARY_COMMAND, METRIC_COMMANDS, parseSummary, parseMetricDetail } from './metrics.ts'
import { ssh } from '@eizhu/contracts'

const execute = promisify(execFile)

test(
  'summary and selected detail scripts execute independently against controlled proc/tool fixtures',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'eizhu-metrics-'))
    const proc = join(root, 'proc'),
      bin = join(root, 'bin')
    try {
      await mkdir(proc)
      await mkdir(join(proc, 'net'))
      await mkdir(bin)
      await writeFile(join(proc, 'stat-before'), 'cpu 10 0 0 90 0 0 0 0\ncpu0 10 0 0 90 0 0 0 0\n')
      await writeFile(join(proc, 'stat-after'), 'cpu 30 0 0 170 0 0 0 0\ncpu0 30 0 0 170 0 0 0 0\n')
      await writeFile(join(proc, 'net-before'), 'header\nheader\neth0: 10 0 0 0 0 0 0 0 20 0 0 0 0 0 0 0\n')
      await writeFile(join(proc, 'net-after'), 'header\nheader\neth0: 210 0 0 0 0 0 0 0 420 0 0 0 0 0 0 0\n')
      await writeFile(join(proc, 'meminfo'), 'MemTotal: 1000 kB\nMemAvailable: 600 kB\n')
      await writeFile(join(proc, 'cpuinfo'), 'cpu MHz : 2400\n')
      await writeFile(
        join(bin, 'sleep'),
        '#!/bin/sh\ncp "$EIZHU_METRICS_TEST_PROC/stat-after" "$EIZHU_METRICS_TEST_PROC/stat"\ncp "$EIZHU_METRICS_TEST_PROC/net-after" "$EIZHU_METRICS_TEST_PROC/net/dev"\necho "102.0 0" > "$EIZHU_METRICS_TEST_PROC/uptime"\n',
        { mode: 0o700 },
      )
      await writeFile(
        join(bin, 'df'),
        '#!/bin/sh\necho "Filesystem 1-blocks Used Available Capacity Mounted on"\necho "/dev/sda 200 100 100 50% /"\ncase "$*" in *tmpfs*) echo "/dev/sdb 1000 250 750 25% /srv/data files";; esac\n',
        { mode: 0o700 },
      )
      await writeFile(join(bin, 'ps'), '#!/bin/sh\necho "4 2 app worker"\n', { mode: 0o700 })
      const run = async (command: string) => {
        await execute('/bin/cp', [join(proc, 'stat-before'), join(proc, 'stat')])
        await execute('/bin/cp', [join(proc, 'net-before'), join(proc, 'net/dev')])
        await writeFile(join(proc, 'uptime'), '100.0 0\n')
        const result = await execute('/bin/sh', ['-c', command.replaceAll('/proc/', `${proc}/`)], {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, EIZHU_METRICS_TEST_PROC: proc },
          timeout: 5000,
        })
        return result.stdout
      }
      assert.ok(!SUMMARY_COMMAND.includes('ps -eo'))
      assert.ok(!SUMMARY_COMMAND.includes('/proc/cpuinfo'))
      assert.ok(!SUMMARY_COMMAND.includes('cpu[0-9]'))
      assert.deepEqual(parseSummary(await run(SUMMARY_COMMAND)), {
        cpu: 20,
        mem_percent: 40,
        disk_percent: 50,
        net_rx: 100,
        net_tx: 200,
      })
      const cpu = parseMetricDetail('cpu', await run(METRIC_COMMANDS.cpu))
      assert.equal(cpu.kind, 'cpu')
      if (cpu.kind === 'cpu') {
        assert.deepEqual(cpu.cpu_detail, [20])
        assert.equal(cpu.cpu_mhz, 2400)
      }
      const memory = parseMetricDetail('memory', await run(METRIC_COMMANDS.memory))
      assert.equal(memory.kind, 'memory')
      if (memory.kind === 'memory')
        assert.deepEqual(memory.mem_detail, [{ name: 'app worker', percent: 2, rss: 4096 }])
      const disk = parseMetricDetail('disk', await run(METRIC_COMMANDS.disk))
      assert.equal(disk.kind, 'disk')
      if (disk.kind === 'disk') {
        assert.equal(disk.volumes[1].path, '/srv/data files')
        assert.equal(disk.volumes[1].percent, 25)
      }
      const network = parseMetricDetail('network', await run(METRIC_COMMANDS.network))
      assert.equal(network.kind, 'network')
      if (network.kind === 'network')
        assert.deepEqual(network.net_detail, [{ name: 'eth0', rx: 100, tx: 200 }])
      assert.ok(!METRIC_COMMANDS.memory.includes('sleep'))
      assert.ok(!METRIC_COMMANDS.disk.includes('sleep'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test('missing, malformed and mismatched detail samples fail clearly; arbitrary selectors are rejected', () => {
  assert.throws(() => parseSummary(''), /proc/)
  assert.throws(() => parseMetricDetail('memory', '===STATIC===\nMT 100\nMU 50'), /进程/)
  assert.throws(() => parseMetricDetail('disk', '===STATIC===\nDU 50\nDT 100'), /挂载点/)
  assert.throws(
    () =>
      parseMetricDetail(
        'network',
        '===TIME1===\n1\n===TIME2===\n1\n===NET1===\neth0 0 0\n===NET2===\neth0 10 10',
      ),
    /采样/,
  )
  assert.throws(() => parseMetricDetail('cpu', '===CPU1===\nT 1 2\n===CPU2===\nT 2 3'), /不完整/)
  assert.throws(() =>
    ssh['serverDetail.getMetricDetail'].input.parse({ sessionId: 'one', kind: 'cpu; rm -rf /' }),
  )
  assert.throws(() => ssh['serverDetail.getSummary'].input.parse({ sessionId: 'one', command: 'whoami' }))
})
