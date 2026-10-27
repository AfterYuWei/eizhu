// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsPage } from './index'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

function selectTab(label: string) {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((element) => element.textContent === label)!
  tab.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
}

it.each(['appearance', 'account'] as const)('账号设置从 %s 入口打开后保持工作区和分类切换可用', async (initialTab) => {
  await act(async () => root.render(
    <StrictMode>
      <main>工作区</main>
      <SettingsPage onBack={() => undefined} initialTab={initialTab} />
    </StrictMode>,
  ))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.querySelector('.settings-page-profile')?.textContent).toContain('本地用户')
  expect(document.activeElement?.getAttribute('role')).toBe('tab')

  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => selectTab('账号'))
    const panel = document.querySelector('[role="tabpanel"][data-state="active"]')!
    expect(panel.textContent).toContain('登录账号')
    expect(panel.querySelector('input[type="email"]')).not.toBeNull()
    expect(document.querySelector('main')?.textContent).toBe('工作区')

    await act(async () => selectTab('外观'))
    expect(document.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain('外观设置')
  }
})

it('整页设置通过返回应用或 Esc 退出', async () => {
  const onBack = vi.fn()
  await act(async () => root.render(<SettingsPage onBack={onBack} />))
  const back = host.querySelector<HTMLButtonElement>('.settings-page-back')!
  expect(back.textContent).toContain('返回应用')
  await act(async () => back.click())
  expect(onBack).toHaveBeenCalledTimes(1)
  await act(async () => back.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(onBack).toHaveBeenCalledTimes(2)
})
