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

export type AccountOperation = Exclude<keyof typeof account, 'account.setSyncEnabled'>
export function isAccountOperation(value: string): value is AccountOperation {
  return value !== 'account.setSyncEnabled' && Object.hasOwn(account, value)
}
export const accountMessageSchema = z.strictObject({
  workspaceGeneration: z.int().positive(),
  status: accountStatusSchema,
})
export const accountSetupSchema = z.strictObject({
  required: z.boolean(),
  passwordMinLength: z.int().min(8).max(128),
})

/** The renderer cannot invoke this transport. Both sides independently pin the origin and routes. */
export const accountHttpRequestSchema = z
  .strictObject({
    url: z.url().max(512),
    method: z.enum(['GET', 'POST']),
    headers: z.strictObject({
      accept: z.literal('application/json'),
      'content-type': z.literal('application/json').optional(),
      authorization: z
        .string()
        .regex(/^Bearer [^\r\n]+$/)
        .max(32775)
        .optional(),
    }),
    body: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength <= 65536)
      .optional(),
  })
  .superRefine((request, ctx) => {
    const url = new URL(request.url)
    const paths =
      request.method === 'GET'
        ? ['setup', 'me']
        : [
            'login',
            'register',
            'refresh',
            'logout',
            'email/send',
            'email/verify',
            'password/forgot',
            'password/reset',
          ]
    if (
      url.origin !== new URL(ACCOUNT_SERVER).origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !paths.some((path) => url.pathname === `/api/auth/${path}`) ||
      (request.method === 'GET' && request.body !== undefined)
    )
      ctx.addIssue({ code: 'custom', message: '账号网络请求未授权' })
  })

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
