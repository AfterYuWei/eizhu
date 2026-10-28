import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import electron from 'electron'

const args = process.argv.slice(2),
  synthetic = args.includes('--synthetic'),
  local = args.includes('--local'),
  live = args.includes('--live')
if (Number(synthetic) + Number(local) + Number(live) !== 1)
  throw new Error('选择 --synthetic、--local（127.0.0.1:8080 测试环境）或 --live（生产环境）')
const mode = synthetic ? 'synthetic' : local ? 'local' : 'live'
const resetExisting = args.includes('--reset-existing-account')
if (resetExisting && !local) throw new Error('重置已有测试账号仅限 --local 本机隔离测试环境')
const emailFile = args.find((value) => value.startsWith('--email-file='))?.slice(13)
const resumeProfile = args.find((value) => value.startsWith('--resume-profile='))?.slice(17)
if (resetExisting && resumeProfile) throw new Error('请选择已有账号恢复或目录续跑其中一种')
if (resumeProfile && synthetic) throw new Error('续跑仅用于已注册、尚未创建同步密钥的服务验收')
if (!synthetic && !emailFile)
  throw new Error('服务验收需要 --email-file；只保存专用测试邮箱，不需要密码')
if (emailFile) {
  const info = await stat(emailFile)
  if (!info.isFile() || info.size > 1024) throw new Error('邮箱文件不是小型文本文件')
}
const root = await mkdtemp(join(tmpdir(), 'eizhu-live-sync-')),
  profile = join(root, 'profile')
await mkdir(profile, { mode: 0o700 })
console.log(`已创建两个隔离客户端目录，验收根目录：${root}`)
if (!synthetic)
  console.log(
    `${local ? '本机测试环境 http://127.0.0.1:8080' : '生产环境 https://eizhu.yuweinfo.com'}：${resumeProfile || resetExisting ? '通过找回邮件恢复专用测试账号' : '创建专用测试账号'}；测试密码不会输出。收到 input_required 后输入 {"code":"六位验证码"}，或 {"action":"resend"}。`,
  )
const entry = resolve('apps/desktop/out/main/sync-acceptance.cjs')
await stat(entry)
const exitCode = await new Promise((accept, reject) => {
  const child = spawn(
    electron,
    [
      entry,
      `--acceptance-root=${profile}`,
      `--${mode}`,
      ...(resetExisting ? ['--reset-existing-account'] : []),
      ...(emailFile ? [`--email-file=${resolve(emailFile)}`] : []),
      ...(resumeProfile ? [`--resume-profile=${resolve(resumeProfile)}`] : []),
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
const evidencePath = join(destination, `${mode}-${process.platform}-${process.arch}.json`)
await writeFile(evidencePath, JSON.stringify({ ...report, profileRoot: profile }, null, 2) + '\n')
console.log(`验收结果已保存：${evidencePath}`)
