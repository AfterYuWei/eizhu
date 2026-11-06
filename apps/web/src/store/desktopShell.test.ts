// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsStorage } from '@/lib/settingsStorage'
import { restoreSidebarGroups, useDesktopShellStore } from './desktopShell'
import { localStateApi } from '@/api/localState'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { toast } from 'sonner'

vi.mock('@/api/localState', () => ({ localStateApi: { read: vi.fn(), write: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  useDesktopShellStore.setState(useDesktopShellStore.getInitialState(), true)
  setWorkspaceGeneration(1)
  vi.mocked(localStateApi.read).mockResolvedValue(null)
  vi.mocked(localStateApi.write).mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

it('旧列表和服务器整体折叠偏好不再水化或持久化，保留详情宽度', async () => {
  const get = vi.spyOn(settingsStorage, 'getItem').mockReturnValue(JSON.stringify({ state: {
    serverRatio: 0.2, openedCollapsed: true, serversCollapsed: true, inspectorWidth: 400,
  }, version: 0 }))
  const write = vi.spyOn(settingsStorage, 'setItem').mockImplementation(() => {})
  try {
    await useDesktopShellStore.persist.rehydrate()
    const state = useDesktopShellStore.getState()
    expect(state).not.toHaveProperty('serversCollapsed')
    expect(state).not.toHaveProperty('toggleServers')
    expect(state.inspectorWidth).toBe(400)
    expect(state).not.toHaveProperty('serverRatio')
    expect(state).not.toHaveProperty('openedCollapsed')
    state.setInspectorWidth(400)
    const saved = JSON.parse(write.mock.calls.at(-1)![1])
    expect(saved.state).toEqual({ inspectorWidth: 400 })
  } finally {
    get.mockRestore(); write.mockRestore()
    useDesktopShellStore.setState(useDesktopShellStore.getInitialState(), true)
  }
})

it('父子文件夹独立记忆，重新载入时恢复，本地状态不进入全局偏好', async () => {
  const write = vi.spyOn(settingsStorage, 'setItem').mockImplementation(() => {})
  await restoreSidebarGroups()
  useDesktopShellStore.getState().toggleGroup('parent')
  useDesktopShellStore.getState().toggleGroup('child')
  useDesktopShellStore.getState().toggleGroup('parent')
  const saved = vi.mocked(localStateApi.write).mock.calls.at(-1)![1]
  expect(saved).toEqual({ parent: false, child: true })
  expect(JSON.parse(write.mock.calls.at(-1)![1]).state).toEqual({ inspectorWidth: 400 })
  useDesktopShellStore.setState({ collapsedGroups: {}, groupsReady: false })
  vi.mocked(localStateApi.read).mockResolvedValue(saved)
  await restoreSidebarGroups()
  expect(useDesktopShellStore.getState().collapsedGroups).toEqual({ parent: false, child: true })
})

it('加载期间的文件夹操作保留，合并后保存其他文件夹的旧状态', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(localStateApi.read).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const pending = restoreSidebarGroups()
  useDesktopShellStore.getState().toggleGroup('parent')
  useDesktopShellStore.getState().toggleGroup('parent')
  expect(localStateApi.write).not.toHaveBeenCalled()
  finish({ parent: true, child: true })
  await pending
  expect(useDesktopShellStore.getState().collapsedGroups).toEqual({ parent: false, child: true })
  expect(localStateApi.write).toHaveBeenLastCalledWith('sidebar_groups', { parent: false, child: true })
})

it('切换工作空间后丢弃旧响应，恢复新空间自己的状态', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(localStateApi.read).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const pending = restoreSidebarGroups()
  setWorkspaceGeneration(2)
  useDesktopShellStore.setState({ collapsedGroups: {}, groupsReady: false })
  vi.mocked(localStateApi.read).mockResolvedValue({ other: true })
  await restoreSidebarGroups()
  finish({ old: true })
  await pending
  expect(useDesktopShellStore.getState().collapsedGroups).toEqual({ other: true })
  expect(localStateApi.write).not.toHaveBeenCalledWith('sidebar_groups', { old: true })
})

it.each([new Error('unavailable'), { parent: 'true' }])('读取失败或损坏状态时提示且不覆盖磁盘偏好：%s', async (saved) => {
  if (saved instanceof Error) vi.mocked(localStateApi.read).mockRejectedValue(saved)
  else vi.mocked(localStateApi.read).mockResolvedValue(saved)
  await restoreSidebarGroups()
  useDesktopShellStore.getState().toggleGroup('parent')
  expect(toast.warning).toHaveBeenCalled()
  expect(localStateApi.write).not.toHaveBeenCalled()
})

it('保存失败提示用户，当前展开状态仍可使用', async () => {
  await restoreSidebarGroups()
  vi.mocked(localStateApi.write).mockRejectedValue(new Error('unavailable'))
  useDesktopShellStore.getState().toggleGroup('parent')
  await Promise.resolve()
  expect(toast.error).toHaveBeenCalled()
  expect(useDesktopShellStore.getState().collapsedGroups.parent).toBe(true)
})
