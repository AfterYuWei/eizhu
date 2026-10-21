import { posix } from 'node:path'
import type { Client, SFTPWrapper } from 'ssh2'
import { networkError } from './network.ts'
import { execBounded } from './connection.ts'
import type { CompletionGeneratorRequest } from '@eizhu/contracts/models/completion'
export const quote = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'"
export function completionCommand(request: CompletionGeneratorRequest, cwd = '~'): string {
  const p = request.params
  const commands: Record<Exclude<CompletionGeneratorRequest['generatorId'], 'paths'>, string> = {
    'git-branches': 'git for-each-ref --format="%(refname:short)" refs/heads refs/remotes',
    'git-remotes': 'git remote',
    'docker-containers': `docker ps ${p.all ? '-a ' : ''}--format '{{.ID}}\t{{.Names}}'`,
    'kubectl-resources': `kubectl ${p.namespace ? '--namespace ' + quote(p.namespace) + ' ' : ''}get ${quote(p.resource ?? 'pods')} -o name`,
    'kubectl-contexts': 'kubectl config get-contexts -o name',
    'systemd-service-units':
      "systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null | awk '{print $1}'",
    'systemd-active-units':
      "systemctl list-units --type=service --state=active --no-legend --no-pager 2>/dev/null | awk '{print $1}'",
    'systemd-failed-units':
      "systemctl list-units --type=service --state=failed --no-legend --no-pager 2>/dev/null | awk '{print $1}'",
    'npm-scripts':
      'node -e \'try{process.stdout.write(Object.keys(require("./package.json").scripts||{}).join("\\n"))}catch{}\'',
  }
  if (request.generatorId === 'paths') throw networkError('BAD_REQUEST', '路径补全使用目录读取')
  const directory =
    cwd === '~' ? '"$HOME"' : cwd.startsWith('~/') ? '"$HOME"/' + quote(cwd.slice(2)) : quote(cwd)
  return `cd -- ${directory} && ${commands[request.generatorId]}`
}
export async function withSftp<T>(
  client: Client,
  signal: AbortSignal,
  run: (sftp: SFTPWrapper) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let handle: SFTPWrapper | undefined,
      settled = false
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      handle?.end()
      if (error) reject(error)
      else resolve(value!)
    }
    const abort = () => finish(networkError('CANCELLED', '目录查询已取消'))
    const timer = setTimeout(() => finish(networkError('SSH_EXEC_TIMEOUT', '目录查询超时')), 10000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    client.sftp((error, sftp) => {
      if (error) {
        finish(networkError('SFTP_READ_FAILED', '远端目录不可读'))
        return
      }
      handle = sftp
      if (settled) {
        sftp.end()
        return
      }
      sftp.once('error', () => finish(networkError('SFTP_READ_FAILED', '远端目录不可读')))
      void run(sftp).then(
        (v) => finish(undefined, v),
        (e) => finish(e),
      )
    })
  })
}
export async function readDirectory(client: Client, path: string, signal: AbortSignal) {
  return withSftp(client, signal, async (sftp) => {
    if (path === '~' || path.startsWith('~/')) {
      const home = await new Promise<string>((resolve, reject) =>
        sftp.realpath('.', (e, p) =>
          e ? reject(networkError('SFTP_READ_FAILED', '无法确定远端主目录')) : resolve(p),
        ),
      )
      path = path === '~' ? home : posix.join(home, path.slice(2))
    }
    if (path.length > 32768) throw networkError('BAD_REQUEST', '远端路径过长')
    const handle = await new Promise<Buffer>((resolve, reject) =>
      sftp.opendir(path, (e, h) =>
        e ? reject(networkError('SFTP_READ_FAILED', '远端目录不可读')) : resolve(h),
      ),
    )
    const rows: Array<{
      filename: string
      attrs: { isDirectory(): boolean; size: number; mtime: number; mode: number }
    }> = []
    let bytes = 0
    try {
      for (;;) {
        const batch = await new Promise<import('ssh2').FileEntryWithStats[] | false>((resolve, reject) =>
          sftp.readdir(handle, (e, r) =>
            e
              ? (e as Error & { code?: number }).code === 1
                ? resolve(false)
                : reject(networkError('SFTP_READ_FAILED', '远端目录不可读'))
              : resolve(r),
          ),
        )
        if (!batch || !batch.length) break
        for (const row of batch) {
          bytes += Buffer.byteLength(row.filename) + Buffer.byteLength(path) + 128
          if (rows.length >= 10000 || bytes > 2 * 1024 * 1024)
            throw networkError('OUTPUT_LIMIT', '目录条目超过限制')
          rows.push(row)
        }
      }
      return rows
    } finally {
      sftp.close(handle, () => undefined)
    }
  })
}
export async function complete(
  client: Client,
  request: CompletionGeneratorRequest,
  cwd: string,
  signal: AbortSignal,
) {
  if (request.generatorId !== 'paths')
    return { ...(await execBounded(client, completionCommand(request, cwd), signal)), candidates: undefined }
  const dir = request.params.directory
  const directory =
    dir === undefined
      ? cwd
      : dir.startsWith('/') || dir === '~' || dir.startsWith('~/')
        ? dir
        : posix.join(cwd, dir)
  const rows = await readDirectory(client, directory, signal)
  return {
    output: '',
    code: 0,
    candidates: rows
      .filter(
        (r) =>
          r.filename !== '.' && r.filename !== '..' && r.filename.startsWith(request.params.prefix ?? ''),
      )
      .slice(0, 4096)
      .map((r) => ({ name: r.filename, is_dir: r.attrs.isDirectory() })),
  }
}
