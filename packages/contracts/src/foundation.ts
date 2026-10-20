import { z } from 'zod'

export const contextSchema = z.strictObject({
  runtimeId: z.uuid(),
  workspaceId: z.string().min(1).max(160),
  generation: z.int().positive(),
})
export type RuntimeContext = z.infer<typeof contextSchema>
export const workspaceSchema = z.strictObject({
  id: z.string(),
  generation: z.int().positive(),
  userId: z.int(),
})
export type WorkspaceStatus = z.infer<typeof workspaceSchema>
export const platformSchema = z.strictObject({
  platform: z.enum(['windows', 'macos', 'linux', 'unknown']),
  runtime: z.literal('desktop'),
  windowControls: z.boolean(),
  appUpdates: z.boolean(),
  dragOut: z.boolean(),
  nativeFilePaths: z.boolean(),
  documentPicker: z.boolean(),
  secureKeyStore: z.boolean(),
  maxConcurrentTransfers: z.literal(5),
})
export type PlatformCapabilities = z.infer<typeof platformSchema>
const empty = z.undefined()
const ready = z.void()
const text = z.string().max(10 * 1024 * 1024)
const settings = z.partialRecord(z.enum(['eizhu-settings', 'eizhu-desktop-shell']), z.string().max(64 * 1024))
export const editorOpenSchema = z.strictObject({
  sessionId: z.string().min(1).max(160),
  sessionType: z.enum(['sftp', 'serverDetail']),
  path: z.string().min(1).max(32768),
})
const bootstrapSchema = z.strictObject({
  context: contextSchema,
  workspace: workspaceSchema,
  platform: platformSchema,
  window: z.enum(['main', 'editor']),
  version: z.string(),
  settings,
})
export type Bootstrap = z.infer<typeof bootstrapSchema>

/** Only enabled operations can cross the IPC boundary. Add schemas before enabling a domain method. */
export const foundation = {
  'app.bootstrap': { input: empty, output: bootstrapSchema },
  'app.ready': { input: empty, output: ready },
  'runtime.health': {
    input: empty,
    output: z.strictObject({ context: contextSchema, schema: z.literal(2), workers: z.literal(2) }),
  },
  'runtime.restart': { input: empty, output: contextSchema },
  'workspace.status': { input: empty, output: workspaceSchema },
  'settings.write': {
    input: z.strictObject({
      key: z.enum(['eizhu-settings', 'eizhu-desktop-shell']),
      value: z
        .string()
        .max(64 * 1024)
        .nullable(),
    }),
    output: ready,
  },
  'window.minimize': { input: empty, output: ready },
  'window.toggleMaximize': { input: empty, output: ready },
  'window.state': { input: empty, output: z.strictObject({ maximized: z.boolean() }) },
  'window.close': { input: empty, output: ready },
  'editor.open': { input: editorOpenSchema, output: ready },
  'editor.ready': { input: empty, output: ready },
  'editor.show': { input: empty, output: ready },
  'editor.confirmTransition': { input: empty, output: z.boolean() },
  'editor.resolveTransition': {
    input: z.strictObject({ requestId: z.uuid(), accepted: z.boolean() }),
    output: ready,
  },
  'editor.resolveClose': { input: z.strictObject({ shouldClose: z.boolean() }), output: ready },
  'editor.resolveAppClose': {
    input: z.strictObject({ requestId: z.uuid(), shouldClose: z.boolean() }),
    output: ready,
  },
  'clipboard.read': { input: empty, output: text },
  'clipboard.write': { input: z.strictObject({ text }), output: ready },
  'clipboard.writeSensitive': { input: z.strictObject({text,clearAfterSeconds:z.int().min(1).max(300)}), output:ready },
  'system.openExternal': {
    input: z.strictObject({
      url: z
        .url()
        .max(8192)
        .refine((v) => ['https:', 'http:'].includes(new URL(v).protocol)),
    }),
    output: ready,
  },
  'system.saveText': {
    input: z.strictObject({ content: text, suggestedName: z.string().min(1).max(255) }),
    output: z.string().nullable(),
  },
  'diagnostics.append': {
    input: z.strictObject({ lines: z.array(z.string().max(4096)).max(50) }),
    output: ready,
  },
  'diagnostics.read': {
    input: z.strictObject({ kind: z.enum(['frontend', 'backend']) }),
    output: z.strictObject({
      kind: z.enum(['frontend', 'backend']),
      path: z.string(),
      content: z.string().max(262144),
    }),
  },
  'diagnostics.clear': { input: z.strictObject({ kind: z.enum(['frontend', 'backend']) }), output: ready },
} as const
export type FoundationOperation = keyof typeof foundation
export type FoundationInput<K extends FoundationOperation> = z.input<(typeof foundation)[K]['input']>
export type FoundationOutput<K extends FoundationOperation> = z.output<(typeof foundation)[K]['output']>
export const requestSchema = z.strictObject({
  id: z.uuid(),
  context: contextSchema,
  operation: z.string().min(1).max(100),
  input: z.unknown(),
})
export type RpcRequest = z.infer<typeof requestSchema>

export function isFoundationOperation(value: string): value is FoundationOperation {
  return Object.hasOwn(foundation, value)
}

export function sameContext(a: RuntimeContext, b: RuntimeContext): boolean {
  return a.runtimeId === b.runtimeId && a.workspaceId === b.workspaceId && a.generation === b.generation
}
