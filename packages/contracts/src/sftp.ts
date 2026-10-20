import { z } from 'zod'
import { authPromptSchema } from './ssh.ts'
const id = z.string().min(1).max(160)
export const filePathSchema = z
  .string()
  .min(1)
  .max(32768)
  .refine((v) => !v.includes('\0'))
const path = filePathSchema,
  empty = z.undefined(),
  done = z.void()
const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const byId = z.strictObject({ id }),
  task = z.strictObject({ taskId: id })
const at = z.strictObject({ sessionId: id, path })
const paths = z.array(path).min(1).max(256)
const resolution = z.enum(['ask', 'overwrite', 'rename', 'skip'])
export const fileEntrySchema = z.strictObject({
  name: z.string().max(32768),
  path,
  is_dir: z.boolean(),
  size: uint,
  mod_time: z.string(),
  mode: z.string().optional(),
})
export const transferTaskSchema = z.strictObject({
  id,
  file_name: z.string().max(32768),
  direction: z.enum(['upload', 'download', 'transfer']),
  size: uint,
  transferred: uint,
  status: z.enum(['queued', 'transferring', 'completed', 'failed', 'cancelled', 'paused', 'recoverable']),
  speed: z.number().finite().nonnegative(),
  started_at: uint,
  finished_at: uint.optional(),
  error_message: z.string().max(1024).optional(),
  error_code: z.string().max(160).optional(),
  retryable: z.boolean().optional(),
  execution_generation: uint.optional(),
  confirmed_offset: uint.optional(),
  source_profile: id.optional(),
  target_profile: id.optional(),
})
export const fileSessionSchema = z.strictObject({
  id,
  profile_id: id,
  status: z.string().max(40),
  created_at: z.string(),
  error: z.string().max(1024).optional(),
  home_dir: path.optional(),
  host_key_fingerprint: z.string().max(256).optional(),
  known_host_key_fingerprint: z.string().max(256).optional(),
  host_key_request_id: id.optional(),
  auth_request: authPromptSchema.optional(),
})
const response = z.strictObject({ session_id: id, status: z.string(), home_dir: path.optional() })
const tasks = z.strictObject({ tasks: z.array(transferTaskSchema).max(256) })
const begin = tasks.extend({
  upload_id: z.string().max(160),
  received: uint.optional(),
  sequence: uint.optional(),
})
const conflict = z.strictObject({
  source_path: path,
  dest_path: path,
  source_size: uint,
  dest_size: uint,
  source_is_dir: z.boolean().optional(),
  dest_is_dir: z.boolean().optional(),
})
const tree: z.ZodType<import('./models/sftp.ts').SftpTreeNode> = fileEntrySchema.extend({
  children: z.lazy(() => z.array(tree).max(10000)).optional(),
})
export const fileReadSchema = z.strictObject({
  path,
  content: z.string().max(10 * 1024 * 1024),
  size: uint.max(10 * 1024 * 1024),
  mod_time: z.string(),
  language: z.string(),
  line_ending: z.enum(['lf', 'crlf']),
  read_only: z.boolean(),
  content_hash: z.string().max(64).optional(),
})
const written = z.strictObject({
  path,
  size: uint,
  mod_time: z.string(),
  content_hash: z.string().optional(),
})
export const sftp = {
  'sftp.createSession': { input: z.strictObject({ profileId: id }), output: response },
  'sftp.getSession': { input: byId, output: fileSessionSchema },
  'sftp.listSessions': { input: empty, output: z.array(fileSessionSchema).max(128) },
  'sftp.closeSession': { input: byId, output: done },
  'sftp.reconnectSession': { input: byId, output: response },
  'sftp.hostKeyDecide': {
    input: z.strictObject({
      requestId: id,
      fingerprint: z.string().max(256),
      decision: z.enum(['trust_once', 'trust_permanently', 'reject']),
    }),
    output: z.strictObject({ status: z.string(), persisted: z.boolean().optional() }),
  },
  'sftp.list': {
    input: at.extend({ showHidden: z.boolean() }),
    output: z.strictObject({ path, entries: z.array(fileEntrySchema).max(10000) }),
  },
  'sftp.stat': { input: at, output: fileEntrySchema },
  'sftp.tree': {
    input: at.extend({ depth: uint.max(6) }),
    output: z.strictObject({ path, entries: z.array(tree).max(10000) }),
  },
  'sftp.mkdir': { input: at, output: fileEntrySchema },
  'sftp.rename': {
    input: z.strictObject({ sessionId: id, oldPath: path, newPath: path }),
    output: fileEntrySchema,
  },
  'sftp.delete': {
    input: z.strictObject({ sessionId: id, paths }),
    output: z.strictObject({ deleted: uint, failed: uint }),
  },
  'sftp.move': {
    input: z.strictObject({ sessionId: id, paths, destDir: path, conflictResolution: resolution }),
    output: z.strictObject({
      moved: z.array(path),
      skipped: z.array(path),
      failures: z.array(z.strictObject({ path, message: z.string() })),
      conflicts: z.array(conflict).optional(),
    }),
  },
  'sftp.transfer': {
    input: z.strictObject({
      sourceSessionId: id,
      targetSessionId: id,
      paths,
      destDir: path,
      conflictResolution: resolution,
      directoryMode: z.enum(['preserve', 'archive']),
    }),
    output: z.strictObject({
      task_id: id.optional(),
      method: z.string().optional(),
      tasks: z.array(transferTaskSchema).optional(),
      conflicts: z.array(conflict).optional(),
    }),
  },
  'sftp.uploadBegin': {
    input: z.strictObject({
      sessionId: id,
      name: z
        .string()
        .min(1)
        .max(255)
        .refine((v) => !/[\\/\0]/.test(v) && v !== '.' && v !== '..'),
      destDir: path,
      overwrite: z.boolean(),
      size: uint,
      lastModified: uint,
    }),
    output: begin,
  },
  'sftp.uploadChunk': {
    input: z.strictObject({
      uploadId: id,
      data: z.instanceof(Uint8Array).refine((v) => v.byteLength > 0 && v.byteLength <= 512 * 1024),
      sequence: uint,
    }),
    output: done,
  },
  'sftp.uploadFinish': { input: z.strictObject({ uploadId: id }), output: tasks },
  'sftp.uploadCheckpoint': {
    input: task,
    output: z.strictObject({
      size: uint,
      last_modified: uint.nullable().optional(),
      prefix_hash: z.string().optional(),
      prefix_bytes: uint.optional(),
    }),
  },
  'sftp.resumeUpload': {
    input: task.extend({
      size: uint,
      lastModified: uint,
      restart: z.boolean(),
      prefixHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
    output: begin,
  },
  'sftp.pauseTransfer': { input: task, output: transferTaskSchema },
  'sftp.resumeTransfer': { input: task, output: transferTaskSchema },
  'sftp.retryTransfer': { input: task.extend({ restart: z.boolean() }), output: transferTaskSchema },
  'sftp.cancelTransfer': { input: task, output: transferTaskSchema },
  'sftp.clearCompletedTransfers': { input: empty, output: done },
  'sftp.listTransfers': {
    input: z.strictObject({ sessionId: id.optional(), status: z.string().max(40).optional() }),
    output: z.array(transferTaskSchema).max(1000),
  },
  'sftp.download': {
    input: z.strictObject({ sessionId: id, paths }),
    output: tasks.extend({ download_url: z.string() }),
  },
  'sftp.exportDownload': { input: task, output: z.string().nullable() },
  'sftp.downloadChunk': {
    input: task.extend({ offset: uint, maxBytes: uint.min(1).max(512 * 1024) }),
    output: z.instanceof(Uint8Array).refine((v) => v.byteLength <= 512 * 1024),
  },
  'sftp.downloadClose': { input: task, output: done },
  'sftp.readFile': { input: at, output: fileReadSchema },
  'sftp.writeFile': {
    input: at.extend({
      request: z.strictObject({
        content: z.string().max(10 * 1024 * 1024),
        expected_mod_time: z.string().max(128),
        expected_content_hash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        create_new: z.boolean().optional(),
        line_ending: z.enum(['lf', 'crlf']).optional(),
      }),
    }),
    output: written,
  },
  'sftp.startDrag': { input: z.strictObject({ taskIds: z.array(id).min(1).max(32) }), output: done },
  'sftp.releaseDrag': { input: z.strictObject({ taskIds: z.array(id).min(1).max(32) }), output: done },
  'sftp.prepareDrag': {
    input: z.strictObject({ sessionId: id, paths: z.array(path).min(1).max(32) }),
    output: z.strictObject({ tasks: z.array(transferTaskSchema).max(32) }),
  },
} as const
export const sftpEventSchema = z.strictObject({
  type: z.enum(['sftp_session_status', 'transfer_progress', 'transfer_complete', 'transfer_failed']),
  workspaceGeneration: z.int(),
  payload: z.union([
    transferTaskSchema.extend({ task_id: id }),
    z.strictObject({ session_id: id, status: z.string().max(40) }),
  ]),
})
export function isSftpOperation(value: string): value is keyof typeof sftp {
  return Object.hasOwn(sftp, value)
}
