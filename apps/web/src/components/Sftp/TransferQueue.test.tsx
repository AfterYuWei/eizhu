// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSftpStore, type SftpStoreApi } from '@/store/sftp'
import type { TransferTask } from '@/types/sftp'
import { SftpStoreContext } from './storeContext'
import { TransferQueue } from './TransferQueue'

const task: TransferTask = {
  id: 'task',
  file_name: 'config.yml',
  direction: 'upload',
  status: 'failed',
  size: 100,
  transferred: 40,
  speed: 0,
  started_at: 1,
  target_profile: 'server',
  execution_generation: 1,
  error_code: 'PERMISSION_DENIED',
  error_message: '目标目录不可写',
}
let host: HTMLDivElement, root: Root, store: SftpStoreApi
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
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
  store = createSftpStore({ includeLocalTab: false })
  store.setState({ transfers: [task] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <SftpStoreContext.Provider value={store}>
        <TransferQueue />
      </SftpStoreContext.Provider>,
    ),
  )
  await act(async () => button('展开传输队列').click())
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('opens failure details from the task status without inserting an extra error row', async () => {
  expect(host.querySelector('.sftp-tx-error')).toBeNull()
  const trigger = host.querySelector<HTMLButtonElement>('.sftp-tx-error-trigger')!
  expect(trigger.textContent).toContain('传输失败')
  await act(async () => trigger.click())
  expect(document.querySelector('[data-slot="popover-content"] [role="alert"]')?.textContent).toBe(
    '目标目录不可写',
  )
  expect(document.querySelector('[data-slot="popover-content"]')?.textContent).toContain('PERMISSION_DENIED')
})

it('keeps failed queue actions beside the action and allows another attempt', async () => {
  const clear = vi.fn().mockRejectedValueOnce(new Error('清除记录失败')).mockResolvedValueOnce(undefined)
  await act(async () =>
    store.setState({
      transfers: [{ ...task, status: 'completed', error_message: undefined }],
      clearCompleted: clear,
    }),
  )
  await act(async () => button('清除记录').click())
  expect(host.querySelector('.sftp-tx-hdr-right [role="alert"]')?.textContent).toBe('清除记录失败')
  await act(async () => button('清除记录').click())
  expect(clear).toHaveBeenCalledTimes(2)
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
