import type { CompletionGeneratorRequest } from '@/types/completion'
import { bridge } from '@/lib/bridge'
import type { SessionCreateRequest } from '@/types/session'
import type { SessionMessage } from '@/types/sessionMessage'

export const sessionApi = {
  create: (data: SessionCreateRequest) => bridge().session.create({ request: data }),

  list: () => bridge().session.list(),

  attach: (id: string) => bridge().session.attach({ id }),

  subscribe: (id: string, onEvent: (message: SessionMessage) => void) =>
    bridge().session.subscribe({ id }, onEvent),

  unsubscribe: (id: string, subscriptionId: string) => bridge().session.unsubscribe({ id, subscriptionId }),

  reconnect: (id: string) => bridge().session.reconnect({ id }),

  confirmHostKey: (id: string, fingerprint?: string) => bridge().session.confirmHostKey({ id, fingerprint }),

  decideHostKey: (
    requestId: string,
    fingerprint: string,
    decision: 'trust_once' | 'trust_permanently' | 'reject',
  ) =>
    bridge().session.decide({
      requestId,
      fingerprint,
      decision,
    }),

  input: (id: string, data: string) => bridge().session.input({ id, data }),

  resize: (id: string, cols: number, rows: number) => bridge().session.resize({ id, cols, rows }),

  ping: (id: string) => bridge().session.ping({ id }),

  respondAuth: (requestId: string, responses: string[]) =>
    bridge().session.authRespond({ requestId, responses }),

  complete: (id: string, requestId: string, generator: CompletionGeneratorRequest, cwd?: string) =>
    bridge().session.complete({ id, requestId, ...generator, cwd }),

  close: (id: string) => bridge().session.close({ id }),
}
