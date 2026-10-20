import { z } from 'zod'
import { editorOpenSchema, workspaceSchema, foundation } from './foundation.ts'
import type { DesktopEvents } from './index.ts'
/** Reserved event types cannot be emitted until their business stage supplies a payload schema. */
export const eventSchemas = {
  'eizhu-workspace-changed': workspaceSchema,
  'eizhu-sync-message': z.never(),
  'eizhu-session-message': z.never(),
  'eizhu-sftp-message': z.never(),
  'eizhu-transfer-message': z.never(),
  'eizhu-tunnel-status': z.never(),
  'eizhu-editor-open-file': editorOpenSchema,
  'eizhu-editor-transition': z.strictObject({ requestId: z.uuid() }),
  'eizhu-app-close-request': z.strictObject({ requestId: z.uuid() }),
  'eizhu-window-close-request': z.undefined(),
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
