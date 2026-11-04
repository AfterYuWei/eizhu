// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DesktopError, type SshGlobalEvent } from '@eizhu/contracts'
import type { TunnelConfig, TunnelStatus } from '@/api/tunnel'
import type { Profile } from '@/types/profile'
import { tunnelApi } from '@/api/tunnel'
import { profileApi } from '@/api/profile'
import { useProfileStore } from '@/store/profile'
import { setWorkspaceGeneration } from '@/lib/workspaceScope'
import { writeClipboardText } from '@/lib/clipboard'
import { PortMappingView } from './PortMappingView'

const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }))
vi.mock('@/lib/bridge', () => ({ listen: listenMock }))
vi.mock('@/api/tunnel', () => ({ tunnelApi: { list: vi.fn(), statuses: vi.fn(), save: vi.fn(), start: vi.fn(), stop: vi.fn(), remove: vi.fn() } }))
vi.mock('@/api/profile', () => ({ profileApi: { list: vi.fn() } }))
vi.mock('@/lib/clipboard', () => ({ writeClipboardText: vi.fn() }))
// Exercise form and filter behavior without depending on Radix pointer events in jsdom.
// The real selectors and portals are also exercised in Electron smoke tests.
vi.mock('@/components/ui/select', async () => {
  const { createContext, useContext } = await import('react')
  const Context = createContext({ value: '', change: (_value: string) => {} })
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => <Context.Provider value={{ value, change: onValueChange }}><div data-select>{children}</div></Context.Provider>,
    SelectTrigger: (props: React.ComponentProps<'button'>) => <button type="button" role="combobox" {...props} />,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{useContext(Context).value || placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => { const context = useContext(Context); return <button type="button" data-value={value} onClick={() => context.change(value)}>{children}</button> },
  }
})

const rule = (id: string, extra: Partial<TunnelConfig> = {}): TunnelConfig => ({ id, name: `映射${id}`, profile_id: 'p', kind: 'local', bind_host: '127.0.0.1', bind_port: 0, target_host: '127.0.0.1', target_port: 5432, ...extra })
const status = (id: string, extra: Partial<TunnelStatus> = {}): TunnelStatus => ({ id, status: 'stopped', generation: 1, revision: 1, bound_port: null, active_connections: 0, retry_attempt: 0, error_code: null, error_message: null, ...extra })
let root: Root
let host: HTMLDivElement
let deliver: (event: { payload: SshGlobalEvent }) => void
let unsubscribe: ReturnType<typeof vi.fn>
const render = async (active = true) => act(async () => root.render(<PortMappingView active={active} />))
const row = (id: string) => host.querySelector<HTMLElement>(`[data-mapping-id="${id}"]`)!
const button = (name: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent === name)!
const click = async (name: string, within?: ParentNode) => act(async () => button(name, within).click())
const input = async (field: string, value: string) => act(async () => {
  const control = document.querySelector<HTMLInputElement>(field)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(control, value)
  control.dispatchEvent(new Event('input', { bubbles: true }))
})
const select = async (field: string, value: string) => act(async () => {
  document.querySelector(field)!.closest('[data-select]')!.querySelector<HTMLButtonElement>(`[data-value="${value}"]`)!.click()
})
const event = (state: TunnelStatus, workspaceGeneration = 1): { payload: SshGlobalEvent } => ({ payload: { type: 'tunnel_status', session_id: state.id, workspaceGeneration, payload: state } })

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.resetAllMocks()
  setWorkspaceGeneration(1)
  useProfileStore.setState({ profiles: [{ id: 'p', name: '测试服务器' } as Profile] })
  vi.mocked(profileApi.list).mockResolvedValue([{ id: 'p', name: '测试服务器', host: 'test.example.invalid' } as Profile])
  vi.mocked(tunnelApi.list).mockResolvedValue([rule('a'), rule('b', { kind: 'remote' }), rule('c', { kind: 'dynamic' })])
  vi.mocked(tunnelApi.statuses).mockResolvedValue([status('a'), status('b'), status('c')])
  unsubscribe = vi.fn()
  listenMock.mockImplementation(async (_name, callback) => { deliver = callback; return unsubscribe })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })

it('保留旧规则，区分两端位置，按名称、服务器、端点、类型和状态筛选', async () => {
  useProfileStore.setState({ profiles: [] })
  await render()
  expect(host.querySelectorAll('.pm-rule')).toHaveLength(3)
  expect(row('a').textContent).toContain('远端目标服务')
  expect(row('b').textContent).toContain('本机侧目标服务')
  expect(row('c').textContent).toContain('SOCKS5 · TCP CONNECT')
  await input('[aria-label="搜索端口映射"]', '测试服务器')
  expect(host.querySelectorAll('.pm-rule')).toHaveLength(3)
  await input('[aria-label="搜索端口映射"]', '5432')
  expect(host.querySelectorAll('.pm-rule')).toHaveLength(2)
  await select('[aria-label="映射类型筛选"]', 'remote')
  expect(host.querySelectorAll('.pm-rule')).toHaveLength(1)
  await select('[aria-label="映射状态筛选"]', 'running')
  expect(host.textContent).toContain('没有匹配的映射')
  await click('清除筛选')
  expect(host.querySelectorAll('.pm-rule')).toHaveLength(3)
})

it('逐条去重启动，不锁住其他规则；实际 IPv6 端口可复制，运行中禁止编辑', async () => {
  vi.mocked(tunnelApi.list).mockResolvedValue([rule('a', { bind_host: '::1' }), rule('b')])
  let finish!: (state: TunnelStatus) => void
  vi.mocked(tunnelApi.start).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  await render()
  await click('启动 映射a')
  expect(button('启动 映射a').disabled).toBe(true)
  expect(button('启动 映射b').disabled).toBe(false)
  await click('启动 映射a')
  expect(tunnelApi.start).toHaveBeenCalledTimes(1)
  await act(async () => finish(status('a', { status: 'running', bound_port: 45678, revision: 3 })))
  expect(row('a').textContent).toContain('[::1]:45678')
  expect(button('编辑 映射a').disabled).toBe(true)
  await click('复制 映射a 监听地址')
  expect(writeClipboardText).toHaveBeenCalledWith('[::1]:45678')
  expect(row('a').textContent).toContain('已复制')
})

it('停止等待服务端释放；删除失败保留规则和错误，成功后才移除', async () => {
  vi.mocked(tunnelApi.statuses).mockResolvedValue([status('a', { status: 'running', bound_port: 2222 })])
  await render()
  vi.mocked(tunnelApi.statuses).mockResolvedValue([status('a', { revision: 5 })])
  await click('停止 映射a')
  expect(tunnelApi.stop).toHaveBeenCalledWith('a')
  expect(row('a').textContent).toContain('已停止')
  vi.mocked(tunnelApi.remove).mockRejectedValueOnce(new Error('监听尚未释放'))
  await click('删除 映射a')
  await click('确认删除')
  expect(row('a')).not.toBeNull()
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('监听尚未释放')
  vi.mocked(tunnelApi.remove).mockResolvedValue(undefined)
  await click('确认删除')
  expect(row('a')).toBeNull()
  expect(row('b')).not.toBeNull()
})

it('先订阅再读取快照，迟到快照及旧空间事件不能复活已停止的规则', async () => {
  let snapshot!: (states: TunnelStatus[]) => void
  vi.mocked(tunnelApi.statuses).mockImplementation(() => new Promise((resolve) => { snapshot = resolve }))
  await render()
  await act(async () => deliver(event(status('a', { revision: 10 }))))
  await act(async () => snapshot([status('a', { status: 'running', bound_port: 2222, revision: 2 })]))
  expect(row('a').textContent).toContain('已停止')
  await act(async () => deliver(event(status('a', { status: 'running', revision: 20 }), 0)))
  expect(row('a').textContent).toContain('已停止')
  setWorkspaceGeneration(2)
  await act(async () => deliver(event(status('a', { status: 'running', revision: 30 }))))
  expect(row('a').textContent).toContain('已停止')
})

it('离开页面解除订阅且不停止映射，重新进入读取状态；加载失败可重试', async () => {
  await render()
  await render(false)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(tunnelApi.stop).not.toHaveBeenCalled()
  vi.mocked(tunnelApi.list).mockRejectedValueOnce(new Error('暂时无法读取'))
  await render()
  expect(host.textContent).toContain('暂时无法读取')
  await click('重新加载')
  expect(host.querySelectorAll('.pm-rule')).toHaveLength(3)
})

it('新增校验定位字段，动态代理隐藏目标字段，保存只保存配置', async () => {
  await render()
  await click('新增映射', host)
  await click('保存')
  expect(document.activeElement?.getAttribute('data-field')).toBe('name')
  expect(tunnelApi.save).not.toHaveBeenCalled()
  await input('[data-field="name"]', '动态代理')
  expect(document.querySelector('[data-field="name"]')!.getAttribute('aria-invalid')).toBe('false')
  await select('[data-field="profile_id"]', 'p')
  await select('[role="dialog"] [role="combobox"]', 'dynamic')
  expect(document.querySelector('[data-field="target_port"]')).toBeNull()
  await input('[data-field="bind_port"]', '0')
  vi.mocked(tunnelApi.save).mockImplementation(async (config) => ({ ...config, id: 'new' }))
  await click('保存')
  expect(tunnelApi.save).toHaveBeenCalledWith({ id: '', name: '动态代理', profile_id: 'p', kind: 'dynamic', bind_host: '127.0.0.1', bind_port: 0, target_host: '127.0.0.1', target_port: 80 })
  expect(tunnelApi.start).not.toHaveBeenCalled()
  expect(row('new')).not.toBeNull()
})

it('本地和远端字段区分目标位置，端口必填；保存失败保留表单，取消确认未保存修改', async () => {
  await render()
  await click('新增映射', host)
  await select('[role="dialog"] [role="combobox"]', 'remote')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('本机侧目标服务')
  await input('[data-field="name"]', '开发服务')
  await select('[data-field="profile_id"]', 'p')
  await click('保存')
  expect(document.activeElement?.getAttribute('data-field')).toBe('bind_port')
  await input('[data-field="bind_port"]', '9000')
  await input('[data-field="target_port"]', '3000')
  vi.mocked(tunnelApi.save).mockRejectedValueOnce(new Error('保存失败，请重试'))
  await click('保存')
  expect(document.querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('开发服务')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('保存失败，请重试')
  await click('取消')
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  await click('继续编辑')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click('取消')
  await click('放弃修改')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('保存期间锁住表单并忽略关闭；页面卸载后不应用迟到的保存结果', async () => {
  let finish!: (config: TunnelConfig) => void
  vi.mocked(tunnelApi.save).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  await render()
  await click('编辑 映射a')
  await input('[data-field="name"]', '待保存')
  await click('保存')
  expect(button('取消').disabled).toBe(true)
  expect(document.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true)
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => root.render(null))
  setWorkspaceGeneration(2)
  await act(async () => finish(rule('a', { name: '待保存' })))
  expect(host.textContent).toBe('')
  expect(tunnelApi.start).not.toHaveBeenCalled()
})

it('三种模式的对外监听每次启动都二次确认，取消不发请求，确认携带当前规则', async () => {
  const rules = [rule('a', { bind_host: '0.0.0.0' }), rule('b', { kind: 'remote', bind_host: '::' }), rule('c', { kind: 'dynamic', bind_host: '0.0.0.0' })]
  vi.mocked(tunnelApi.list).mockResolvedValue(rules)
  vi.mocked(tunnelApi.start).mockImplementation(async (id) => status(id, { status: 'running', bound_port: 12345, revision: 2 }))
  await render()
  expect(host.querySelectorAll('.pm-public-label')).toHaveLength(3)
  for (const config of rules) {
    await click(`启动 ${config.name}`)
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('确认对外开放此映射？')
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain(config.name)
    if (config.kind === 'remote') expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('GatewayPorts clientspecified')
    if (config.kind === 'dynamic') expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('没有客户端认证')
    const before = vi.mocked(tunnelApi.start).mock.calls.length
    await click('取消')
    expect(tunnelApi.start).toHaveBeenCalledTimes(before)
    await click(`启动 ${config.name}`)
    await click('确认对外开放并启动')
    expect(tunnelApi.start).toHaveBeenLastCalledWith(config.id, config)
  }
  vi.mocked(tunnelApi.statuses).mockResolvedValue([status('a', { revision: 10 })])
  await click('停止 映射a')
  await click('启动 映射a')
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  expect(tunnelApi.start).toHaveBeenCalledTimes(3)
  await click('取消')
})

it('默认回环监听；选择对外地址先提示风险，保存仍不启动', async () => {
  await render()
  await click('编辑 映射a')
  expect(document.querySelector('.pm-public-warning')).toBeNull()
  await select('[data-field="bind_host"]', '0.0.0.0')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('每次手动启动前都需要再次确认')
  await select('[role="dialog"] [role="combobox"]', 'dynamic')
  expect(document.querySelector('.pm-public-warning[role="note"]')).toBeNull()
  expect(document.querySelector<HTMLInputElement>('[data-field="bind_port"]')!.value).toBe('')
  await select('[data-field="bind_host"]', '::')
  await input('[data-field="bind_port"]', '1080')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('没有客户端认证')
  vi.mocked(tunnelApi.save).mockImplementation(async (config) => config)
  await click('保存')
  expect(tunnelApi.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', bind_host: '::', kind: 'dynamic' }))
  expect(tunnelApi.start).not.toHaveBeenCalled()
})

it('切换类型分别保留监听和目标草稿，远端服务器监听也能选择 0.0.0.0', async () => {
  await render()
  await click('新增映射', host)
  await input('[data-field="name"]', '独立方向草稿')
  await select('[data-field="profile_id"]', 'p')
  await select('[data-field="bind_host"]', '0.0.0.0')
  await input('[data-field="bind_port"]', '15432')
  await input('[data-field="target_host"]', 'database.example.com')
  await input('[data-field="target_port"]', '5432')
  await select('[data-field="kind"]', 'remote')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('服务器监听地址')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('本机侧目标主机')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('127.0.0.1 指当前电脑')
  expect(document.querySelector<HTMLInputElement>('[data-field="bind_port"]')!.value).toBe('')
  expect(document.querySelector<HTMLInputElement>('[data-field="target_host"]')!.value).toBe('127.0.0.1')
  await select('[data-field="bind_host"]', '0.0.0.0')
  await input('[data-field="bind_port"]', '9000')
  await input('[data-field="target_host"]', '192.0.2.10')
  await input('[data-field="target_port"]', '3000')
  await select('[data-field="kind"]', 'local')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('本机监听地址')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('远端目标主机')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('SSH 服务器自身')
  expect(document.querySelector<HTMLInputElement>('[data-field="target_host"]')!.value).toBe('database.example.com')
  expect(document.querySelector<HTMLInputElement>('[data-field="bind_port"]')!.value).toBe('15432')
  await select('[data-field="kind"]', 'dynamic')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('目标地址由代理客户端逐次指定')
  expect(document.querySelector('[data-field="target_host"]')).toBeNull()
  expect(document.querySelector('[data-field="bind_host"]')!.textContent).toContain('127.0.0.1')
  await select('[data-field="kind"]', 'remote')
  expect(document.querySelector('[data-field="bind_host"]')!.textContent).toContain('0.0.0.0')
  expect(document.querySelector<HTMLInputElement>('[data-field="target_host"]')!.value).toBe('192.0.2.10')
  expect(document.querySelector<HTMLInputElement>('[data-field="target_port"]')!.value).toBe('3000')
  vi.mocked(tunnelApi.save).mockImplementation(async (config) => ({ ...config, id: 'direction' }))
  await click('保存')
  expect(tunnelApi.save).toHaveBeenCalledWith({ id: '', name: '独立方向草稿', profile_id: 'p', kind: 'remote', bind_host: '0.0.0.0', bind_port: 9000, target_host: '192.0.2.10', target_port: 3000 })
})

it('流向预览随类型和端点更新，IPv6 使用括号，SOCKS5 展示客户端目标分流', async () => {
  await render()
  await click('新增映射', host)
  const preview = () => document.querySelector('.pm-flow svg[role="img"]')!
  const steps = () => [...preview().querySelectorAll('[data-flow-step] .pm-flow-label')].map((node) => node.textContent)
  expect(preview().getAttribute('aria-label')).toContain('本机监听 → SSH → 远端目标')
  expect(steps()).toEqual(['本机监听', 'SSH 服务器', '远端目标'])
  await select('[data-field="profile_id"]', 'p')
  await select('[data-field="bind_host"]', '::1')
  await input('[data-field="bind_port"]', '15432')
  await input('[data-field="target_host"]', 'database.example.com')
  await input('[data-field="target_port"]', '5432')
  expect(preview().getAttribute('aria-label')).toContain('监听 [::1]:15432；目标 database.example.com:5432')
  expect(preview().getAttribute('aria-label')).toContain('test.example.invalid')
  await select('[data-field="kind"]', 'remote')
  await select('[data-field="bind_host"]', '0.0.0.0')
  await input('[data-field="bind_port"]', '0')
  await input('[data-field="target_host"]', '192.0.2.10')
  await input('[data-field="target_port"]', '3000')
  expect(preview().getAttribute('aria-label')).toContain('服务器监听 → SSH → 本机侧目标；监听 0.0.0.0:自动；目标 192.0.2.10:3000')
  expect(steps()).toEqual(['SSH 服务器监听', '本机 · eizhu', '本机侧目标'])
  await select('[data-field="kind"]', 'dynamic')
  expect(preview().getAttribute('aria-label')).toContain('本机 SOCKS5 → SSH → 客户端指定目标')
  expect(preview().getAttribute('aria-label')).not.toContain('192.0.2.10')
  expect(preview().querySelectorAll('.pm-flow-targets .pm-flow-node')).toHaveLength(3)
  expect(steps()).toEqual(['本机 SOCKS5', 'SSH 服务器', '多个目标'])
  await select('[data-field="kind"]', 'local')
  expect(preview().getAttribute('aria-label')).toContain('监听 [::1]:15432；目标 database.example.com:5432')
})

it('本机侧目标地址可下拉选择也可自定义，选择后焦点回到输入框', async () => {
  await render()
  await click('编辑 映射b')
  await input('[data-field="target_host"]', 'service.example.com')
  const openAddresses = async () => act(async () => {
    button('选择本机侧目标地址').dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
  })
  await openAddresses()
  expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['127.0.0.1', '::1', 'localhost', 'service.example.com'])
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === '::1')!.click())
  expect(document.querySelector<HTMLInputElement>('[data-field="target_host"]')!.value).toBe('::1')
  // Radix restores focus after its close animation, on a deferred task.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(document.activeElement?.getAttribute('data-field')).toBe('target_host')
  await input('[data-field="target_host"]', '2001:db8::20')
  vi.mocked(tunnelApi.save).mockImplementation(async (config) => config)
  await click('保存')
  expect(tunnelApi.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'remote', target_host: '2001:db8::20' }))
})

it('公网确认过期错误留在规则内，不自动重试启动', async () => {
  vi.mocked(tunnelApi.list).mockResolvedValue([rule('a', { bind_host: '0.0.0.0' })])
  vi.mocked(tunnelApi.start).mockRejectedValue(new DesktopError({ code: 'TUNNEL_CONFIG_CHANGED', message: '映射配置已变化，请重新核对后启动' }))
  await render()
  const changed = rule('a', { bind_host: '0.0.0.0', target_port: 5433 })
  vi.mocked(tunnelApi.list).mockResolvedValue([changed])
  await click('启动 映射a')
  await click('确认对外开放并启动')
  expect(row('a').textContent).toContain('映射配置已变化')
  expect(row('a').textContent).toContain('5433')
  expect(tunnelApi.start).toHaveBeenCalledOnce()
  await click('启动 映射a')
  expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('5433')
  expect(tunnelApi.start).toHaveBeenCalledOnce()
  await click('取消')
})

it.each([
  ['local', '203.0.113.10'],
  ['remote', 'service.example.com'],
  ['remote', '2001:db8::10'],
] as const)('%s 映射可保存公网目标 %s，目标地址不改变监听范围或触发对外监听确认', async (kind, targetHost) => {
  vi.mocked(tunnelApi.list).mockResolvedValue([rule('a', { kind })])
  vi.mocked(tunnelApi.save).mockImplementation(async (config) => config)
  vi.mocked(tunnelApi.start).mockResolvedValue(status('a', { status: 'running', bound_port: 15432, revision: 2 }))
  await render()
  await click('编辑 映射a')
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain(`由${kind === 'remote' ? '本机' : 'SSH 服务器'}访问目标`)
  await input('[data-field="target_host"]', targetHost)
  await input('[data-field="target_port"]', '443')
  await click('保存')
  expect(tunnelApi.save).toHaveBeenCalledWith(expect.objectContaining({ kind, target_host: targetHost, target_port: 443, bind_host: '127.0.0.1' }))
  expect(tunnelApi.start).not.toHaveBeenCalled()
  await click('启动 映射a')
  expect(tunnelApi.start).toHaveBeenCalledWith('a')
  expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  expect(row('a').querySelector('.pm-public-label')).toBeNull()
})
