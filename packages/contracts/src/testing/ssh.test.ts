import test from 'node:test'
import assert from 'node:assert/strict'
import { ssh, sessionMessageSchema } from '../ssh.ts'
test('completion contexts remain typed, bounded and reject control characters or shell programs', () => {
  const request = {
    id: 's',
    requestId: 'r',
    generatorId: 'git-branches',
    params: {
      gitDirectories: ['/srv/repo', 'sub'],
      dockerHost: 'unix:///qa socket',
      kubeconfig: 'qa/config',
      systemdUser: true,
    },
  }
  assert.equal(ssh['session.complete'].input.safeParse(request).success, true)
  for (const params of [
    { gitDirectories: Array(9).fill('/srv') },
    { gitDirectories: 'path' },
    { gitDirectories: ['/srv\nreboot'] },
    { dockerHost: 'tcp://qa\0invalid' },
    { dockerHost: 'x'.repeat(32769) },
    { kubeconfig: 'qa\rconfig' },
    { systemdUser: 'true' },
    { command: 'reboot' },
  ])
    assert.equal(ssh['session.complete'].input.safeParse({ ...request, params }).success, false)
})
test('SSH contract rejects arbitrary completion programs, unsafe listeners and invalid input', () => {
  assert.equal(
    ssh['session.complete'].input.safeParse({
      id: 's',
      requestId: 'r',
      script: 'rm -rf /',
      generatorId: 'paths',
      params: {},
    }).success,
    false,
  )
  assert.equal(
    ssh['session.complete'].input.safeParse({
      id: 's',
      requestId: 'r',
      generatorId: 'kubectl-resources',
      params: { resource: 'pods;reboot' },
    }).success,
    false,
  )
  assert.equal(
    ssh['tunnel.save'].input.safeParse({
      config: {
        id: '',
        name: 't',
        profile_id: 'p',
        kind: 'local',
        bind_host: '0.0.0.0',
        bind_port: 1,
        target_host: 'localhost',
        target_port: 2,
      },
    }).success,
    false,
  )
  assert.equal(
    ssh['history.record'].input.safeParse({ profileId: 'p', command: ' password', cwd: '/' }).success,
    false,
  )
  assert.equal(
    sessionMessageSchema.safeParse({
      type: 'auth_request',
      payload: {
        request_id: 'r',
        profile_id: 'p',
        name: '认证',
        instructions: '',
        prompts: [{ prompt: '密码', echo: false }],
      },
    }).success,
    true,
  )
})

test('connection snapshots preserve a bounded diagnostic code and the actual failing stage', () => {
  const payload = {
    session_id: 's',
    status: 'error',
    stage: 'ssh_auth',
    message: '服务器未接受当前登录凭据',
    error_code: 'SSH_AUTH_FAILED',
  }
  assert.equal(sessionMessageSchema.safeParse({ type: 'connection_state', payload }).success, true)
  assert.equal(
    sessionMessageSchema.safeParse({
      type: 'connection_state',
      payload: { ...payload, error_code: 'x'.repeat(81) },
    }).success,
    false,
  )
})
