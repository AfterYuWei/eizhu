import { z } from 'zod'

export const updateChannelSchema = z.enum(['stable', 'test'])
export const updateCandidateSchema = z.strictObject({
  token: z.uuid(),
  channel: updateChannelSchema,
  version: z.string().min(1).max(100),
  notes: z.string().max(32768),
})
export const updateProgressSchema = z.strictObject({
  token: z.uuid(),
  phase: z.enum(['downloading', 'installing']),
  downloadedBytes: z.number().finite().nonnegative(),
  totalBytes: z.number().finite().positive().nullable(),
  percent: z.number().finite().min(0).max(100).nullable(),
  bytesPerSecond: z.number().finite().nonnegative(),
})
export const updates = {
  'update.check': {
    input: z.strictObject({ channel: updateChannelSchema }),
    output: z.strictObject({ candidate: updateCandidateSchema.nullable() }),
  },
  'update.download': {
    input: z.strictObject({ token: z.uuid() }),
    output: z.void(),
  },
  'update.install': {
    input: z.strictObject({ token: z.uuid() }),
    output: z.void(),
  },
} as const
export type UpdateCandidate = z.infer<typeof updateCandidateSchema>
export type UpdateProgress = z.infer<typeof updateProgressSchema>
export type UpdateChannel = z.infer<typeof updateChannelSchema>
