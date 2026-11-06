import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  listGroups: vi.fn(),
  updateProfile: vi.fn(),
}))

vi.mock('@/api/profile', () => ({
  profileApi: { list: mocks.listProfiles, update: mocks.updateProfile },
}))

vi.mock('@/api/group', () => ({
  groupApi: { list: mocks.listGroups },
}))

import { useProfileStore } from './profile'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import type { Profile } from '@/types/profile'

const profile: Profile = { id: 'a', name: '服务器 A', host: 'a.example.test', port: 22, username: 'user', auth_type: 'password', proxy: { type: 'direct' }, sort_order: 0, tags: [], options: '{}', note: '', created_at: '', updated_at: '' }

beforeEach(() => {
  mocks.listProfiles.mockReset()
  mocks.listGroups.mockReset()
  mocks.updateProfile.mockReset()
  setWorkspaceGeneration(1)
  useProfileStore.setState({
    profiles: [],
    groups: [],
    selectedGroupId: null,
    searchQuery: '',
    loading: false,
    error: null,
  })
})

describe('profile save and refresh ordering', () => {
  it('保存提交后立即使用返回的配置，迟到的旧列表不能回写旧地址', async () => {
    let resolveOld!: (profiles: Profile[]) => void
    mocks.listProfiles.mockReturnValueOnce(new Promise<Profile[]>((resolve) => { resolveOld = resolve }))
    useProfileStore.setState({ profiles: [profile] })
    const oldRead = useProfileStore.getState().fetchProfiles()
    const saved = { ...profile, host: 'new-a.example.test', port: 2222 }
    mocks.updateProfile.mockResolvedValue(saved)
    let resolveNew!: (profiles: Profile[]) => void
    mocks.listProfiles.mockReturnValueOnce(new Promise<Profile[]>((resolve) => { resolveNew = resolve }))
    await useProfileStore.getState().updateProfile('a', { host: saved.host, port: saved.port })
    expect(useProfileStore.getState().profiles).toEqual([saved])
    resolveOld([profile])
    await oldRead
    expect(useProfileStore.getState().profiles).toEqual([saved])
    resolveNew([saved])
    await Promise.resolve()
    expect(useProfileStore.getState().profiles).toEqual([saved])
  })

  it('同步刷新与切换账号后，旧空间的服务器列表不会替换当前列表', async () => {
    let resolveOld!: (profiles: Profile[]) => void
    mocks.listProfiles.mockReturnValueOnce(new Promise<Profile[]>((resolve) => { resolveOld = resolve }))
    mocks.listGroups.mockResolvedValue([])
    const oldRead = useProfileStore.getState().refreshAll()
    setWorkspaceGeneration(2)
    const other = { ...profile, id: 'b', name: '服务器 B' }
    useProfileStore.getState().applySnapshot([other], [])
    resolveOld([profile])
    await oldRead
    expect(useProfileStore.getState().profiles).toEqual([other])
  })
})

describe('profile store detected icons', () => {
  it('更新默认或已自动识别的图标，但保留用户手动选择', async () => {
    mocks.updateProfile.mockResolvedValue({})
    useProfileStore.setState({
      profiles: [{ id: 'profile-1', name: 'NAS', icon: 'server' }] as never,
    })

    await useProfileStore.getState().updateDetectedIcon('profile-1', 'os-fnos')

    expect(mocks.updateProfile).toHaveBeenCalledWith('profile-1', { icon: 'os-fnos' })
    expect(useProfileStore.getState().profiles[0].icon).toBe('os-fnos')

    mocks.updateProfile.mockClear()
    useProfileStore.setState({
      profiles: [{ id: 'profile-1', name: 'NAS', icon: 'harddrive' }] as never,
    })
    await useProfileStore.getState().updateDetectedIcon('profile-1', 'os-proxmox')

    expect(mocks.updateProfile).not.toHaveBeenCalled()
    expect(useProfileStore.getState().profiles[0].icon).toBe('harddrive')
  })
})

describe('profile store refreshAll', () => {
  it('直接应用导入响应中的已提交数据快照', () => {
    const profiles = [{ id: 'profile-1', name: '导入服务器' }]
    const groups = [{ id: 'group-1', name: '导入分组' }]
    useProfileStore.setState({ selectedGroupId: 'old-group', searchQuery: 'old-filter', loading: true })

    useProfileStore.getState().applySnapshot(profiles as never, groups as never)

    expect(useProfileStore.getState()).toMatchObject({
      profiles,
      groups,
      selectedGroupId: null,
      searchQuery: '',
      loading: false,
      error: null,
    })
    expect(mocks.listProfiles).not.toHaveBeenCalled()
    expect(mocks.listGroups).not.toHaveBeenCalled()
  })

  it('备份导入后清除旧筛选并原子加载全部服务器和分组', async () => {
    const profiles = [{ id: 'profile-1', name: '生产服务器' }]
    const groups = [{ id: 'group-1', name: '生产环境' }]
    useProfileStore.setState({ selectedGroupId: 'old-group', searchQuery: 'old-filter' })
    mocks.listProfiles.mockResolvedValue(profiles)
    mocks.listGroups.mockResolvedValue(groups)

    await useProfileStore.getState().refreshAll()

    expect(mocks.listProfiles).toHaveBeenCalledWith()
    expect(mocks.listGroups).toHaveBeenCalledWith()
    expect(useProfileStore.getState()).toMatchObject({
      profiles,
      groups,
      selectedGroupId: null,
      searchQuery: '',
      loading: false,
      error: null,
    })
  })

  it('刷新失败时保留可展示的后端错误并向调用方抛出', async () => {
    const failure = { error: { code: 'DB_ERROR', message: '读取导入数据失败' } }
    mocks.listProfiles.mockRejectedValue(failure)
    mocks.listGroups.mockResolvedValue([])

    await expect(useProfileStore.getState().refreshAll()).rejects.toBe(failure)

    expect(useProfileStore.getState()).toMatchObject({
      loading: false,
      error: '读取导入数据失败',
    })
  })
})
