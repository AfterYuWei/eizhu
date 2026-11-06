import { describe, expect, it, vi } from 'vitest'
import { ssh } from '@eizhu/contracts'
import { sessionApi } from '@/api/session'
import { getCommandIndex, getSpec, type Spec, type Subcommand } from './completionSpecs'
import {
  buildCompletionInsertPlan,
  getDynamicGenerator,
  getSuggestions,
  parseCompletionData,
  rankCompletionCandidates,
  tokenize,
} from './completionEngine'

vi.mock('@/lib/bridge', () => ({
  bridge: () => ({
    session: {
      complete: async (input: unknown) => {
        ssh['session.complete'].input.parse(input)
      },
    },
  }),
}))

const families = ['git', 'docker', 'kubectl', 'npm', 'systemctl']
const fileCommands = [
  'cd',
  'ls',
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'vi',
  'vim',
  'nano',
  'rm',
  'cp',
  'mv',
  'touch',
  'chmod',
  'chown',
  'find',
  'grep',
  'mkdir',
  'rmdir',
  'tar',
  'unzip',
  'source',
  'bash',
  'sh',
]
const dirsOnly = new Set(['cd', 'find', 'mkdir', 'rmdir'])
const paths: { input: string; level: Spec | Subcommand }[] = []
function visit(input: string, level: Spec | Subcommand) {
  paths.push({ input, level })
  for (const child of level.subcommands ?? []) visit(`${input} ${child.name}`, child)
}
for (const family of families) visit(family, getSpec(family)!)

describe('全部注册命令与静态规格', () => {
  for (const command of getCommandIndex())
    it(`命令前缀 ${command.name}`, () => {
      for (let length = 1; length <= command.name.length; length++) {
        expect(getSuggestions(tokenize(command.name.slice(0, length))).suggestions).toContainEqual(
          expect.objectContaining({ name: command.name, type: 'command' }),
        )
      }
    })
  for (const { input, level } of paths)
    it(`${input} 的全部子命令和选项可达`, () => {
      for (const child of level.subcommands ?? []) {
        expect(getSuggestions(tokenize(`${input} ${child.name.slice(0, 1)}`)).suggestions).toContainEqual(
          expect.objectContaining({ name: child.name, type: 'subcommand' }),
        )
      }
      for (const option of level.options ?? []) {
        expect(getSuggestions(tokenize(`${input} ${option.name}`)).suggestions).toContainEqual(
          expect.objectContaining({ name: option.name, type: 'option' }),
        )
        if (option.args?.suggestions)
          for (const value of option.args.suggestions) {
            expect(
              getSuggestions(tokenize(`${input} ${option.name} ${value.name.slice(0, 1)}`)).suggestions,
            ).toContainEqual(expect.objectContaining({ name: value.name, type: 'arg' }))
            expect(
              getSuggestions(tokenize(`${input} ${option.name}=${value.name.slice(0, 1)}`)).suggestions,
            ).toContainEqual(expect.objectContaining({ name: value.name, type: 'arg' }))
          }
        if (option.args && !option.args.fileGenerator && !option.args.generator && !option.args.suggestions) {
          expect(getDynamicGenerator(tokenize(`${input} ${option.name} `))).toBeNull()
        }
      }
    })
})

describe('全部文件命令及文件选项', () => {
  for (const command of fileCommands)
    it(`${command} 路径补全（含后续参数）`, () => {
      for (const input of [`${command} `, `${command} first `, `${command} -- ./项目\\ files/文`]) {
        expect(getDynamicGenerator(tokenize(input))).toMatchObject({
          generatorId: 'paths',
          parser: command === 'cd' ? 'directory-list' : 'file-list',
          dirsOnly: dirsOnly.has(command),
        })
      }
    })
  for (const input of [
    'git -C ',
    'docker build -f ',
    'docker build ',
    'kubectl --kubeconfig=',
    'kubectl apply -f ',
    'kubectl apply -k ',
    'kubectl delete -f ',
    'git add ',
    'git checkout -- ',
  ]) {
    it(`${input} 文件生成器`, () => expect(getDynamicGenerator(tokenize(input))?.generatorId).toBe('paths'))
  }
})

describe('全部动态入口经过真实 IPC schema 和响应解析', () => {
  for (const { input, level } of paths) {
    const entries = [
      { input: input + ' ', arg: level.args },
      ...(level.options ?? []).map((option) => ({ input: `${input} ${option.name} `, arg: option.args })),
    ]
    for (const entry of entries)
      if (entry.arg?.generator || entry.arg?.fileGenerator) {
        it(entry.input, async () => {
          const generator = getDynamicGenerator(tokenize(entry.input))!
          expect(generator).not.toBeNull()
          expect(generator.generatorId).toBe(entry.arg?.generator?.generatorId ?? 'paths')
          await sessionApi.complete('session', 'request', generator, '/srv/项目 files')
          const data =
            generator.generatorId === 'paths'
              ? { output: '', candidates: [{ name: 'sample', is_dir: true }] }
              : {
                  output:
                    generator.generatorId === 'docker-containers'
                      ? '123abc\tsample\n'
                      : generator.generatorId === 'kubectl-resources'
                        ? 'pod/sample\n'
                        : 'sample\n',
                }
          expect(
            parseCompletionData(data, '', generator.parser, generator.dirsOnly).map((item) => item.name),
          ).toEqual([generator.generatorId === 'paths' ? 'sample/' : 'sample'])
        })
      }
  }
})

describe('全部 Kubernetes 资源和命名空间位置', () => {
  const resources = [
    'pods',
    'deployments',
    'services',
    'configmaps',
    'secrets',
    'nodes',
    'namespaces',
    'ingresses',
    'jobs',
    'cronjobs',
    'statefulsets',
    'daemonsets',
    'replicasets',
    'persistentvolumeclaims',
    'serviceaccounts',
  ]
  for (const resource of resources)
    it(resource, () => {
      for (const verb of [
        'get',
        'describe',
        'delete',
        'edit',
        'scale',
        'rollout status',
        'rollout undo',
        'rollout history',
        'rollout restart',
      ]) {
        for (const input of [
          `kubectl -n team ${verb} ${resource} sa`,
          `kubectl ${verb} ${resource} --namespace=team sa`,
        ]) {
          expect(getDynamicGenerator(tokenize(input))).toMatchObject({
            generatorId: 'kubectl-resources',
            params: { resource, namespace: 'team' },
          })
        }
      }
    })
  for (const input of ['kubectl -n ku', 'kubectl --namespace=ku', 'kubectl get pods -n ku']) {
    it(input, () =>
      expect(getDynamicGenerator(tokenize(input))).toMatchObject({
        generatorId: 'kubectl-resources',
        params: { resource: 'namespaces' },
      }),
    )
  }
})

describe('解析、去重、前缀和特殊文件名', () => {
  it('Docker 名称、ID 描述和重行；kubectl kind；systemd/npm/远端行列表', () => {
    expect(
      parseCompletionData({ output: 'abc\tweb\ndef\tworker\nabc\tweb\n' }, 'we', 'docker-ps').map((s) => [
        s.name,
        s.description,
      ]),
    ).toEqual([['web', 'abc']])
    expect(
      parseCompletionData({ output: 'pod/web\npod/web\nservice/worker\n' }, 'we', 'kubectl-name').map(
        (s) => s.name,
      ),
    ).toEqual(['web'])
    expect(
      parseCompletionData({ output: '  app.service\napp.service\nworker.service\n' }, 'app', 'line-list').map(
        (s) => s.name,
      ),
    ).toEqual(['app.service'])
    expect(
      parseCompletionData({ output: '* main\nfeature/a\nfeature/a\n' }, 'fea', 'git-branch').map(
        (s) => s.name,
      ),
    ).toEqual(['feature/a'])
  })
  for (const [raw, name, expected] of [
    ['文', '文件 name@*', '件\\ name\\@\\*'],
    ['"My', 'My $file`name', ' \\$file\\`name'],
    ["'O", "O'Reilly", "'\\''Reilly"],
    ['--kubeconfig=./My', './My File', '\\ File'],
    ['./foo\\ ', './foo bar', 'bar'],
  ])
    it(`安全插入 ${raw}`, () => expect(buildCompletionInsertPlan(raw, name).insertText).toBe(expected))
  it('结构化候选保留后缀和空白，目录过滤、排序、去重及 200 项展示上限', () => {
    const data = {
      output: '',
      candidates: [
        { name: 'file@*', is_dir: false },
        { name: ' 项目 ', is_dir: true },
      ],
    }
    expect(parseCompletionData(data, './', 'file-list').map((s) => s.name)).toEqual(['./file@*', './ 项目 /'])
    expect(parseCompletionData(data, './', 'directory-list', true).map((s) => s.name)).toEqual(['./ 项目 /'])
    const rows = Array.from({ length: 250 }, (_, i) => ({
      name: String(i),
      type: 'arg' as const,
      origin: 'dynamic' as const,
    }))
    expect(rankCompletionCandidates([...rows, ...rows])).toHaveLength(200)
  })
  it('未知命令和纯数值参数不产生伪造候选', () => {
    expect(getDynamicGenerator(tokenize('unknown-command '))).toBeNull()
    expect(getSuggestions(tokenize('unknown-command ')).suggestions).toEqual([])
    for (const input of ['docker run --name ', 'docker logs --tail ', 'npm list --depth=']) {
      if (!input.startsWith('npm')) expect(getDynamicGenerator(tokenize(input))).toBeNull()
    }
  })
})
