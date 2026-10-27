import { z } from 'zod'

export const ACCOUNT_SERVER = 'https://eizhu.yuweinfo.com/'
const integer = z.int().nonnegative()
const email = z.email().max(255)
const password = z.string().min(1).max(1024)
const newPassword = z
  .string()
  .min(8)
  .max(128)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 72, '登录密码不能超过 72 个 UTF-8 字节')
const code = z.string().regex(/^[0-9]{6}$/)

export const accountUserSchema = z.strictObject({
  id: z.int().positive(),
  email,
  emailVerified: z.boolean(),
  verificationRequired: z.boolean(),
  storageUsed: integer,
  storageQuota: integer,
})
export const accountStatusSchema = z.discriminatedUnion('loggedIn', [
  z.strictObject({
    loggedIn: z.literal(false),
    sessionState: z.literal('anonymous'),
    syncEnabled: z.literal(false),
    user: z.undefined().optional(),
  }),
  z.strictObject({
    loggedIn: z.literal(true),
    sessionState: z.enum(['authenticated', 'reauth_required']),
    user: accountUserSchema,
    syncEnabled: z.boolean(),
  }),
])
export type AccountUser = z.infer<typeof accountUserSchema>
export type AccountStatus = z.infer<typeof accountStatusSchema>

/** Schemas are prepared here; enabling a public operation still requires its actual service. */
export const account = {
  'account.status': { input: z.undefined(), output: accountStatusSchema },
  'account.login': { input: z.strictObject({ email, password }), output: accountStatusSchema },
  'account.register': {
    input: z.strictObject({ email, password: newPassword }),
    output: accountStatusSchema,
  },
  'account.logout': { input: z.undefined(), output: z.void() },
  'account.me': { input: z.undefined(), output: accountUserSchema },
  'account.sendVerificationEmail': { input: z.undefined(), output: z.void() },
  'account.verifyEmail': { input: z.strictObject({ code }), output: z.void() },
  'account.requestPasswordReset': { input: z.strictObject({ email }), output: z.void() },
  'account.resetPassword': { input: z.strictObject({ email, code, newPassword }), output: z.void() },
  'account.setSyncEnabled': { input: z.strictObject({ enabled: z.boolean() }), output: accountStatusSchema },
} as const

export const offlineWorkspace = { id: 'offline', userId: 0 } as const
export const workspaceIdentitySchema = z.union([
  z.strictObject({ id: z.literal('offline'), userId: z.literal(0) }),
  z.strictObject({
    id: z.string().regex(/^account-[a-f0-9]{64}$/),
    server: z.literal(ACCOUNT_SERVER),
    userId: z.int().positive(),
  }),
])
export type WorkspaceIdentity = z.infer<typeof workspaceIdentitySchema>

/** Wire-only tokens must never be returned by a renderer-facing operation. */
export const accountTokenSchema = z.strictObject({
  accessToken: z.string().min(1).max(32768),
  refreshToken: z.string().min(1).max(32768),
  expiresIn: z.int().positive(),
  user: accountUserSchema,
})
