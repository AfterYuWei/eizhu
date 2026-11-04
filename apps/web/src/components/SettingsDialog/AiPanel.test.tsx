// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AiPanel } from './AiPanel'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => ({ settings: vi.fn(), discover: vi.fn(), test: vi.fn(), configure: vi.fn() }))
vi.mock('@/lib/bridge', () => ({ bridge: () => ({ ai: mocks }) }))
const saved = { source: 'custom', endpoint: 'http://127.0.0.1:9000/v1', model: '', hasApiKey: true }
let host: HTMLDivElement, root: Root
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((value) => value.textContent === label)!
const input = (selector: string) => host.querySelector<HTMLInputElement>(selector)!
const render = () =>
  act(async () =>
    root.render(
      <TooltipProvider>
        <AiPanel />
      </TooltipProvider>,
    ),
  )
const change = async (selector: string, value: string) =>
  act(async () => {
    const target = input(selector)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value)
    target.dispatchEvent(new Event('input', { bubbles: true }))
  })
beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.settings.mockResolvedValue(saved)
  mocks.discover.mockResolvedValue({
    models: [{ id: 'ops', name: '运维模型' }],
    defaultModel: 'ops',
    message: '已发现 1 个模型',
  })
  mocks.test.mockResolvedValue({ message: 'Responses 连接成功' })
  mocks.configure.mockResolvedValue({ ...saved, model: 'ops' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

it('uses shared dropdowns and tests discovered draft models without saving', async () => {
  await render()
  expect(host.querySelectorAll('button[role="combobox"]')).toHaveLength(2)
  expect(host.querySelector('select:not([aria-hidden="true"])')).toBeNull()
  expect(host.textContent).not.toContain('仅支持 Responses API')
  expect(host.querySelector('button[aria-label="AI 助手使用说明"]')).not.toBeNull()
  await change('#ai-endpoint', 'http://127.0.0.1:9001/v1')
  await change('#ai-key', 'draft-provider-key')
  await act(async () => button('自动发现模型').click())
  expect(mocks.discover).toHaveBeenCalledWith({
    source: 'custom',
    endpoint: 'http://127.0.0.1:9001/v1',
    model: '',
    apiKey: 'draft-provider-key',
  })
  expect(host.textContent).toContain('运维模型')
  await act(async () => button('测试连接').click())
  expect(mocks.test).toHaveBeenCalledWith({
    source: 'custom',
    endpoint: 'http://127.0.0.1:9001/v1',
    model: 'ops',
    apiKey: 'draft-provider-key',
  })
  expect(mocks.configure).not.toHaveBeenCalled()
  await act(async () => button('保存设置').click())
  expect(mocks.configure).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'ops', apiKey: 'draft-provider-key' }),
  )
  expect(input('#ai-key').value).toBe('')
})

it('keeps manual drafts after discovery failure and blocks duplicate tests', async () => {
  mocks.discover.mockRejectedValue(new Error('该服务未提供模型列表'))
  await render()
  await change('[aria-label="手动模型名"]', 'manual-model')
  await act(async () => button('自动发现模型').click())
  expect(input('[aria-label="手动模型名"]').value).toBe('manual-model')
  expect(host.textContent).toContain('该服务未提供模型列表')
  let finish!: (value: { message: string }) => void
  mocks.test.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await act(async () => {
    button('测试连接').click()
    button('测试连接').click()
  })
  expect(mocks.test).toHaveBeenCalledTimes(1)
  expect(mocks.test).toHaveBeenCalledWith(expect.objectContaining({ model: 'manual-model' }))
  await act(async () => finish({ message: '连接可用' }))
  expect(host.textContent).toContain('连接可用')
  expect(mocks.configure).not.toHaveBeenCalled()
})

it('clears the saved key while preserving unsaved connection drafts', async () => {
  mocks.configure.mockResolvedValue({ ...saved, hasApiKey: false })
  await render()
  await change('#ai-endpoint', 'http://127.0.0.1:9002/v1')
  await change('[aria-label="手动模型名"]', 'draft-model')
  await act(async () => button('清除密钥').click())
  expect(mocks.configure).toHaveBeenCalledWith({
    source: 'custom',
    endpoint: saved.endpoint,
    model: '',
    apiKey: '',
  })
  expect(input('#ai-endpoint').value).toBe('http://127.0.0.1:9002/v1')
  expect(input('[aria-label="手动模型名"]').value).toBe('draft-model')
  expect(button('清除密钥')).toBeUndefined()
})
