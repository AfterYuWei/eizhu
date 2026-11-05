// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { AiPanel } from './AiPanel'
const api = vi.hoisted(() => ({
  ai: {
    settings: vi.fn(),
    configure: vi.fn(),
    discover: vi.fn(),
    test: vi.fn(),
    configureCli: vi.fn(),
    cliStatus: vi.fn(),
  },
}))
vi.mock('@/lib/bridge', () => ({ bridge: () => api }))
let host: HTMLDivElement, root: Root
const settings = {
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
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  api.ai.settings.mockResolvedValue(settings)
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
it('keeps multiple providers and separates discovery/test from saving credentials', async () => {
  expect(host.textContent).toContain('服务A')
  expect(host.textContent).toContain('服务B')
  await act(async () => button('服务A').click())
  expect(host.querySelector<HTMLInputElement>('#ai-key')!.value).toBe('')
  await act(async () => button('自动发现模型').click())
  await act(async () => button('测试连接').click())
  expect(api.ai.discover).toHaveBeenCalledOnce()
  expect(api.ai.test).toHaveBeenCalledOnce()
  expect(api.ai.configure).not.toHaveBeenCalled()
  await act(async () => button('保存供应商').click())
  expect(api.ai.configure).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'p', protocol: 'responses', endpoint: 'https://provider.invalid/v1' }),
  )
})
it('configures each CLI separately without starting a run or installing binaries', async () => {
  expect(host.querySelectorAll('.ai-cli-config')).toHaveLength(3)
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.ai-cli-config button')]
  await act(async () => buttons[2].click())
  expect(api.ai.configureCli).toHaveBeenCalledWith({ kind: 'deepseek', path: '', model: '' })
})
