import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, utimes, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { FileEndpoint, displayPath } from './endpoint.ts'
import { readText, writeText } from './editor.ts'
import { archive, collect } from './archive.ts'
const code = (expected: string) => (e: unknown) => (e as { error: { code: string } }).error.code === expected
test('本机文件领域不能读取、列出或重命名应用私有目录及其别名', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-private-')),
    privateRoot = join(root, 'private'),
    alias = join(root, 'alias')
  await mkdir(privateRoot)
  await writeFile(join(privateRoot, 'device-key'), 'synthetic-device-key')
  const e = new FileEndpoint(undefined, privateRoot)
  try {
    await assert.rejects(e.stat(displayPath(join(privateRoot, 'device-key'))), code('FORBIDDEN'))
    await assert.rejects(e.list(displayPath(privateRoot)), code('FORBIDDEN'))
    await assert.rejects(
      e.rename(displayPath(privateRoot), displayPath(join(root, 'moved'))),
      code('FORBIDDEN'),
    )
    assert.ok(!(await e.list(displayPath(root))).some((row) => row.name === 'private'))
    if (process.platform !== 'win32') {
      await symlink(privateRoot, alias)
      await assert.rejects(e.stat(displayPath(join(alias, 'device-key'))), code('FORBIDDEN'))
    }
  } finally {
    await e.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('文本保存保留权限、换行和内容哈希，已有文件另存不覆盖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-file-')),
    e = new FileEndpoint(),
    path = displayPath(join(root, '配置.json'))
  try {
    await writeFile(join(root, '配置.json'), '旧内容\r\n', { mode: 0o640 })
    const opened = await readText(e, path)
    assert.equal(opened.line_ending, 'crlf')
    await writeText(e, path, {
      content: '新内容\n',
      expected_mod_time: opened.mod_time,
      expected_content_hash: opened.content_hash,
      line_ending: 'crlf',
    })
    assert.equal(await readFile(join(root, '配置.json'), 'utf8'), '新内容\r\n')
    assert.equal((await stat(join(root, '配置.json'))).mode & 0o777, 0o640)
    await assert.rejects(
      writeText(e, path, { content: '误覆盖', expected_mod_time: '', create_new: true }),
      code('FILE_EXISTS'),
    )
  } finally {
    await e.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('相同 mtime 的远端变化仍以内容哈希拒绝覆盖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-conflict-')),
    e = new FileEndpoint(),
    path = displayPath(join(root, 'a'))
  try {
    await writeFile(join(root, 'a'), 'aaa')
    const opened = await readText(e, path),
      before = await stat(join(root, 'a'))
    await writeFile(join(root, 'a'), 'bbb')
    await utimes(join(root, 'a'), before.atime, before.mtime)
    await assert.rejects(
      writeText(e, path, {
        content: 'ccc',
        expected_mod_time: opened.mod_time,
        expected_content_hash: opened.content_hash,
      }),
      code('FILE_MODIFIED'),
    )
    assert.equal(await readFile(join(root, 'a'), 'utf8'), 'bbb')
  } finally {
    await e.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('编辑器拒绝非法 UTF-8、二进制和超大文本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-text-')),
    e = new FileEndpoint(),
    path = displayPath(join(root, 'a'))
  try {
    for (const [bytes, error] of [
      [Buffer.from([0xff]), 'UNSUPPORTED_ENCODING'],
      [Buffer.from([0]), 'BINARY_FILE'],
      [Buffer.alloc(10 * 1024 * 1024 + 1, 65), 'FILE_TOO_LARGE'],
    ] as const) {
      await writeFile(join(root, 'a'), bytes)
      await assert.rejects(readText(e, path), code(error))
    }
  } finally {
    await e.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('符号链接及链接目录不能用于修改、读取或归档', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-link-')),
    e = new FileEndpoint()
  try {
    await mkdir(join(root, 'dir'))
    await writeFile(join(root, 'dir', 'a'), 'safe')
    await symlink(join(root, 'dir'), join(root, 'link'))
    const path = displayPath(join(root, 'link', 'a'))
    await assert.rejects(readText(e, path), code('SYMLINK_UNSAFE'))
    await assert.rejects(
      writeText(e, path, { content: 'unsafe', expected_mod_time: '' }),
      code('SYMLINK_UNSAFE'),
    )
    await assert.rejects(collect(e, [displayPath(join(root, 'link'))]), code('SYMLINK_UNSAFE'))
    assert.equal(await readFile(join(root, 'dir', 'a'), 'utf8'), 'safe')
  } finally {
    await e.close()
    await rm(root, { recursive: true, force: true })
  }
})
test('目录 tar.gz 与 ZIP 流携带真实字节、空目录及中文路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-archive-')),
    e = new FileEndpoint()
  try {
    await mkdir(join(root, '目录', 'empty'), { recursive: true })
    await writeFile(join(root, '目录', 'a.txt'), '中文 archive')
    const rows = await collect(e, [displayPath(join(root, '目录'))])
    for (const format of ['tar.gz', 'zip'] as const) {
      const chunks: Buffer[] = []
      for await (const b of archive(e, rows, format)) chunks.push(b)
      const bytes = Buffer.concat(chunks),
        decoded = format === 'tar.gz' ? gunzipSync(bytes) : bytes
      assert.ok(decoded.includes(Buffer.from('中文 archive')))
      assert.ok(decoded.includes(Buffer.from('目录/empty/')))
      if (format === 'zip') assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50)
    }
  } finally {
    await e.close()
    await rm(root, { recursive: true, force: true })
  }
})
