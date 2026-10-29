import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import ssh2 from 'ssh2'
import type { Connection } from 'ssh2'
import { complete, completionCommand } from './completion.ts'
import { failureOf } from '@eizhu/contracts'
import type { CompletionGeneratorRequest } from '@eizhu/contracts/models/completion'

const { Server, Client, utils } = ssh2

/** Actual loopback SSH/SFTP protocol. Docker/kubectl/systemctl executables are explicit fixtures. */
test(
  'all completion generators over real SSH/SFTP with isolated CLI fixtures',
  { skip: process.platform === 'win32', timeout: 45000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'eizhu-completion-'))
    const cwd = join(root, "项目 ' files"),
      bin = join(root, 'bin')
    await mkdir(cwd)
    await mkdir(bin)
    const env = { ...process.env, PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter) }
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({ scripts: { dev: 'touch MUST_NOT_RUN', 'build:qa': 'exit 1' } }),
    )
    execFileSync('git', ['init', '-q'], { cwd })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=QA',
        '-c',
        'user.email=qa@example.invalid',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'fixture',
      ],
      { cwd },
    )
    execFileSync('git', ['branch', 'feature/qa'], { cwd })
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/repo.git'], { cwd })
    const otherRepo = join(root, "other repo's"),
      nestedRepo = join(otherRepo, 'nested')
    await mkdir(nestedRepo, { recursive: true })
    await cp(join(cwd, '.git'), join(otherRepo, '.git'), { recursive: true })
    execFileSync('git', ['branch', '-m', 'feature/qa', 'feature/other'], { cwd: otherRepo })
    execFileSync('git', ['remote', 'rename', 'origin', 'other-origin'], { cwd: otherRepo })
    await cp(join(otherRepo, '.git'), join(nestedRepo, '.git'), { recursive: true })
    execFileSync('git', ['branch', '-m', 'feature/other', 'feature/nested'], { cwd: nestedRepo })
    for (const [name, body] of [
      [
        'docker',
        `if [ "$1" = '--host=unix:///qa socket' ]; then printf 'qa123\\tqa-web\\n';else case "$*" in *-a*) printf 'abc\\tweb\\ndef\\tstopped\\n';; *) printf 'abc\\tweb\\n';; esac;fi`,
      ],
      [
        'kubectl',
        `if [ "$1" = '--kubeconfig=qa dir/config' ];then case "$*" in *get-contexts*) printf 'qa-context\\n';; *) printf 'pod/config-web\\n';; esac;else case "$*" in *get-contexts*) printf 'dev\\nprod\\n';; *) printf 'pod/web\\npod/worker\\n';; esac;fi`,
      ],
      [
        'systemctl',
        `if [ "$1" = '--user' ];then case "$*" in *--state=failed*) printf 'broken-user.service loaded failed\\n';; *) printf 'user-app.service loaded active\\n';; esac;else case "$*" in *--state=failed*) printf 'broken.service loaded failed\\n';; *--state=active*) printf 'app.service loaded active\\n';; *) printf 'app.service enabled\\nworker.service disabled\\n';; esac;fi`,
      ],
    ])
      await writeFile(join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o700 })

    const clients = new Set<Connection>(),
      opened: string[] = [],
      executed: string[] = []
    const rows = [
      { filename: '.', dir: true },
      { filename: '..', dir: true },
      { filename: '.hidden', dir: false },
      { filename: "中文 ' name@*", dir: false },
      { filename: 'child', dir: true },
    ]
    const server = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, (connection) => {
      clients.add(connection)
      connection.on('error', () => undefined)
      connection.once('close', () => clients.delete(connection))
      connection.on('authentication', (ctx) => ctx.accept())
      connection.on('ready', () =>
        connection.on('session', (accept) => {
          const session = accept()
          session.on('exec', (accept, _reject, info) => {
            const channel = accept()
            executed.push(info.command)
            channel.on('error', () => undefined)
            const child = spawn('/bin/sh', ['-c', info.command], { cwd, env })
            child.stdout.pipe(channel, { end: false })
            child.stderr.pipe(channel.stderr, { end: false })
            child.once('close', (code) => {
              channel.exit(code ?? 1)
              channel.end()
            })
            channel.once('close', () => child.kill())
          })
          session.on('sftp', (accept) => {
            const sftp = accept()
            const handles = new Map<string, { rows: typeof rows; offset: number }>()
            sftp.on('REALPATH', (id: number) =>
              sftp.name(id, [
                {
                  filename: '/home/qa',
                  longname: '',
                  attrs: { mode: 0o040755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 },
                },
              ]),
            )
            sftp.on('OPENDIR', (id: number, path: string) => {
              opened.push(path)
              if (path === '/denied') {
                sftp.status(id, 3)
                return
              }
              if (path === '/wait') return
              const entries =
                path === '/large' || path === '/candidate-limit'
                  ? Array.from({ length: path === '/large' ? 10001 : 5000 }, (_, i) => ({
                      filename: `file-${i}`,
                      dir: false,
                    }))
                  : path === '/metadata-limit'
                    ? Array.from({ length: 1200 }, (_, i) => ({
                        filename: `${i}-` + 'x'.repeat(2000),
                        dir: false,
                      }))
                    : rows
              const handle = Buffer.from(String(handles.size))
              handles.set(handle.toString(), { rows: entries, offset: 0 })
              sftp.handle(id, handle)
            })
            sftp.on('READDIR', (id: number, handle: Buffer) => {
              const state = handles.get(handle.toString())!
              const batch = state.rows.slice(
                state.offset,
                state.offset + (state.rows[0].filename.length > 1000 ? 10 : 100),
              )
              state.offset += batch.length
              if (!batch.length) {
                sftp.status(id, 1)
                return
              }
              sftp.name(
                id,
                batch.map((r) => ({
                  filename: r.filename,
                  longname: '',
                  attrs: { mode: r.dir ? 0o040755 : 0o100644, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 },
                })),
              )
            })
            sftp.on('CLOSE', (id: number, handle: Buffer) => {
              handles.delete(handle.toString())
              sftp.status(id, 0)
            })
          })
        }),
      )
    })
    const client = new Client()
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      client.connect({ host: '127.0.0.1', port: address.port, username: 'qa', hostVerifier: () => true })
      await once(client, 'ready')
      const run = (
        request: CompletionGeneratorRequest,
        directory = cwd,
        signal = new AbortController().signal,
      ) => complete(client, request, directory, signal)
      const cases: { request: CompletionGeneratorRequest; expected: string }[] = [
        { request: { generatorId: 'git-branches', params: {} }, expected: 'feature/qa' },
        { request: { generatorId: 'git-remotes', params: {} }, expected: 'origin' },
        { request: { generatorId: 'docker-containers', params: {} }, expected: 'abc\tweb' },
        { request: { generatorId: 'docker-containers', params: { all: true } }, expected: 'def\tstopped' },
        {
          request: { generatorId: 'kubectl-resources', params: { namespace: "qa ' team", resource: 'pods' } },
          expected: 'pod/web',
        },
        { request: { generatorId: 'kubectl-contexts', params: {} }, expected: 'prod' },
        { request: { generatorId: 'systemd-service-units', params: {} }, expected: 'worker.service' },
        { request: { generatorId: 'systemd-active-units', params: {} }, expected: 'app.service' },
        { request: { generatorId: 'systemd-failed-units', params: {} }, expected: 'broken.service' },
        { request: { generatorId: 'npm-scripts', params: {} }, expected: 'build:qa' },
      ]
      for (const { request, expected } of cases)
        await t.test(request.generatorId + JSON.stringify(request.params), async () => {
          const result = await run(request)
          assert.equal(result.code, 0)
          assert.ok(result.output.split('\n').includes(expected), result.output)
          assert.equal(result.candidates, undefined)
        })
      await t.test(
        'Git -C selects the actual repository for branches, remotes and file candidates',
        async () => {
          const result = await run({ generatorId: 'git-branches', params: { gitDirectories: [otherRepo] } })
          assert.ok(result.output.includes('feature/other'))
          assert.ok(!result.output.includes('feature/qa'))
          assert.equal(
            (
              await run({ generatorId: 'git-remotes', params: { gitDirectories: [otherRepo] } })
            ).output.trim(),
            'other-origin',
          )
          assert.ok(
            (
              await run({
                generatorId: 'git-branches',
                params: { gitDirectories: ["../other repo's", 'nested'] },
              })
            ).output.includes('feature/nested'),
          )
          await run({
            generatorId: 'paths',
            params: { gitDirectories: [otherRepo, 'nested'], directory: 'src/' },
          })
          assert.equal(opened.at(-1)?.replace(/\/$/, ''), join(nestedRepo, 'src'))
        },
      )
      await t.test('Docker -H reaches the requested fixture endpoint as one literal operand', async () => {
        const result = await run({
          generatorId: 'docker-containers',
          params: { dockerHost: 'unix:///qa socket' },
        })
        assert.equal(result.output.trim(), 'qa123\tqa-web')
        assert.ok(!(await run({ generatorId: 'docker-containers', params: {} })).output.includes('qa-web'))
      })
      await t.test('kubectl resources and contexts both use the selected kubeconfig', async () => {
        assert.equal(
          (
            await run({ generatorId: 'kubectl-resources', params: { kubeconfig: 'qa dir/config' } })
          ).output.trim(),
          'pod/config-web',
        )
        assert.ok(!executed.at(-1)?.includes('--namespace='))
        assert.equal(
          (
            await run({ generatorId: 'kubectl-contexts', params: { kubeconfig: 'qa dir/config' } })
          ).output.trim(),
          'qa-context',
        )
      })
      await t.test('all systemd unit generators honor --user', async () => {
        for (const generatorId of [
          'systemd-service-units',
          'systemd-active-units',
          'systemd-failed-units',
        ] as const) {
          const result = await run({ generatorId, params: { systemdUser: true } })
          assert.equal(
            result.output.trim(),
            generatorId === 'systemd-failed-units' ? 'broken-user.service' : 'user-app.service',
          )
        }
      })
      await t.test('relative, absolute, home, dot, parent and Unicode path operands', async () => {
        for (const [directory, base, expected] of [
          ['.', '/srv/qa', '/srv/qa'],
          ['../', '/srv/qa', '/srv'],
          ['child/', '/srv/qa', '/srv/qa/child/'],
          ['~/', '/srv/qa', '/home/qa/'],
          ['~/../', '/srv/qa', '/home'],
          ['../', '~', '/home'],
          ["/项目 ' files", '/srv/qa', "/项目 ' files"],
        ]) {
          const result = await run({ generatorId: 'paths', params: { directory, prefix: '中文' } }, base)
          assert.equal(opened.at(-1)?.replace(/\/$/, ''), expected.replace(/\/$/, ''))
          assert.deepEqual(result.candidates, [{ name: "中文 ' name@*", is_dir: false }])
        }
        const result = await run({ generatorId: 'paths', params: {} }, '/home/qa')
        assert.equal(result.candidates?.length, 3)
        assert.ok(result.candidates?.some((r) => r.name === 'child' && r.is_dir))
      })
      await t.test('directory failures, cancellation, timeout and output bounds', async () => {
        assert.equal(
          (await run({ generatorId: 'paths', params: { directory: '/candidate-limit' } })).candidates?.length,
          4096,
        )
        await assert.rejects(
          run({ generatorId: 'paths', params: { directory: '/denied' } }),
          (e) => failureOf(e).code === 'SFTP_READ_FAILED',
        )
        for (const directory of ['/large', '/metadata-limit']) {
          await assert.rejects(
            run({ generatorId: 'paths', params: { directory } }),
            (e) => failureOf(e).code === 'OUTPUT_LIMIT',
          )
        }
        const controller = new AbortController()
        const pending = run({ generatorId: 'paths', params: { directory: '/wait' } }, cwd, controller.signal)
        setTimeout(() => controller.abort(), 30)
        await assert.rejects(pending, (e) => failureOf(e).code === 'CANCELLED')
        await assert.rejects(
          run({ generatorId: 'paths', params: { directory: '/wait' } }),
          (e) => failureOf(e).code === 'SSH_EXEC_TIMEOUT',
        )
      })
      await t.test('shell operands remain literal and npm discovery does not execute scripts', async () => {
        const namespace = "x'; touch MUST_NOT_RUN; '"
        const result = await run({ generatorId: 'kubectl-resources', params: { namespace } })
        assert.equal(result.code, 0)
        assert.ok(executed.at(-1)?.includes("'x'\\''; touch MUST_NOT_RUN; '\\'''"))
        assert.ok(!completionCommand({ generatorId: 'npm-scripts', params: {} }, cwd).includes('npm run'))
        for (const request of [
          { generatorId: 'docker-containers', params: { dockerHost: namespace } },
          { generatorId: 'kubectl-contexts', params: { kubeconfig: namespace } },
        ] satisfies CompletionGeneratorRequest[])
          assert.equal((await run(request)).code, 0)
        await assert.rejects(import('node:fs/promises').then((fs) => fs.access(join(cwd, 'MUST_NOT_RUN'))))
      })
      await t.test('nonzero CLI status and exec output limit are preserved', async () => {
        await writeFile(join(bin, 'docker'), '#!/bin/sh\nexit 127\n', { mode: 0o700 })
        assert.equal((await run({ generatorId: 'docker-containers', params: {} })).code, 127)
        await writeFile(
          join(cwd, 'package.json'),
          JSON.stringify({ scripts: { ['x'.repeat(300000)]: 'exit 1' } }),
        )
        await assert.rejects(
          run({ generatorId: 'npm-scripts', params: {} }),
          (e) => failureOf(e).code === 'OUTPUT_LIMIT',
        )
      })
    } finally {
      client.destroy()
      for (const connection of clients) connection.end()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
)
