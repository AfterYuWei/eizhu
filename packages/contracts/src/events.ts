import { z } from 'zod'
import { sftpEventSchema,transferTaskSchema } from './sftp.ts'
import { sshGlobalEventSchema, tunnelStatusSchema } from './ssh.ts'
import { editorOpenSchema, workspaceSchema, foundation } from './foundation.ts'
import type { DesktopEvents } from './index.ts'
import { updateProgressSchema } from './update.ts'
import { syncMessageSchema } from './sync.ts'
import { accountMessageSchema } from './account.ts'
/** Reserved event types cannot be emitted until their business stage supplies a payload schema. */
export const eventSchemas = {
  'eizhu-update-progress': updateProgressSchema,
  'eizhu-workspace-changed': workspaceSchema,
  'eizhu-account-message': accountMessageSchema,
  'eizhu-account-transition': z.strictObject({ requestId: z.uuid(), phase: z.enum(['confirming', 'pending', 'idle']) }),
  'eizhu-sync-message': syncMessageSchema,
  'eizhu-session-message': sshGlobalEventSchema,
  'eizhu-sftp-message': sftpEventSchema,
  'eizhu-transfer-message': transferTaskSchema,
  'eizhu-tunnel-status': z.strictObject({workspaceGeneration:z.int(),status:tunnelStatusSchema}),
  'eizhu-editor-open-file': editorOpenSchema,
  'eizhu-editor-transition': z.strictObject({ requestId: z.uuid() }),
  'eizhu-app-close-request': z.strictObject({ requestId: z.uuid() }),
  'eizhu-window-close-request': z.strictObject({requestId:z.uuid()}),
  'eizhu-window-state': z.strictObject({ maximized: z.boolean() }),
  'eizhu-runtime-state': z.strictObject({
    status: z.enum(['ready', 'failed']),
    message: z.string().optional(),
  }),
  'eizhu-settings-changed': foundation['settings.write'].input,
} satisfies Record<keyof DesktopEvents, z.ZodType>
export function isDesktopEvent(name: string): name is keyof DesktopEvents {
  return Object.hasOwn(eventSchemas, name)
}
