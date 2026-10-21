// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { settingsStorage } from '@/lib/settingsStorage'
import { useDesktopShellStore } from './desktopShell'

it('旧列表偏好不再水化或持久化，保留服务器折叠和详情宽度', async () => {
  const get = vi.spyOn(settingsStorage, 'getItem').mockReturnValue(JSON.stringify({ state: {
    serverRatio: 0.2, openedCollapsed: true, serversCollapsed: true, inspectorWidth: 400,
  }, version: 0 }))
  const write = vi.spyOn(settingsStorage, 'setItem').mockImplementation(() => {})
  try {
    await useDesktopShellStore.persist.rehydrate()
    const state = useDesktopShellStore.getState()
    expect(state.serversCollapsed).toBe(true)
    expect(state.inspectorWidth).toBe(400)
    expect(state).not.toHaveProperty('serverRatio')
    expect(state).not.toHaveProperty('openedCollapsed')
    state.toggleServers()
    const saved = JSON.parse(write.mock.calls.at(-1)![1])
    expect(saved.state).toEqual({ serversCollapsed: false, inspectorWidth: 400 })
  } finally {
    get.mockRestore(); write.mockRestore()
    useDesktopShellStore.setState(useDesktopShellStore.getInitialState(), true)
  }
})
