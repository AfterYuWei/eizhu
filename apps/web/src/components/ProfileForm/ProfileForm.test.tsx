// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProfileForm } from './index'
import { useProfileStore } from '@/store/profile'
import { profileApi } from '@/api/profile'
import type { Profile } from '@/types/profile'

vi.mock('@/api/profile', () => ({ profileApi: { test: vi.fn(), testNew: vi.fn() } }))
const create = vi.fn(), update = vi.fn(), close = vi.fn()
let host: HTMLDivElement, root: Root
const profile: Profile = { id: 'server', name: '测试连接', host: 'server.example.test', port: 22, username: 'deploy', auth_type: 'password', proxy: { type: 'socks5', host: 'proxy.example.test', port: 1080, has_password: true }, tags: [], options: '{}', note: '测试备注', sort_order: 0, created_at: '', updated_at: '' }
const input = (id: string) => document.getElementById(id) as HTMLInputElement
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)! }
function fill(id: string, value: string) {
  const element = input(id)
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
async function tab(text: string) { await act(async () => { button(text).focus(); button(text).click() }) }
async function render(editing?: Profile) { await act(async () => root.render(<ProfileForm open onOpenChange={close} profile={editing} />)) }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0))
  create.mockResolvedValue(profile); update.mockResolvedValue(profile)
  useProfileStore.setState({ ...useProfileStore.getInitialState(), createProfile: create, updateProfile: update }, true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('跨页签保留草稿，从备注页提交完整连接与认证信息', async () => {
  await render()
  await act(async () => { fill('host', 'server.example.test'); fill('username', 'deploy') })
  await tab('身份认证')
  await act(async () => fill('password', '测试密码'))
  await tab('代理与备注')
  await act(async () => fill('note', '测试备注'))
  await tab('基本连接')
  expect(input('host').value).toBe('server.example.test')
  await tab('代理与备注')
  await act(async () => button('创建').click())
  expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'server.example.test', host: 'server.example.test', username: 'deploy', password: '测试密码', proxy: { type: 'direct' }, note: '测试备注' }))
  expect(close).toHaveBeenCalledWith(false)
})

it('隐藏页签漏填必填项时自动显示该页并聚焦第一个字段，测试连接也不能绕过', async () => {
  await render()
  await tab('身份认证')
  await act(async () => { button('创建').click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(button('基本连接').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(input('host'))
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('请填写主机')
  expect(create).not.toHaveBeenCalled()
  await act(async () => fill('host', 'server.example.test'))
  expect(document.querySelector('[role="alert"]')).toBeNull()
  await tab('代理与备注')
  await act(async () => { button('测试连接').click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(document.activeElement).toBe(input('username'))
  expect(profileApi.testNew).not.toHaveBeenCalled()
})

it('代理端口无效时定位代理页，修正后可在任意页测试已有连接并查看结果', async () => {
  vi.mocked(profileApi.test).mockResolvedValue({ success: true, message: '测试连接成功', latency_ms: 12, stages: [] })
  await render(profile)
  await tab('代理与备注')
  await act(async () => fill('proxy-port', '70000'))
  await tab('身份认证')
  await act(async () => { button('测试连接').click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(button('代理与备注').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(input('proxy-port'))
  expect(profileApi.test).not.toHaveBeenCalled()
  await act(async () => fill('proxy-port', '1080'))
  await tab('身份认证')
  expect(input('password').value).toBe('')
  expect(input('password').placeholder).toContain('留空则不修改')
  await act(async () => button('测试连接').click())
  expect(profileApi.test).toHaveBeenCalledWith('server', expect.objectContaining({ password: '', proxy: { type: 'socks5', host: 'proxy.example.test', port: 1080, username: '' } }))
  await tab('基本连接')
  expect(document.querySelector('.pf-feedback')?.textContent).toContain('测试连接成功')
  await act(async () => button('保存').click())
  expect(update).toHaveBeenCalledWith('server', expect.objectContaining({ password: '', proxy: expect.not.objectContaining({ password: expect.anything() }) }))
})

it('只输入空白的主机或用户名仍会定位基本连接页', async () => {
  await render()
  await act(async () => { fill('host', '   '); fill('username', 'deploy') })
  await tab('身份认证')
  await act(async () => { button('创建').click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(document.activeElement).toBe(input('host'))
  expect(create).not.toHaveBeenCalled()
  await act(async () => { fill('host', 'server.example.test'); fill('username', '   ') })
  await tab('代理与备注')
  await act(async () => { button('测试连接').click(); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect(document.activeElement).toBe(input('username'))
  expect(profileApi.testNew).not.toHaveBeenCalled()
})
