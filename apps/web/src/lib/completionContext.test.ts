import { expect, it } from 'vitest'
import { ssh } from '@eizhu/contracts'
import { getDynamicGenerator, tokenize } from './completionEngine'

for (const [input, generatorId, params] of [
  ['git -C /other-repo checkout fe', 'git-branches', { gitDirectories: ['/other-repo'] }],
  [
    'docker -H tcp://fixture.invalid:2375 logs we',
    'docker-containers',
    { dockerHost: 'tcp://fixture.invalid:2375' },
  ],
  ['kubectl --kubeconfig=/tmp/qa-config get pods we', 'kubectl-resources', { kubeconfig: '/tmp/qa-config' }],
  ['systemctl --user start ap', 'systemd-service-units', { systemdUser: true }],
] as const) {
  it(`上下文传到受限 IPC：${input}`, () => {
    const generator = getDynamicGenerator(tokenize(input))!
    expect(generator).toMatchObject({ generatorId, params })
    expect(() =>
      ssh['session.complete'].input.parse({ id: 's', requestId: 'r', generatorId, params: generator.params }),
    ).not.toThrow()
  })
}

it('Git 保留连续 -C 的顺序，文件参数也在指定仓库内补全', () => {
  expect(getDynamicGenerator(tokenize('git -C "/srv/项目 files" -C sub checkout fe'))).toMatchObject({
    params: { gitDirectories: ['/srv/项目 files', 'sub'] },
  })
  expect(getDynamicGenerator(tokenize('git -C /srv/repo add src/fi'))).toMatchObject({
    generatorId: 'paths',
    params: { gitDirectories: ['/srv/repo'], directory: 'src/', prefix: 'fi' },
  })
  expect(getDynamicGenerator(tokenize('git -C /srv/repo -C child/'))).toMatchObject({
    generatorId: 'paths',
    params: { gitDirectories: ['/srv/repo'], directory: 'child/' },
  })
})

it('上下文只消费已识别选项，保留引用、等号形式和最后指定的值', () => {
  expect(getDynamicGenerator(tokenize('docker -H=unix:///one -H "unix:///qa socket" logs we'))).toMatchObject(
    { params: { dockerHost: 'unix:///qa socket' } },
  )
  expect(
    getDynamicGenerator(tokenize('kubectl --kubeconfig="qa dir/config" get pods -n one --namespace=two we')),
  ).toMatchObject({ params: { kubeconfig: 'qa dir/config', namespace: 'two' } })
  expect(getDynamicGenerator(tokenize('systemctl start --user ap'))).toMatchObject({
    params: { systemdUser: true },
  })
  expect(getDynamicGenerator(tokenize('git add -- -C fi'))?.params).not.toHaveProperty('gitDirectories')
})

it('未指定命名空间时交由所选 kubeconfig 决定，不覆盖成 default', () => {
  expect(
    getDynamicGenerator(tokenize('kubectl --kubeconfig=/tmp/qa-config get pods we'))?.params,
  ).not.toHaveProperty('namespace')
  expect(
    getDynamicGenerator(tokenize('kubectl --kubeconfig=/tmp/qa-config config use-context pr')),
  ).toMatchObject({ generatorId: 'kubectl-contexts', params: { kubeconfig: '/tmp/qa-config' } })
})

it('普通文件参数不携带无关 CLI 上下文，缓存键仍按实际参数隔离', () => {
  expect(getDynamicGenerator(tokenize('kubectl --kubeconfig=/tmp/qa apply -f fi'))?.params).toEqual({
    directory: '.',
    prefix: 'fi',
  })
  const plain = getDynamicGenerator(tokenize('systemctl start ap'))
  const user = getDynamicGenerator(tokenize('systemctl --user start ap'))
  expect(JSON.stringify(plain)).not.toBe(JSON.stringify(user))
})
