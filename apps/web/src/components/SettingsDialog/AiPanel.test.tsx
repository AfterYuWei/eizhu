// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { AiBackend, AiConnection, AiSettings } from '@eizhu/contracts'
import { ai } from '@eizhu/contracts'
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
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
const status = () => host.querySelector('[role=status]')!.textContent
async function click(id: string) {
  await act(async () => document.getElementById(id)!.click())
}
async function choose(id: string, label: string) {
  await click(id)
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
async function manage(open = true) {
  if (Boolean(document.querySelector('.ai-model-manager')) !== open) await click('ai-model-manage')
}
async function addManual(name: string) {
  await manage()
  await fill('ai-model-name', name)
  await click('ai-add-model')
  await manage(false)
}
async function discover() {
  await manage()
  await click('ai-discover-models')
}
async function addDiscovered(name: string) {
  await choose('ai-discovered-model', name)
  await click('ai-add-detected')
}
async function advanced() {
  await act(async () => host.querySelector<HTMLElement>('.ai-settings-advanced summary')!.click())
}
async function reopen() {
  await act(async () => root.render(null))
  await act(async () => root.render(<AiPanel />))
}
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  useAiStore.setState(useAiStore.getInitialState(), true)
  api.ai.settings.mockResolvedValue(structuredClone(settings))
  api.ai.setDefault.mockImplementation(async (backend: AiBackend) => {
    const next = { ...useAiStore.getState().settings!, defaultBackend: backend }
    api.ai.settings.mockResolvedValue(next)
    return next
  })
  api.ai.setEnabled.mockImplementation(async ({ enabled }: { enabled: boolean }) => {
    const next = { ...useAiStore.getState().settings!, enabled }
    api.ai.settings.mockResolvedValue(next)
    return next
  })
  api.ai.discover.mockImplementation(async (input: AiConnection) => {
    ai['ai.discover'].input.parse(input)
    return {
      models: [
        { id: 'model-a', name: 'model-a' },
        { id: 'model-c', name: 'model-c' },
      ],
      defaultModel: '',
      message: '',
    }
  })
  api.ai.test.mockImplementation(async (input: AiConnection) => {
    ai['ai.test'].input.parse(input)
    return { message: '测试通过' }
  })
  api.ai.configure.mockImplementation(async (raw: AiConnection) => {
    const input = ai['ai.configure'].input.parse(raw)
    const current = useAiStore.getState().settings!
    const old = current.providers.find((p) => p.id === input.id)
    const next = {
      ...current,
      providers: [
        ...current.providers.filter((p) => p.id !== input.id),
        {
          id: input.id,
          name: input.name,
          protocol: input.protocol,
          endpoint: input.endpoint,
          model: input.model,
          models: input.models,
          contextWindow: input.contextWindow,
          hasApiKey:
            !input.clearKey &&
            (Boolean(input.apiKey) || Boolean(old?.hasApiKey && old.endpoint === input.endpoint)),
        },
      ],
    }
    api.ai.settings.mockResolvedValue(next)
    return next
  })
  api.ai.configureCli.mockResolvedValue(settings)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<AiPanel />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it('shows only the chosen engine and saves it centrally', async () => {
  expect(host.querySelector('[aria-label="官方AI配置"]')).not.toBeNull()
  await choose('ai-engine', 'Claude Code')
  expect(api.ai.setDefault).toHaveBeenLastCalledWith({ kind: 'claude', model: '' })
  expect(host.querySelectorAll('#ai-cli-path')).toHaveLength(1)
  expect(host.querySelector('#ai-key')).toBeNull()
  await act(async () => button('保存配置').click())
  expect(api.ai.configureCli).toHaveBeenCalledWith({ kind: 'claude', path: '', model: '' })
})
it('restores old selected models as candidates and keeps saved keys private', async () => {
  await choose('ai-source', '服务A')
  expect(host.querySelector('#ai-model')!.textContent).toBe('model-a')
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
  await act(async () => button('测试连接').click())
  expect(api.ai.test).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a' }))
  expect(api.ai.test.mock.calls[0][0]).not.toHaveProperty('models')
  await choose('ai-source', '服务B')
  expect(host.querySelector('#ai-model')!.textContent).toBe('model-b')
})
it('disables AI without deleting configurations', async () => {
  await click('ai-enabled')
  expect(api.ai.setEnabled).toHaveBeenCalledWith({ enabled: false })
  expect(host.querySelector('#ai-engine')).toBeNull()
  expect(useAiStore.getState().settings?.providers).toHaveLength(2)
  expect(api.ai.removeProvider).not.toHaveBeenCalled()
})
it.each(aiProviderPresets)('prepares $name without saving or requesting a model', async (preset) => {
  await choose('ai-source', '新增供应商')
  await choose('ai-platform', preset.name)
  expect(host.querySelector<HTMLInputElement>('#ai-endpoint')!.value).toBe(preset.endpoint)
  expect(host.querySelector('#ai-protocol')!.textContent).toBe(
    { responses: 'Responses', chat: 'Chat Completions', anthropic: 'Anthropic Messages' }[preset.protocol],
  )
  expect(host.querySelector<HTMLDetailsElement>('.ai-settings-advanced')!.open).toBe(false)
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
  expect(host.querySelector<HTMLButtonElement>('#ai-model')!.disabled).toBe(true)
  expect(api.ai.configure).not.toHaveBeenCalled()
  expect(api.ai.discover).not.toHaveBeenCalled()
  expect(api.ai.setDefault).not.toHaveBeenCalled()
})
it('adds only selected discoveries to the candidate pool and retains it across model/provider switches', async () => {
  await choose('ai-source', '新增供应商')
  await fill('ai-endpoint', 'https://private.invalid/v1')
  await discover()
  expect(api.ai.discover).toHaveBeenCalledWith(expect.objectContaining({ model: '', protocol: 'responses' }))
  expect(host.querySelector<HTMLButtonElement>('#ai-model')!.disabled).toBe(true)
  expect(document.querySelectorAll('.ai-model-pool li')).toHaveLength(0)
  await addDiscovered('model-c')
  expect(document.querySelectorAll('.ai-model-pool li')).toHaveLength(1)
  expect(document.querySelector('.ai-model-pool')!.textContent).not.toContain('model-a')
  await manage(false)
  await choose('ai-model', 'model-c')
  await act(async () => button('保存并使用').click())
  expect(api.ai.configure).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'model-c', models: [{ id: 'model-c', name: 'model-c' }] }),
  )
  await choose('ai-source', '服务A')
  await choose('ai-source', '自定义模型')
  expect(host.querySelector('#ai-model')!.textContent).toBe('model-c')
  await reopen()
  expect(host.querySelector('#ai-model')!.textContent).toBe('model-c')
  expect(api.ai.discover).toHaveBeenCalledOnce()
})
it('adds manual names to the same array, deduplicates them, and persists deletions', async () => {
  await choose('ai-source', '服务A')
  await addManual(' private-model ')
  await manage()
  await fill('ai-model-name', 'private-model')
  await click('ai-add-model')
  expect(document.querySelectorAll('.ai-model-pool li')).toHaveLength(2)
  expect(document.querySelector('.ai-model-manager [role=status]')!.textContent).toContain('已在候选池')
  await manage(false)
  await choose('ai-model', 'private-model')
  await manage()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="删除模型 model-a"]')!.click())
  await manage(false)
  await act(async () => button('保存并使用').click())
  expect(api.ai.configure).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'private-model',
      models: [{ id: 'private-model', name: 'private-model' }],
    }),
  )
  await reopen()
  await manage()
  expect(document.querySelectorAll('.ai-model-pool li')).toHaveLength(1)
  expect(document.querySelector('[aria-label="删除模型 model-a"]')).toBeNull()
})
it('requires a new selection when the selected candidate is deleted', async () => {
  await choose('ai-source', '服务A')
  await addManual('replacement')
  await manage()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="删除模型 model-a"]')!.click())
  await manage(false)
  await act(async () => button('保存并使用').click())
  expect(status()).toContain('从候选池中选择')
  expect(api.ai.configure).not.toHaveBeenCalled()
  await choose('ai-model', 'replacement')
  await act(async () => button('保存并使用').click())
  expect(api.ai.setDefault).toHaveBeenLastCalledWith({
    kind: 'custom',
    providerId: 'p',
    model: 'replacement',
  })
})
it('preserves the candidate array through discovery and credential editing', async () => {
  await choose('ai-source', '服务A')
  await addManual('manual')
  await discover()
  expect(document.querySelectorAll('.ai-model-pool li')).toHaveLength(2)
  await manage(false)
  await fill('ai-key', 'draft-key')
  await fill('ai-endpoint', 'https://changed.invalid/v1')
  await manage()
  expect(document.querySelectorAll('.ai-model-pool li')).toHaveLength(2)
  expect(document.querySelector('#ai-discovered-model')).toBeNull()
  expect(api.ai.configure).not.toHaveBeenCalled()
})
it('validates empty models and addresses without dispatching invalid RPCs', async () => {
  await choose('ai-source', '新增供应商')
  await discover()
  expect(status()).toContain('有效的接口基础地址')
  expect(api.ai.discover).not.toHaveBeenCalled()
  await manage(false)
  await fill('ai-endpoint', 'https://private.invalid/v1')
  await fill('ai-key', 'draft-key')
  for (const action of ['测试连接', '保存并使用']) {
    await act(async () => button(action).click())
    expect(status()).toContain('候选模型')
    expect(document.activeElement?.id).toBe('ai-model-manage')
  }
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('draft-key')
  expect(api.ai.test).not.toHaveBeenCalled()
  expect(api.ai.configure).not.toHaveBeenCalled()
})
it('uses a single editable context combobox for preset selection and custom values', async () => {
  await choose('ai-source', '服务A')
  expect(host.querySelector('#ai-context')!.closest('details')).not.toBeNull()
  await advanced()
  expect(host.querySelector<HTMLInputElement>('#ai-context')!.value).toBe('64000')
  await click('ai-context')
  expect([...document.querySelectorAll('[role=option]')].map((e) => e.textContent)).toEqual([
    '256K',
    '512K',
    '1M',
    '2M',
  ])
  await act(async () => document.getElementById('ai-context-option-0')!.click())
  expect(host.querySelector<HTMLInputElement>('#ai-context')!.value).toBe('256000')
  expect(host.querySelectorAll('input[id^="ai-context"]')).toHaveLength(1)
  await fill('ai-context', '96000')
  await act(async () => button('保存并使用').click())
  expect(api.ai.configure).toHaveBeenLastCalledWith(expect.objectContaining({ contextWindow: 96000 }))
  await reopen()
  expect(host.querySelector<HTMLInputElement>('#ai-context')!.value).toBe('96000')
})
it('supports context keyboard selection and Escape while retaining editable custom text', async () => {
  await choose('ai-source', '新增供应商')
  await advanced()
  const input = host.querySelector<HTMLInputElement>('#ai-context')!
  expect(input.value).toBe('256000')
  await act(async () => input.focus())
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })),
  )
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
  )
  expect(input.value).toBe('512000')
  await fill('ai-context', '600000')
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
  )
  expect(input.value).toBe('600000')
  expect(document.querySelector('#ai-context-options')).toBeNull()
  expect(host.querySelector('.ai-settings')).not.toBeNull()
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })),
  )
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
  )
  expect(input.value).toBe('2000000')
})
it('opens advanced settings and focuses the same context input on invalid capacity', async () => {
  await choose('ai-source', '服务A')
  await advanced()
  await fill('ai-context', '2000001')
  await advanced()
  await act(async () => button('保存并使用').click())
  expect(host.querySelector<HTMLDetailsElement>('.ai-settings-advanced')!.open).toBe(true)
  expect(document.activeElement?.id).toBe('ai-context')
  expect(status()).toContain('上下文窗口')
  expect(api.ai.configure).not.toHaveBeenCalled()
})
it('keeps the advanced protocol override and creates a fresh provider when a preset changes', async () => {
  await choose('ai-source', '服务A')
  await fill('ai-key', 'draft-key')
  await choose('ai-platform', 'OpenAI')
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
  await addManual('chosen')
  await choose('ai-model', 'chosen')
  await advanced()
  await choose('ai-protocol', 'Chat Completions')
  expect(host.querySelector('#ai-platform')!.textContent).toBe('OpenAI')
  expect(host.querySelector('#ai-model')!.textContent).toBe('chosen')
  await act(async () => button('保存并使用').click())
  expect(api.ai.configure.mock.calls[0][0].id).not.toBe('p')
  expect(api.ai.configure.mock.calls[0][0].protocol).toBe('chat')
})
it('returns to official configuration after deleting the selected provider', async () => {
  await choose('ai-source', '服务A')
  api.ai.removeProvider.mockResolvedValue({ ...settings, providers: [settings.providers[1]] })
  await act(async () => button('删除供应商').click())
  expect(api.ai.setDefault).toHaveBeenLastCalledWith({ kind: 'official', model: '' })
  expect(host.querySelector('[aria-label="官方AI配置"]')).not.toBeNull()
})
