import test from 'node:test'
import assert from 'node:assert/strict'
import { ssh, sessionMessageSchema, isPublicTunnelBind } from '../ssh.ts'
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
test('SSH contract rejects arbitrary completion programs, unregistered listeners and invalid input', () => {
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
        bind_host: '192.0.2.1',
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

test('public listeners are explicit and start confirmation carries the reviewed configuration', () => {
  const config = { id: 'public', name: 'web', profile_id: 'p', kind: 'local', bind_host: '0.0.0.0', bind_port: 8080, target_host: '127.0.0.1', target_port: 80 }
  for (const host of ['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']) {
    assert.equal(ssh['tunnel.save'].input.safeParse({ config: { ...config, bind_host: host } }).success, true)
    assert.equal(isPublicTunnelBind(host), host === '0.0.0.0' || host === '::')
  }
  for (const host of ['', '*', '192.0.2.1', '::ffff:127.0.0.1', '0.0.0.0\n'])
    assert.equal(ssh['tunnel.save'].input.safeParse({ config: { ...config, bind_host: host } }).success, false)
  assert.equal(ssh['tunnel.start'].input.safeParse({ id: config.id, confirmedConfig: config }).success, true)
  assert.equal(ssh['tunnel.start'].input.safeParse({ id: config.id, confirmedConfig: true }).success, false)
  assert.equal(ssh['tunnel.start'].input.safeParse({ id: config.id, confirmPublic: true }).success, false)
})

test('local and remote targets accept public IPv4, IPv6 and domains independently of listener scope', () => {
  for (const kind of ['local', 'remote']) for (const target_host of ['203.0.113.10', '2001:db8::10', 'service.example.com']) {
    const config = { id: 'target', name: 'web', profile_id: 'p', kind, bind_host: '127.0.0.1', bind_port: 8080, target_host, target_port: 443 }
    const parsed = ssh['tunnel.save'].input.parse({ config }).config
    assert.equal(parsed.target_host, target_host)
    assert.equal(parsed.bind_host, '127.0.0.1')
    assert.equal(isPublicTunnelBind(parsed.bind_host), false)
  }
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
