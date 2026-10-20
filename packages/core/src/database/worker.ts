import { parentPort, workerData } from 'node:worker_threads'
import { z } from 'zod'
import { foundation, fail } from '@eizhu/contracts'
import { FoundationStore } from './store.ts'
import { answerWorker } from '../workers/client.ts'

const { root } = z.strictObject({ root: z.string().min(1) }).parse(workerData)
const store = new FoundationStore(root)
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
        return { schema: 1 }
      case 'close':
        return store.close()
      default:
        return fail('UNKNOWN_OPERATION', '未开放的数据库操作')
    }
  })
  parentPort!.postMessage(response)
})
