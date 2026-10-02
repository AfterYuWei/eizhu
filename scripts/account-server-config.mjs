import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Release packages must contain a usable address, never credentials. */
export function validateAccountServer(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('打包需要配置账号服务地址')
  if (/[\u0000-\u0020]/u.test(value.trim())) throw new Error('账号服务地址不能包含空白或控制字符')
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('账号服务地址不是有效 URL') }
  const host = url.hostname.replace(/\.$/u, '')
  if (url.protocol !== 'https:' || !host || host.endsWith('.invalid')
    || host === 'invalid' || ['example.com', 'example.org', 'example.net'].some((name) => host === name || host.endsWith(`.${name}`))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('账号服务地址必须是有效 HTTPS 地址，不能包含占位域名、认证信息、查询或片段')
  }
  return url.href
}

export function accountServerForChannel(channel, environment) {
  if (!['stable', 'test'].includes(channel)) throw new Error('未知桌面发布通道')
  return validateAccountServer(environment[channel === 'stable'
    ? 'EIZHU_ACCOUNT_SERVER_STABLE' : 'EIZHU_ACCOUNT_SERVER_TEST'])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const address = accountServerForChannel(process.env.EIZHU_BUILD_CHANNEL, process.env)
    if (!process.env.GITHUB_ENV) throw new Error('CI 环境文件未配置')
    appendFileSync(process.env.GITHUB_ENV, `EIZHU_ACCOUNT_SERVER=${address}\n`)
    console.log('账号服务地址已校验并注入当前发布通道')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
