import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompletionCache } from './completionCache'
afterEach(() => vi.useRealTimers())
describe('补全有界 LRU', () => {
  it('隔离账号、服务器、连接代次和 cwd，并在 TTL 到期移除', () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    let scope = 'account1/profile1/connection1'
    const cache = createCompletionCache(() => scope)
    cache.set('generator', '/a', { output: 'one' })
    expect(cache.get('generator', '/b', 100)).toBeNull()
    scope = 'account1/profile1/connection2'; expect(cache.get('generator', '/a', 100)).toBeNull()
    scope = 'account2/profile1/connection1'; expect(cache.get('generator', '/a', 100)).toBeNull()
    scope = 'account1/profile1/connection1'; vi.advanceTimersByTime(100)
    expect(cache.get('generator', '/a', 100)).toBeNull()
  })
  it('128 项淘汰最近未读取项，候选最多 200 项', () => {
    const cache = createCompletionCache()
    for (let i = 0; i < 128; i++) cache.set(String(i), '/', { output: '' })
    cache.get('0', '/', 10000)
    cache.set('128', '/', { output: '', candidates: Array.from({ length: 300 }, (_, i) => ({ name: String(i), is_dir: false })) })
    expect(cache.get('1', '/', 10000)).toBeNull()
    expect(cache.get('0', '/', 10000)).not.toBeNull()
    expect(cache.get('128', '/', 10000)?.candidates).toHaveLength(200)
  })
  it('按 UTF-8 字节限制 1 MiB 并淘汰旧条目', () => {
    const cache = createCompletionCache()
    cache.set('old', '/', { output: '中'.repeat(200000) })
    cache.set('new', '/', { output: '中'.repeat(200000) })
    expect(cache.get('old', '/', 10000)).toBeNull()
    expect(cache.get('new', '/', 10000)).not.toBeNull()
    cache.set('huge', '/', { output: '中'.repeat(400000) })
    expect(cache.get('huge', '/', 10000)).toBeNull()
  })
})
