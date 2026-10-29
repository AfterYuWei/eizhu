// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CompletionPanel } from './CompletionPanel'
import type { CompletionPopupState } from '@/hooks/useCompletion'

it('多列显示短路径、来源、历史次数，鼠标选中与延迟展开可取消', async () => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'),
    root = createRoot(host)
  const onHover = vi.fn(),
    onClick = vi.fn(),
    onExpand = vi.fn()
  const popup: CompletionPopupState = {
    open: true,
    cascade: true,
    sourceParser: 'directory-list',
    activeColumn: 1,
    columns: [
      {
        selectedIndex: 0,
        suggestions: [
          { name: '/srv/项目/', displayName: '项目/', isDir: true, type: 'directory' },
          { name: '/srv/file', displayName: 'file', isDir: false, type: 'directory' },
        ],
      },
      {
        selectedIndex: 0,
        suggestions: [
          { name: 'cd /srv/项目', fullCommand: 'cd /srv/项目', count: 4, type: 'history' },
          { name: '--help', type: 'option', origin: 'static' },
          { name: 'app.service', type: 'arg', origin: 'dynamic' },
        ],
      },
    ],
  }
  const render = async () => {
    await act(async () =>
      root.render(
        <CompletionPanel
          popup={popup}
          getTerminal={() => null}
          containerRef={createRef()}
          onHoverItem={onHover}
          onClickItem={onClick}
          onExpandDir={onExpand}
        />,
      ),
    )
  }
  try {
    await render()
    expect(host.textContent).toContain('项目/')
    expect(host.textContent).toContain('×4')
    expect(host.textContent).toContain('静态')
    expect(host.textContent).toContain('动态')
    expect(host.querySelectorAll('[data-selected="true"]')).toHaveLength(2)
    const rows = host.querySelectorAll('[data-selected]')
    await act(async () => rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(onHover).toHaveBeenLastCalledWith(0, 0)
    await act(async () => vi.advanceTimersByTime(199))
    expect(onExpand).not.toHaveBeenCalled()
    await act(async () => rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await act(async () => vi.advanceTimersByTime(200))
    expect(onExpand).not.toHaveBeenCalled()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    await act(async () => rows[4].dispatchEvent(down))
    expect(down.defaultPrevented).toBe(true)
    expect(onClick).toHaveBeenLastCalledWith(1, 2)
    await act(async () => rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await act(async () => vi.advanceTimersByTime(200))
    expect(onExpand).toHaveBeenCalledTimes(1)
    popup.open = false
    await render()
    expect(host.childElementCount).toBe(0)
  } finally {
    await act(async () => root.unmount())
    vi.useRealTimers()
  }
})
