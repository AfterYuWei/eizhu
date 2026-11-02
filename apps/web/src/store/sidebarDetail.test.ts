import { beforeEach, describe, expect, it } from 'vitest'

import { useSidebarDetailStore } from './sidebarDetail'

beforeEach(() => {
  useSidebarDetailStore.setState({
    detailCache: {},
  })
})

describe('sidebar file browser', () => {
  it('默认跟随终端目录', () => {
    expect(useSidebarDetailStore.getState().getDetail('tab-1')).toMatchObject({
      followShellCwd: true,
    })
  })
})
