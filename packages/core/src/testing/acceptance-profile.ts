import { cp, lstat, readFile, realpath } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

/** Only resume our stopped, pre-key live acceptance profile. Never accepts application data roots. */
export async function cloneAcceptanceProfile(
  source: string,
  destination: string,
  mode: 'live' | 'local' = 'live',
): Promise<string> {
  if ((await lstat(source)).isSymbolicLink()) throw new Error('验收来源不能是符号链接')
  const resolved = await realpath(source),
    parts = relative(await realpath(tmpdir()), resolved).split(sep)
  if (parts.length !== 2 || !/^eizhu-live-sync-[A-Za-z0-9]{6}$/.test(parts[0]) || parts[1] !== 'profile')
    throw new Error('只能续跑本机临时验收目录')
  const reportPath = join(resolved, 'failure.json'),
    info = await lstat(reportPath)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) throw new Error('验收来源报告无效')
  const bytes = await readFile(reportPath),
    report = JSON.parse(bytes.toString())
  if (report.mode !== mode || report.passed !== false || report.phase !== 'initial-preview')
    throw new Error('只能续跑已注册但尚未创建同步密钥的验收')
  if (!Array.isArray(report.clients) || report.clients.length !== 2) throw new Error('验收客户端记录无效')
  for (const [index, label] of ['device-a', 'device-b'].entries()) {
    const client = report.clients[index]
    if (client.actor !== label || client.pushCount !== 0 || !Array.isArray(client.responses))
      throw new Error('验收客户端记录无效')
    if (
      client.responses.some(
        (r: { path: string; method: string }) => r.path.startsWith('/api/sync/') && r.method !== 'GET',
      )
    )
      throw new Error('已有同步写入的验收不能自动续跑')
  }
  const responses = report.clients[0].responses
  for (const path of ['/api/auth/register', '/api/auth/email/verify'])
    if (!responses.some((r: { path: string; status: number }) => r.path === path && r.status === 200))
      throw new Error('来源缺少专用账号注册和验证证据')
  for (const label of ['device-a', 'device-b'])
    await cp(join(resolved, label), join(destination, label), {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: async (path) => {
        const entry = await lstat(path)
        if (entry.isSymbolicLink()) throw new Error('验收数据不能含符号链接')
        if (basename(path).endsWith('.sqlite-wal') && entry.size > 0)
          throw new Error('验收数据库尚未关闭，不能复制')
        return !basename(path).endsWith('.sqlite-shm')
      },
    })
  return createHash('sha256').update(bytes).digest('hex')
}
