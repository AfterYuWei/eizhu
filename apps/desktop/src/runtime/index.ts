import { z } from 'zod'
import { join } from 'node:path'
import { RuntimeService } from '@eizhu/core/runtime/service'
import { contextSchema, requestSchema, failureOf, sameContext } from '@eizhu/contracts'

const port = process.parentPort!
let service: RuntimeService | undefined
let closing = false
port.on('message', async ({ data, ports }) => {
  try {
    if (data.type === 'init') {
      if (service || closing) throw new Error('Already initialized')
      const input = z
        .strictObject({
          type: z.literal('init'),
          context: contextSchema,
          root: z.string(),
          workers: z.string(),
          key: z.instanceof(Uint8Array),
        })
        .parse(data)
      service = new RuntimeService(
        input.context,
        input.root,
        {
          database: join(input.workers, 'database.cjs'),
          compute: join(input.workers, 'compute.cjs'),
          verification: join(input.workers, 'stage2.cjs'),
          verification3: join(input.workers, 'stage3.cjs'),
        },
        input.key,
        (name, payload) => port.postMessage({ type: 'event', context: input.context, name, payload }),
      )
      input.key.fill(0)
      await service.execute({
        id: crypto.randomUUID(),
        context: input.context,
        operation: 'runtime.health',
        input: undefined,
      })
      port.postMessage({ type: 'ready', context: input.context })
      return
    }
    if (data.type === 'terminal.bind') {
      const channel = ports[0]
      try {
        if (!service || closing || !sameContext(contextSchema.parse(data.context), service.context))
          throw new Error('Stale context')
        await service.bindTerminal(z.uuid().parse(data.id), z.uuid().parse(data.subscriptionId), channel)
      } catch {
        channel?.close()
      }
      return
    }
    if (data.type === 'shutdown') {
      closing = true
      await service?.close()
      port.postMessage({ type: 'closed' })
      process.exit(0)
    }
    const request = requestSchema.parse(data)
    if (!service || closing) throw new Error('Runtime not ready')
    try {
      port.postMessage({
        type: 'response',
        id: request.id,
        context: request.context,
        value: await service.execute(request),
      })
    } catch (cause) {
      port.postMessage({
        type: 'response',
        id: request.id,
        context: request.context,
        error: failureOf(cause),
      })
    }
  } catch {
    port.postMessage({ type: 'fatal', error: { code: 'RUNTIME_INIT_FAILED', message: '业务进程初始化失败' } })
  }
})
