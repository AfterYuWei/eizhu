import { parentPort } from 'node:worker_threads'
// Used only by the Node foundation tests, never included among application build entries.
parentPort!.on('message', async ({ id, operation, input }) => {
  if (operation === 'crash') process.exit(7)
  if (operation === 'delay') await new Promise((resolve) => setTimeout(resolve, 50))
  parentPort!.postMessage({ id, value: input })
})
