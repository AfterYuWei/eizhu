import { z } from 'zod'
import { accountStatusSchema } from './account.ts'
import { bootstrapSchema, contextSchema, sameContext } from './foundation.ts'
import type { Bootstrap, RuntimeContext } from './foundation.ts'
import { fail } from './errors.ts'

/** Internal main→preload result, never a general renderer-controlled switch command. */
export const workspaceTransitionSchema = z.strictObject({
  fromContext: contextSchema,
  bootstrap: bootstrapSchema,
  account: accountStatusSchema,
})
export type WorkspaceTransitionResult = z.infer<typeof workspaceTransitionSchema>
export function acceptWorkspaceTransition(
  operation: string,
  sent: RuntimeContext,
  current: RuntimeContext,
  raw: unknown,
): WorkspaceTransitionResult {
  if (!['account.login', 'account.register', 'account.logout'].includes(operation))
    fail('STALE_RESPONSE', '该操作不允许切换账号空间')
  const transition = workspaceTransitionSchema.parse(raw)
  const next = transition.bootstrap
  if (
    !sameContext(transition.fromContext, sent) ||
    next.context.runtimeId === sent.runtimeId ||
    next.context.generation <= sent.generation ||
    next.context.workspaceId !== next.workspace.id ||
    next.context.generation !== next.workspace.generation ||
    (!sameContext(current, sent) && !sameContext(current, next.context)) ||
    (transition.account.loggedIn
      ? next.workspace.userId !== transition.account.user.id || next.workspace.id === 'offline'
      : next.workspace.userId !== 0 || next.workspace.id !== 'offline') ||
    (operation === 'account.logout' && transition.account.loggedIn) ||
    (operation !== 'account.logout' && !transition.account.loggedIn)
  )
    fail('STALE_RESPONSE', '账号空间切换响应已失效')
  return transition
}

/** Prevent delayed broadcasts from restoring an older runtime or generation. */
export function acceptBootstrapUpdate(current: Bootstrap, raw: unknown): Bootstrap {
  const next = bootstrapSchema.parse(raw)
  if (
    next.window !== current.window ||
    next.workspace.id !== next.context.workspaceId ||
    next.workspace.generation !== next.context.generation ||
    (!sameContext(next.context, current.context) && next.context.generation <= current.context.generation)
  )
    fail('STALE_RESPONSE', '运行实例上下文已失效')
  return next
}
