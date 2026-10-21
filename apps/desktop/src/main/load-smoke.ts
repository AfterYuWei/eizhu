import assert from 'node:assert/strict'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { displayPath } from '@eizhu/core/sftp/endpoint'

/** Bounded synthetic load. This measures IPC responsiveness, not human interaction or 8h stability. */
export async function measureDesktopLoad(
  window: BrowserWindow,
  root: string,
  initial: string,
  open: () => Promise<string>,
  detailId: string,
) {
  const call = <T = unknown>(operation: string, input?: unknown): Promise<T> =>
    window.webContents.executeJavaScript(
      `window.eizhu.${operation}(${input === undefined ? '' : JSON.stringify(input)})`,
    )
  const ids = [initial],
    locals: string[] = []
  const requested = Number(
    process.argv.find((arg) => arg.startsWith('--load-duration='))?.split('=')[1] ?? 3000,
  )
  assert.ok(Number.isSafeInteger(requested) && requested >= 1000 && requested <= 8 * 60 * 60 * 1000)
  const source = join(root, 'stage6-load-source'),
    dest = join(root, 'stage6-load-dest')
  await mkdir(source)
  await mkdir(dest)
  const bytes = Buffer.alloc(2 * 1024 * 1024, 67)
  for (let i = 0; i < 5; i++) await writeFile(join(source, `load-${i}.bin`), bytes)
  try {
    for (let i = 1; i < 20; i++) ids.push(await open())
    for (let i = 0; i < 2; i++)
      locals.push(
        (await call<{ session_id: string }>('sftp.createSession', { profileId: 'local' })).session_id,
      )
    const latencies: number[] = []
    const memory: Array<{ elapsedMs: number; workingSetKiB: number; processes: number }> = []
    let rounds = 0,
      transferBatches = 0,
      nextLog = 0
    const started = performance.now()
    const transfer = async () => {
      while (performance.now() - started < requested || !transferBatches) {
        const batches = await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            call<{ tasks: Array<{ id: string }> }>('sftp.transfer', {
              sourceSessionId: locals[0],
              targetSessionId: locals[1],
              paths: [displayPath(join(source, `load-${i}.bin`))],
              destDir: displayPath(dest),
              conflictResolution: 'overwrite',
              directoryMode: 'preserve',
            }),
          ),
        )
        const batch = { tasks: batches.flatMap((batch) => batch.tasks) }
        assert.equal(batch.tasks.length, 5)
        const deadline = Date.now() + 30_000
        while (true) {
          const rows = await call<Array<{ id: string; status: string }>>('sftp.listTransfers', {})
          const selected = rows.filter((row) => batch.tasks.some((task) => task.id === row.id))
          assert.ok(!selected.some((row) => ['failed', 'cancelled'].includes(row.status)))
          if (selected.length === 5 && selected.every((row) => row.status === 'completed')) break
          assert.ok(Date.now() < deadline, 'Load transfer timeout')
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        transferBatches++
        await call('sftp.clearCompletedTransfers')
      }
    }
    const activity = async () => {
      while (performance.now() - started < requested) {
        await Promise.all(ids.slice(0, 4).map((id) => call('session.input', { id, data: 'load-echo\n' })))
        const elapsed = await window.webContents.executeJavaScript(
          `(async()=>{const start=performance.now();await window.eizhu.window.state();return performance.now()-start})()`,
        )
        latencies.push(elapsed)
        await call('serverDetail.getMetrics', { sessionId: detailId })
        if (performance.now() - started >= nextLog) {
          const metrics = app.getAppMetrics()
          memory.push({
            elapsedMs: performance.now() - started,
            workingSetKiB: metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0),
            processes: metrics.length,
          })
          nextLog += 30_000
          console.log('EIZHU_LOAD_PROGRESS', Math.round(performance.now() - started), requested)
        }
        rounds++
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    const outcomes = await Promise.allSettled([transfer(), activity()])
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
    for (let i = 0; i < 5; i++) assert.deepEqual(await readFile(join(dest, `load-${i}.bin`)), bytes)
    const connected = await call<Array<{ id: string; status: string }>>('session.list')
    assert.equal(connected.filter((row) => ids.includes(row.id) && row.status === 'connected').length, 20)
    latencies.sort((a, b) => a - b)
    assert.ok(latencies.length > 0 && transferBatches > 0)
    return {
      passed: true,
      synthetic: true,
      requestedMs: requested,
      elapsedMs: performance.now() - started,
      sshConnections: 20,
      activeBinaryTerminals: 4,
      localTransferTasksPerBatch: 5,
      transferBatches,
      bytesVerifiedPerBatch: bytes.length * 5,
      rounds,
      ipcSamples: latencies.length,
      ipcP50Ms: latencies[Math.floor(latencies.length * 0.5)],
      ipcP95Ms: latencies[Math.floor(latencies.length * 0.95)],
      ipcMaxMs: latencies.at(-1),
      memory,
      fullAcceptance: false,
      pending: ['真实远端五路网络传输', '完整备份与编辑器混合负载', 'P95 交互 100ms', '8 小时稳定性'],
    }
  } finally {
    for (const id of ids.slice(1)) await call('session.close', { id }).catch(() => undefined)
    for (const id of locals) await call('sftp.closeSession', { id }).catch(() => undefined)
  }
}
