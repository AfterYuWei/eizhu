// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SettingsDialog } from './index'

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
      <SettingsDialog open onOpenChange={() => undefined} initialTab={initialTab} />
    </StrictMode>,
  ))

  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => selectTab('账号'))
    const panel = document.querySelector('[role="tabpanel"][data-state="active"]')!
    expect(panel.textContent).toContain('正在开发中')
    expect(panel.querySelector('input')).toBeNull()
    expect(document.querySelector('main')?.textContent).toBe('工作区')

    await act(async () => selectTab('外观'))
    expect(document.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain('外观设置')
  }
})
