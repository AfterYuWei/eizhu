import { ArchiveRepository } from '../archive/repository.ts'
import { isArchiveOperation, archive } from '@eizhu/contracts'
import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { foundation, fail, isLocalOperation, local, isSshOperation, ssh, workspaceIdentitySchema } from '@eizhu/contracts'
import type { Payload } from '../local/model.ts'
import { FoundationStore } from './store.ts'
import { answerWorker } from '../workers/client.ts'

const { root, key, workspace } = z
  .strictObject({ root: z.string().min(1), key: z.instanceof(Uint8Array), workspace: workspaceIdentitySchema.optional() })
  .parse(workerData)
const store = new FoundationStore(root, key, workspace)
const archiveStore = new ArchiveRepository(store.local)
key.fill(0)
const historySweep = setInterval(() => store.local.pruneHistory(), 3600000)
historySweep.unref()
parentPort!.on('message', async (message) => {
  const response = await answerWorker(message, (operation, input) => {
    switch (operation) {
      case 'settings.read':
        return store.settings()
      case 'settings.write': {
        const data = foundation['settings.write'].input.parse(input)
        return store.writeSetting(data.key, data.value)
      }
      case 'health':
        return { schema: 3 }
      case 'workspace.identity':
        return store.identity
      case 'local.snapshot':
        return store.local.snapshot()
      case 'backup.prepare':
        return store.local.prepare(
          input as {
            payload: Payload
            mode: 'none' | 'plain' | 'encrypted'
            exportedAt: string
            source: { kind: 'file'; name?: string }
          },
        )
      case 'backup.apply': {
        const d = input as { token: string; strategy: 'skip' | 'overwrite' | 'regenerate' }
        return store.local.apply(d.token, d.strategy)
      }
      case 'close':
        clearInterval(historySweep)
        return store.close()
      default:
        if(operation.startsWith('archive.')) return archiveStore.execute(operation,input)
        if(isArchiveOperation(operation)) return archive[operation].output.parse(archiveStore.execute(operation,archive[operation].input.parse(input)))
        if(operation.startsWith('sftp.storage.'))return store.local.transferState(operation,input)
        if (operation.startsWith('ssh.')) return store.local.sshExecute(operation, input)
        if (isSshOperation(operation))
          return ssh[operation].output.parse(
            store.local.sshExecute(operation, ssh[operation].input.parse(input)),
          )
        if (isLocalOperation(operation)) {
          const value = store.local.execute(operation, local[operation].input.parse(input))
          return local[operation].output.parse(value)
        }
        return fail('UNKNOWN_OPERATION', '未开放的数据库操作')
    }
  })
  parentPort!.postMessage(response)
})
