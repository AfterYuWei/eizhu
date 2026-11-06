// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSftpStore, type PendingDirectoryDrop, type SftpStoreApi } from '@/store/sftp'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DirectoryTransferDialog } from './DirectoryTransferDialog'
import { SftpStoreContext } from './storeContext'

let host: HTMLDivElement, root: Root, store: SftpStoreApi
const pending: PendingDirectoryDrop = {
  drag: {
    sourcePane: 'left',
    sourceTabId: 'source',
    sourceSessionId: 'source',
    entries: [
      { name: 'nacos', path: '/Data/nacos', is_dir: true, size: 0, mod_time: '' },
      { name: 'config.yml', path: '/Data/config.yml', is_dir: false, size: 20, mod_time: '' },
    ],
  },
  target: {
    pane: 'right',
    tabId: 'target',
    sessionId: 'target',
    kind: 'folder',
    serverName: '目标服务器',
    destDir: '/Data/Docker',
  },
}
const resolve = vi.fn(async () => {
  store.setState({ pendingDirectoryDrop: null })
})
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((element) => element.textContent === label)!
const checkbox = () => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  resolve.mockClear()
  store = createSftpStore({ includeLocalTab: false })
  store.setState({ pendingDirectoryDrop: pending, resolveDirectoryDrop: resolve })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <TooltipProvider>
        <SftpStoreContext.Provider value={store}>
          <DirectoryTransferDialog />
        </SftpStoreContext.Provider>
      </TooltipProvider>,
    ),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('确认后才开始传输，默认保留目录结构并说明混合选择的数量和目标', async () => {
  expect(document.querySelector('[data-slot="dialog-description"]')?.textContent).toContain(
    '1 个文件夹和 1 个文件',
  )
  expect(document.querySelector('.sftp-dir-mode-path')?.textContent).toBe('/Data/Docker')
  expect(checkbox().getAttribute('data-state')).toBe('unchecked')
  expect(resolve).not.toHaveBeenCalled()
  await act(async () => button('开始传输').click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith('preserve')
})

it('勾选压缩仅修改选项，明确告知目标不解压，并在确认后使用归档模式', async () => {
  await act(async () => checkbox().click())
  expect(resolve).not.toHaveBeenCalled()
  expect(document.querySelector('[data-slot="dialog-description"]')?.textContent).toContain('以压缩包传输')
  expect(document.querySelector('.sftp-dir-mode-option-description')?.textContent).toContain(
    '目标端不会自动解压。普通文件仍按原样传输。',
  )
  await act(async () => button('开始传输').click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith('archive')
})

it('取消不启动传输，再次打开时恢复默认目录模式', async () => {
  await act(async () => checkbox().click())
  await act(async () => button('取消').click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith(null)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => store.setState({ pendingDirectoryDrop: pending }))
  expect(checkbox().getAttribute('data-state')).toBe('unchecked')
  await act(async () => button('开始传输').click())
  expect(resolve).toHaveBeenLastCalledWith('preserve')
})

it('取消压缩选择后仍按原目录结构传输', async () => {
  await act(async () => checkbox().click())
  await act(async () => checkbox().click())
  await act(async () => button('开始传输').click())
  expect(resolve).toHaveBeenCalledExactlyOnceWith('preserve')
})
