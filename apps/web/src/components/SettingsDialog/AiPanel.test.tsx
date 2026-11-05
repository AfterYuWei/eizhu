// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { AiBackend, AiConnection, AiSettings } from '@eizhu/contracts'
import { ai, aiConnectionSchema } from '@eizhu/contracts'
import { useAiStore } from '@/store/ai'
import { AiPanel } from './AiPanel'
import { aiProviderPresets } from './aiProviderPresets'
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
async function fill(id: string, value: string) {
  await act(async () => {
    const input = document.getElementById(id)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
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
  api.ai.discover.mockImplementation(async (input: AiConnection) => {
    ai['ai.discover'].input.parse(input)
    return {
      models: [{ id: 'model-a', name: 'model-a' }],
      defaultModel: 'model-a',
      message: '',
    }
  })
  api.ai.test.mockImplementation(async (input: AiConnection) => {
    ai['ai.test'].input.parse(input)
    return { message: '测试通过' }
  })
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
it.each(aiProviderPresets)(
  'prepares the $name preset without saving or contacting a provider',
  async (preset) => {
    await choose('ai-source', '新增供应商')
    await choose('ai-platform', preset.name)
    expect(host.querySelector<HTMLInputElement>('#ai-name')!.value).toBe(preset.name)
    expect(host.querySelector<HTMLInputElement>('#ai-endpoint')!.value).toBe(preset.endpoint)
    expect(host.querySelector<HTMLDetailsElement>('.ai-settings-advanced')!.open).toBe(false)
    expect(host.querySelector('#ai-protocol')!.textContent).toBe(
      { responses: 'Responses', chat: 'Chat Completions', anthropic: 'Anthropic Messages' }[preset.protocol],
    )
    expect(host.querySelector<HTMLInputElement>('#ai-model')!.value).toBe('')
    expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
    expect(api.ai.configure).not.toHaveBeenCalled()
    expect(api.ai.setDefault).not.toHaveBeenCalled()
    expect(api.ai.discover).not.toHaveBeenCalled()
    expect(api.ai.test).not.toHaveBeenCalled()
  },
)
it('starts a new draft on platform changes and preserves saved providers and their credentials', async () => {
  await choose('ai-source', '服务A')
  await fill('ai-key', 'draft-key')
  await act(async () => button('自动发现模型').click())
  expect(host.querySelector('#ai-model')!.getAttribute('role')).toBe('combobox')
  await choose('ai-platform', 'DeepSeek')
  expect(host.querySelector('#ai-source')!.textContent).toBe('新增供应商')
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
  expect(host.querySelector<HTMLInputElement>('#ai-model')!.value).toBe('')
  expect(host.querySelector('#ai-clear-key')).toBeNull()
  expect(button('删除供应商')).toBeUndefined()
  expect(api.ai.setDefault).toHaveBeenCalledOnce()
  expect(api.ai.discover).toHaveBeenCalledOnce()
  expect(api.ai.test).not.toHaveBeenCalled()
  expect(api.ai.configure).not.toHaveBeenCalled()
  expect(useAiStore.getState().settings!.providers).toEqual(settings.providers)
  await fill('ai-model', 'my-deepseek-model')
  api.ai.configure.mockImplementation(async (draft: AiConnection) => ({
    ...settings,
    providers: [...settings.providers, { ...draft, hasApiKey: false }],
  }))
  await act(async () => button('保存并使用').click())
  const saved = aiConnectionSchema.parse(api.ai.configure.mock.calls[0][0])
  expect(saved).toMatchObject({ name: 'DeepSeek', protocol: 'chat', model: 'my-deepseek-model' })
  expect(saved.id).not.toBe('p')
  expect(saved.id).not.toBe('deepseek')
  expect(saved.apiKey).toBeUndefined()
  expect(useAiStore.getState().settings!.providers.slice(0, 2)).toEqual(settings.providers)
  await choose('ai-source', '服务A')
  expect(host.querySelector<HTMLInputElement>('#ai-model')!.value).toBe('model-a')
  expect(host.querySelector('#ai-clear-key')).not.toBeNull()
})
it('keeps custom addresses editable and clears the previous platform draft', async () => {
  await choose('ai-source', '新增供应商')
  await choose('ai-platform', 'OpenAI')
  await fill('ai-key', 'draft-key')
  await fill('ai-model', 'old-model')
  await choose('ai-platform', '自定义')
  expect(host.querySelector<HTMLInputElement>('#ai-endpoint')!.value).toBe('')
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
  expect(host.querySelector<HTMLInputElement>('#ai-model')!.value).toBe('')
  await fill('ai-endpoint', 'https://private.invalid/v1')
  await act(async () => host.querySelector<HTMLElement>('.ai-settings-advanced summary')!.click())
  await choose('ai-protocol', 'Anthropic Messages')
  expect(host.querySelector<HTMLInputElement>('#ai-endpoint')!.value).toBe('https://private.invalid/v1')
  expect(host.querySelector('#ai-platform')!.textContent).toBe('自定义')
})
it('uses Responses for a new custom service without asking for a protocol', async () => {
  await choose('ai-source', '新增供应商')
  await fill('ai-endpoint', 'https://private.invalid/v1')
  await act(async () => button('自动发现模型').click())
  expect(host.querySelector<HTMLDetailsElement>('.ai-settings-advanced')!.open).toBe(false)
  expect(api.ai.discover).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'responses', model: '' }))
  expect(host.querySelector('#ai-model')!.getAttribute('role')).toBe('combobox')
  expect(host.querySelector('[role=status]')!.textContent).toContain('请选择模型')
  await choose('ai-model', 'model-a')
  await act(async () => button('测试连接').click())
  expect(api.ai.test).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a' }))
})
it('explains an empty or whitespace model and focuses it before testing or saving', async () => {
  await choose('ai-source', '新增供应商')
  await choose('ai-platform', 'DeepSeek')
  await fill('ai-key', 'draft-key')
  for (const model of ['', '   ']) {
    await fill('ai-model', model)
    for (const action of ['测试连接', '保存并使用']) {
      await act(async () => button(action).click())
      expect(host.querySelector('[role=status]')!.textContent).toContain('请先填写模型')
      expect(document.activeElement?.id).toBe('ai-model')
      expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('draft-key')
    }
  }
  expect(api.ai.test).not.toHaveBeenCalled()
  expect(api.ai.configure).not.toHaveBeenCalled()
  expect(api.ai.setDefault).not.toHaveBeenCalled()
})
it('validates the endpoint before discovery and explains an empty model directory', async () => {
  await choose('ai-source', '新增供应商')
  await act(async () => button('自动发现模型').click())
  expect(host.querySelector('[role=status]')!.textContent).toContain('有效的接口基础地址')
  expect(document.activeElement?.id).toBe('ai-endpoint')
  expect(api.ai.discover).not.toHaveBeenCalled()
  await fill('ai-endpoint', 'https://private.invalid/v1')
  api.ai.discover.mockResolvedValue({ models: [], defaultModel: '', message: '' })
  await act(async () => button('自动发现模型').click())
  expect(host.querySelector('[role=status]')!.textContent).toContain('请手动填写模型名称')
  expect(host.querySelector<HTMLInputElement>('#ai-model')!.value).toBe('')
})
it('allows an advanced override without changing the selected platform and collapses for a new provider', async () => {
  await choose('ai-source', '新增供应商')
  await choose('ai-platform', 'OpenAI')
  await fill('ai-key', 'draft-key')
  await fill('ai-model', 'custom-model')
  await act(async () => host.querySelector<HTMLElement>('.ai-settings-advanced summary')!.click())
  expect(host.querySelector<HTMLDetailsElement>('.ai-settings-advanced')!.open).toBe(true)
  await choose('ai-protocol', 'Chat Completions')
  expect(host.querySelector('#ai-platform')!.textContent).toBe('OpenAI')
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('draft-key')
  expect(host.querySelector<HTMLInputElement>('#ai-model')!.value).toBe('custom-model')
  await act(async () => button('测试连接').click())
  expect(api.ai.test).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'chat' }))
  await choose('ai-platform', 'Anthropic（Claude）')
  expect(host.querySelector<HTMLDetailsElement>('.ai-settings-advanced')!.open).toBe(false)
  expect(host.querySelector('#ai-protocol')!.textContent).toBe('Anthropic Messages')
})
it('uses the official backend after deleting a provider instead of reselecting its stale id', async () => {
  await choose('ai-source', '服务A')
  api.ai.removeProvider.mockResolvedValue({ ...settings, providers: [settings.providers[1]] })
  await act(async () => button('删除供应商').click())
  expect(api.ai.removeProvider).toHaveBeenCalledWith({ providerId: 'p' })
  expect(api.ai.setDefault).toHaveBeenLastCalledWith({ kind: 'official', model: '' })
  expect(host.querySelector('[aria-label="官方AI配置"]')).not.toBeNull()
  expect(useAiStore.getState().settings!.providers).toHaveLength(1)
})
