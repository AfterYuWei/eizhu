// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { createSftpStore } from '@/store/sftp'
import { ConflictDialog } from './ConflictDialog'
import { SftpStoreContext } from './storeContext'
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.() })

it('归档输出按文件检查冲突，普通目录合并不承诺删除原目录', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const store = createSftpStore({ includeLocalTab: false })
  const conflicts = [{ source_path: '/project', dest_path: '/dest/project.tar.gz', source_size: 0, dest_size: 10, source_is_dir: true, dest_is_dir: false }]
  store.setState({ pendingConflict: { taskId: 'archive', operation: 'transfer', directoryMode: 'archive', conflicts } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  await act(async () => root.render(<SftpStoreContext.Provider value={store}><ConflictDialog /></SftpStoreContext.Provider>))
  const overwrite = () => [...document.querySelectorAll('button')].find((button) => button.textContent === '覆盖同名文件')!
  expect(overwrite().disabled).toBe(false)
  expect(document.body.textContent).not.toContain('递归删除')
  await act(async () => store.setState({ pendingConflict: { taskId: 'directory', operation: 'transfer', directoryMode: 'preserve', conflicts } }))
  expect(overwrite().disabled).toBe(true)
})
