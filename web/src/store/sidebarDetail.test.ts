import { beforeEach, describe, expect, it } from 'vitest'

import { GLOBAL_PAGE_KEY, useSidebarDetailStore } from './sidebarDetail'

beforeEach(() => {
  useSidebarDetailStore.setState({
    pageByTab: { [GLOBAL_PAGE_KEY]: 0 },
    detailCache: {},
    lastTerminalTabId: null,
  })
})

describe('sidebar detail panels', () => {
  it('默认折叠辅助信息，为文件管理保留空间', () => {
    expect(useSidebarDetailStore.getState().getDetail('tab-1')).toMatchObject({
      filesCollapsed: false,
      metricsCollapsed: true,
      infoCollapsed: true,
    })
  })

  it('系统指标与服务器信息保持单面板展开', () => {
    const store = useSidebarDetailStore.getState()

    store.toggleMetrics('tab-1')
    expect(useSidebarDetailStore.getState().getDetail('tab-1')).toMatchObject({
      metricsCollapsed: false,
      infoCollapsed: true,
    })

    store.toggleInfo('tab-1')
    expect(useSidebarDetailStore.getState().getDetail('tab-1')).toMatchObject({
      metricsCollapsed: true,
      infoCollapsed: false,
    })
  })
})
