import { z } from 'zod'
import { local } from './local.ts'
const id = z.string().min(1).max(160)
const byId = z.strictObject({ id })
const ready = z.void(),
  empty = z.undefined()
const path = z
  .string()
  .min(1)
  .max(32768)
  .refine((v) => !v.includes('\0'))
const status = z.enum(['connecting', 'connected', 'reconnecting', 'suspended', 'disconnected', 'error'])
const response = z.strictObject({ session_id: id, status: z.string().max(40) })
export const authPromptSchema = z.strictObject({
  request_id: id,
  profile_id: id,
  name: z.string().max(4096),
  instructions: z.string().max(8192),
  prompts: z.array(z.strictObject({ prompt: z.string().max(4096), echo: z.boolean() })).max(16),
  fingerprint: z.string().max(256).optional(),
  known_fingerprint: z.string().max(256).optional(),
})
export const connectionStateSchema = z.strictObject({
  session_id: id,
  status: z.string().max(40),
  stage: z.string().max(80),
  message: z.string().max(1024),
  error: z.string().max(1024).optional(),
  waiting_for_host_key: z.boolean().optional(),
  host_key_request_id: id.optional(),
  host_key_fingerprint: z.string().max(256).optional(),
  known_host_key_fingerprint: z.string().max(256).optional(),
  retry_attempt: z.int().optional(),
  next_retry_at: z.number().optional(),
  logs: z
    .array(
      z.strictObject({ at: z.number(), level: z.string(), stage: z.string(), message: z.string().max(1024) }),
    )
    .max(100)
    .optional(),
})
export const sessionMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('output'), data: z.string().max(65536) }),
  z.strictObject({ type: z.literal('connection_state'), payload: connectionStateSchema }),
  z.strictObject({ type: z.literal('auth_request'), payload: authPromptSchema }),
  z.strictObject({ type: z.literal('auth_request_closed'), payload: z.strictObject({ request_id: id }) }),
  z.strictObject({
    type: z.literal('metadata'),
    payload: z.strictObject({
      session_id: id,
      host: z.string(),
      username: z.string(),
      protocol: z.literal('ssh'),
    }),
  }),
  z.strictObject({ type: z.literal('cwd'), payload: z.strictObject({ path }) }),
  z.strictObject({ type: z.literal('pong') }),
  z.strictObject({ type: z.literal('exit'), payload: z.strictObject({ code: z.int() }) }),
  z.strictObject({
    type: z.literal('disconnect'),
    payload: z.strictObject({ reason: z.string(), message: z.string().max(1024) }),
  }),
  z.strictObject({
    type: z.literal('error'),
    payload: z.strictObject({ code: z.string(), message: z.string().max(1024) }),
  }),
  z.strictObject({
    type: z.literal('complete_response'),
    payload: z.strictObject({
      request_id: id,
      output: z.string().max(262144),
      error: z.string().max(1024),
      exit_code: z.int(),
      candidates: z
        .array(z.strictObject({ name: z.string().max(32768), is_dir: z.boolean() }))
        .max(4096)
        .optional(),
    }),
  }),
])
export const tunnelConfigSchema = z.strictObject({
  id: z.string().max(160),
  name: z.string().trim().min(1).max(512),
  profile_id: id,
  kind: z.enum(['local', 'remote', 'dynamic']),
  bind_host: z.enum(['127.0.0.1', '::1', 'localhost']),
  bind_port: z.int().min(0).max(65535),
  target_host: z
    .string()
    .min(1)
    .max(512)
    .refine((v) => !/[\0\r\n]/.test(v)),
  target_port: z.int().min(1).max(65535),
})
export const tunnelStatusSchema = z.strictObject({
  id,
  status: z.enum(['stopped', 'connecting', 'running', 'reconnecting', 'failed']),
  generation: z.int(),
  revision: z.int(),
  bound_port: z.int().nullable(),
  active_connections: z.int().min(0).max(32),
  retry_attempt: z.int(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
})
export const sshGlobalEventSchema = z.union([
  z.strictObject({
    type: z.literal('tunnel_status'),
    payload: tunnelStatusSchema,
    session_id: id,
    workspaceGeneration: z.int(),
  }),
  z.strictObject({
    type: z.enum(['tunnel_auth_request', 'tunnel_host_key_request']),
    payload: authPromptSchema,
    session_id: id,
    workspaceGeneration: z.int(),
  }),
  z.strictObject({
    type: z.literal('tunnel_auth_closed'),
    payload: z.strictObject({ request_id: id }),
    session_id: id,
    workspaceGeneration: z.int(),
  }),
])
const generator = z.enum([
  'paths',
  'git-branches',
  'git-remotes',
  'docker-containers',
  'kubectl-resources',
  'kubectl-contexts',
  'systemd-service-units',
  'systemd-active-units',
  'systemd-failed-units',
  'npm-scripts',
])
const testResult = z.strictObject({
  success: z.boolean(),
  message: z.string(),
  latency_ms: z.number(),
  server_info: z.string().optional(),
  stages: z.array(
    z.strictObject({
      stage: z.string(),
      status: z.enum(['success', 'warning', 'error']),
      message: z.string(),
      profile_id: id.optional(),
      profile_name: z.string().optional(),
      latency_ms: z.number().optional(),
      known_fingerprint: z.string().optional(),
      fingerprint: z.string().optional(),
    }),
  ),
})
const num = z.number().finite()
export const ssh = {
  'session.create': {
    input: z.strictObject({
      request: z.strictObject({
        profile_id: id,
        cols: z.int().min(1).max(1000).optional(),
        rows: z.int().min(1).max(1000).optional(),
        confirmed_host_key_fingerprint: z.string().optional(),
      }),
    }),
    output: response,
  },
  'session.list': {
    input: empty,
    output: z.array(z.strictObject({ id, profile_id: id, status, created_at: z.string() })).max(128),
  },
  'session.attach': { input: byId, output: z.array(sessionMessageSchema).max(128) },
  'session.subscribe': { input: byId.extend({ subscriptionId: z.uuid().optional() }), output: id },
  'session.unsubscribe': { input: z.strictObject({ id, subscriptionId: id }), output: ready },
  'session.close': { input: byId, output: ready },
  'session.reconnect': { input: byId, output: response },
  'session.confirmHostKey': {
    input: z.strictObject({ id, fingerprint: z.string().max(256).optional() }),
    output: z.strictObject({ status: z.string() }),
  },
  'session.decide': {
    input: z.strictObject({
      requestId: id,
      fingerprint: z.string().max(256),
      decision: z.enum(['trust_once', 'trust_permanently', 'reject']),
    }),
    output: z.strictObject({ status: z.string(), persisted: z.boolean().optional() }),
  },
  'session.authRespond': {
    input: z.strictObject({ requestId: id, responses: z.array(z.string().max(8192)).max(16) }),
    output: ready,
  },
  'session.input': { input: z.strictObject({ id, data: z.string().max(32768) }), output: ready },
  'session.resize': {
    input: z.strictObject({ id, cols: z.int().min(1).max(1000), rows: z.int().min(1).max(1000) }),
    output: ready,
  },
  'session.ping': { input: byId, output: ready },
  'session.complete': {
    input: z.strictObject({
      id,
      requestId: id,
      generatorId: generator,
      params: z.strictObject({
        directory: path.optional(),
        prefix: z.string().max(512).optional(),
        namespace: z.string().max(256).optional(),
        resource: z
          .enum([
            'pods',
            'services',
            'deployments',
            'nodes',
            'namespaces',
            'configmaps',
            'secrets',
            'ingresses',
            'statefulsets',
            'daemonsets',
            'jobs',
            'cronjobs',
            'persistentvolumeclaims',
            'replicasets',
            'serviceaccounts',
          ])
          .optional(),
        all: z.boolean().optional(),
      }),
      cwd: path.optional(),
    }),
    output: ready,
  },
  'profile.testNew': { input: local['profile.create'].input, output: testResult },
  'profile.testExisting': { input: local['profile.update'].input, output: testResult },
  'history.list': {
    input: z.strictObject({ profileId: id }),
    output: z
      .array(
        z.strictObject({
          id,
          command: z.string().max(8192),
          cwd: z.string().max(32768),
          count: z.int(),
          lastAt: num,
        }),
      )
      .max(5000),
  },
  'history.record': {
    input: z.strictObject({
      profileId: id,
      command: z
        .string()
        .min(1)
        .max(8192)
        .refine(
          (v) =>
            !/^\s/.test(v) && !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
        ),
      cwd: z.string().max(32768),
    }),
    output: ready,
  },
  'history.delete': { input: z.strictObject({ profileId: id.optional(), id: id.optional() }), output: ready },
  'tunnel.list': { input: empty, output: z.array(tunnelConfigSchema).max(128) },
  'tunnel.save': { input: z.strictObject({ config: tunnelConfigSchema }), output: tunnelConfigSchema },
  'tunnel.delete': { input: byId, output: ready },
  'tunnel.start': { input: byId, output: tunnelStatusSchema },
  'tunnel.stop': { input: byId, output: ready },
  'tunnel.statuses': { input: empty, output: z.array(tunnelStatusSchema).max(128) },
  'serverDetail.create': {
    input: z.strictObject({ profileId: id }),
    output: response.extend({ home_dir: z.string().optional() }),
  },
  'serverDetail.close': { input: z.strictObject({ sessionId: id }), output: ready },
  'serverDetail.listFiles': {
    input: z.strictObject({ sessionId: id, path, showHidden: z.boolean() }),
    output: z.strictObject({
      path: z.string(),
      entries: z
        .array(
          z.strictObject({
            name: z.string(),
            path: z.string(),
            is_dir: z.boolean(),
            size: num,
            mod_time: z.string(),
            mode: z.string(),
          }),
        )
        .max(10000),
    }),
  },
  'serverDetail.getInfo': {
    input: z.strictObject({ sessionId: id }),
    output: z.strictObject({
      hostname: z.string(),
      os: z.string(),
      icon: z.string(),
      kernel: z.string(),
      arch: z.string(),
      uptime: z.string(),
      load_avg: z.string(),
      load_avg_detail: z.string(),
      cpus: num,
      cpu_mhz: num,
    }),
  },
  'serverDetail.getMetrics': {
    input: z.strictObject({ sessionId: id }),
    output: z.strictObject({
      cpu: num,
      cpu_detail: z.array(num),
      mem_used: num,
      mem_total: num,
      mem_percent: num,
      mem_detail: z.array(z.strictObject({ name: z.string(), percent: num, rss: num })),
      disk_used: num,
      disk_total: num,
      disk_percent: num,
      cpu_mhz: num,
      net_rx: num,
      net_tx: num,
      net_detail: z.array(z.strictObject({ name: z.string(), rx: num, tx: num })),
    }),
  },
} as const
export function isSshOperation(value: string): value is keyof typeof ssh {
  return Object.hasOwn(ssh, value)
}
