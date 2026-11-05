// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { AiBackend, AiSettings } from '@eizhu/contracts'
import { useAiStore } from '@/store/ai'
import { AiPanel } from './AiPanel'
const api = vi.hoisted(() => ({
  ai: {
    settings: vi.fn(),
    setEnabled: vi.fn(),
    setDefault: vi.fn(),
    configure: vi.fn(),
    removeProvider: vi.fn(),
    discover: vi.fn(),
    test: vi.fn(),
    configureCli: vi.fn(),
    cliStatus: vi.fn(),
    capabilities: vi.fn(),
  },
}))
vi.mock('@/lib/bridge', () => ({ bridge: () => api }))
let host: HTMLDivElement, root: Root
const settings: AiSettings = {
  enabled: true,
  providers: [
    {
      id: 'p',
      name: '服务A',
      protocol: 'responses',
      endpoint: 'https://provider.invalid/v1',
      model: 'model-a',
      contextWindow: 64000,
      hasApiKey: true,
    },
    {
      id: 'q',
      name: '服务B',
      protocol: 'anthropic',
      endpoint: 'https://other.invalid/v1',
      model: 'model-b',
      contextWindow: 64000,
      hasApiKey: false,
    },
  ],
  clis: [],
  defaultBackend: { kind: 'official', model: '' },
}
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
async function choose(id: string, label: string) {
  await act(async () => document.getElementById(id)!.click())
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role=option]')]
      .find((e) => e.textContent === label)!
      .click(),
  )
}
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  useAiStore.setState(useAiStore.getInitialState(), true)
  api.ai.settings.mockResolvedValue(structuredClone(settings))
  api.ai.setDefault.mockImplementation(async (backend: AiBackend) => ({
    ...useAiStore.getState().settings!,
    defaultBackend: backend,
  }))
  api.ai.setEnabled.mockImplementation(async ({ enabled }: { enabled: boolean }) => ({
    ...useAiStore.getState().settings!,
    enabled,
  }))
  api.ai.discover.mockResolvedValue({
    models: [{ id: 'model-a', name: 'model-a' }],
    defaultModel: 'model-a',
    message: '',
  })
  api.ai.test.mockResolvedValue({ message: '测试通过' })
  api.ai.configure.mockResolvedValue(settings)
  api.ai.configureCli.mockResolvedValue(settings)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<AiPanel />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
it('shows only the selected configuration and saves the selected backend in settings', async () => {
  expect(host.querySelector('[aria-label="官方AI配置"]')).not.toBeNull()
  expect(host.querySelector('#ai-key')).toBeNull()
  expect(host.querySelector('[aria-label="外部Agent配置"]')).toBeNull()
  await choose('ai-engine', 'Claude Code')
  expect(api.ai.setDefault).toHaveBeenLastCalledWith({ kind: 'claude', model: '' })
  expect(host.querySelector('[aria-label="官方AI配置"]')).toBeNull()
  expect(host.querySelectorAll('#ai-cli-path')).toHaveLength(1)
  expect(host.querySelectorAll('#ai-cli-model')).toHaveLength(1)
  expect(host.querySelector('#ai-key')).toBeNull()
  await act(async () => button('保存配置').click())
  expect(api.ai.configureCli).toHaveBeenCalledWith({ kind: 'claude', path: '', model: '' })
})
it('switches providers with a dropdown and keeps discovery/test separate from saving keys', async () => {
  await choose('ai-source', '服务A')
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
  expect(host.querySelector<HTMLInputElement>('#ai-endpoint')!.value).toBe('https://provider.invalid/v1')
  await act(async () => button('自动发现模型').click())
  await act(async () => button('测试连接').click())
  expect(api.ai.discover).toHaveBeenCalledOnce()
  expect(api.ai.test).toHaveBeenCalledOnce()
  expect(api.ai.configure).not.toHaveBeenCalled()
  await act(async () => button('保存并使用').click())
  expect(api.ai.configure).toHaveBeenCalledWith(expect.objectContaining({ id: 'p', protocol: 'responses' }))
  await choose('ai-source', '服务B')
  expect(host.querySelector<HTMLInputElement>('#ai-endpoint')!.value).toBe('https://other.invalid/v1')
  expect(host.querySelectorAll('#ai-key')).toHaveLength(1)
})
it('persists disable and hides all engine and credential controls without deleting configuration', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('#ai-enabled')!.click())
  expect(api.ai.setEnabled).toHaveBeenCalledWith({ enabled: false })
  expect(host.querySelector('#ai-engine')).toBeNull()
  expect(host.querySelector('#ai-key')).toBeNull()
  expect(useAiStore.getState().settings?.providers).toHaveLength(2)
  expect(api.ai.removeProvider).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('#ai-enabled')!.click())
  expect(host.querySelector('#ai-engine')).not.toBeNull()
})
