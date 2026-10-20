import { afterEach, describe, expect, it, vi } from 'vitest'
import { languageWorkerReady } from './languageWorkerReady'

describe('languageWorkerReady', () => {
  afterEach(() => vi.useRealTimers())

  it('在 Monaco 语言尚未注册时等待后成功', async () => {
    vi.useFakeTimers()
    const notRegistered = 'TypeScript not registered!'
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(notRegistered)
      .mockResolvedValue('ready')

    const result = languageWorkerReady(load, notRegistered)
    await vi.advanceTimersByTimeAsync(50)

    await expect(result).resolves.toBe('ready')
    expect(load).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('其他错误立即拒绝且不重试', async () => {
    vi.useFakeTimers()
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('worker load failed'))

    await expect(languageWorkerReady(load, 'TypeScript not registered!')).rejects.toThrow(
      'worker load failed',
    )
    expect(load).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('15 秒到期后拒绝并清理等待计时器', async () => {
    vi.useFakeTimers()
    const notRegistered = 'JSON not registered!'
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(notRegistered)
    const rejection = expect(languageWorkerReady(load, notRegistered)).rejects.toMatchObject({
      message: '语言服务初始化超时',
      cause: notRegistered,
    })

    await vi.advanceTimersByTimeAsync(15_000)
    await rejection

    expect(load).toHaveBeenCalledTimes(301)
    expect(vi.getTimerCount()).toBe(0)
  })
})
