import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'

const args = process.argv.slice(2),
  synthetic = args.includes('--synthetic'),
  live = args.includes('--live')
if (synthetic === live)
  throw new Error('使用 --synthetic 验证本机验收工具，或 --live --email-file=<专用邮箱文件> 执行真实服务验收')
const emailFile = args.find((value) => value.startsWith('--email-file='))?.slice(13)
if (live && !emailFile)
  throw new Error('真实服务验收需要 --email-file；只保存未注册的专用测试邮箱，不需要密码')
if (emailFile) {
  const info = await stat(emailFile)
  if (!info.isFile() || info.size > 1024) throw new Error('邮箱文件不是小型文本文件')
}
const root = await mkdtemp(join(tmpdir(), 'eizhu-live-sync-')),
  profile = join(root, 'profile')
await mkdir(profile, { mode: 0o700 })
console.log(`已创建两个隔离客户端目录，验收根目录：${root}`)
if (live)
  console.log(
    '将对固定官方 HTTPS 服务创建专用测试账号并发送验证/找回邮件；测试密码不会输出。收到 input_required 后输入 {"code":"六位验证码"}，或 {"action":"resend"}。',
  )
const entry = resolve('apps/desktop/out/main/sync-acceptance.cjs')
await stat(entry)
const exitCode = await new Promise((accept, reject) => {
  const child = spawn(
    electron,
    [
      entry,
      `--acceptance-root=${profile}`,
      synthetic ? '--synthetic' : '--live',
      ...(emailFile ? [`--email-file=${resolve(emailFile)}`] : []),
    ],
    { stdio: 'inherit' },
  )
  child.once('error', reject)
  child.once('exit', (code) => accept(code ?? 1))
})
const reportPath = join(profile, 'acceptance.json')
if (exitCode !== 0) throw new Error(`验收未通过；隔离目录已保留：${root}`)
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const destination = resolve('artifacts/acceptance')
await mkdir(destination, { recursive: true })
const evidencePath = join(
  destination,
  `${synthetic ? 'synthetic' : 'live'}-${process.platform}-${process.arch}.json`,
)
await writeFile(evidencePath, JSON.stringify({ ...report, profileRoot: profile }, null, 2) + '\n')
console.log(`验收结果已保存：${evidencePath}`)
