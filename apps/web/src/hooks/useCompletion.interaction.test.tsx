// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompletion } from './useCompletion'
import type { CompletionData } from '@/types/completion'
import { queryHistory } from '@/lib/commandHistory'

vi.mock('@/lib/commandHistory', () => ({
  recordCommand: vi.fn().mockResolvedValue(undefined),
  queryHistory: vi.fn(() => []),
  reliableHistoryCommand: () => null,
}))
const roots: Root[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(queryHistory).mockReturnValue([])
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.useRealTimers()
})

async function mount() {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  const sendInput = vi.fn(),
    sendComplete = vi.fn()
  const options = { enabled: true, profileId: 'p', tabId: 't', connectionKey: 'one', cwd: '/srv' }
  let completion!: ReturnType<typeof useCompletion>
  function Test() {
    completion = useCompletion({
      getTerminal: () => null,
      getCwd: () => options.cwd,
      sendInput,
      sendComplete,
      ...options,
    })
    return null
  }
  const render = async () => {
    await act(async () => root.render(<Test />))
  }
  await render()
  const data = async (input: string, delay = 120) => {
    let consumed = false
    await act(async () => {
      consumed = completion.handleData(input)
      vi.advanceTimersByTime(delay)
    })
    return consumed
  }
  const respond = async (
    payload: CompletionData,
    id = sendComplete.mock.calls.at(-1)![0],
    error = '',
    code = 0,
  ) => {
    await act(async () =>
      completion.handleCompleteResponse({ request_id: id, ...payload, error, exit_code: code }),
    )
  }
  const choose = async (name: string, column = 0) => {
    const index = completion.popup.columns[column].suggestions.findIndex((s) => s.name === name)
    expect(index).toBeGreaterThanOrEqual(0)
    await act(async () => completion.hoverSelect(column, index))
  }
  return { value: () => completion, sendInput, sendComplete, options, render, data, respond, choose }
}

describe('全部生成器的输入、异步响应和 Enter 应用', () => {
  const cases = [
    ['git checkout fe', 'git-branches', 'feature/qa\nmain', 'feature/qa', 'ature/qa'],
    ['git remote remove or', 'git-remotes', 'origin\nupstream', 'origin', 'igin'],
    ['docker logs we', 'docker-containers', 'abc\tweb\ndef\tworker', 'web', 'b'],
    ['kubectl get pods we', 'kubectl-resources', 'pod/web\npod/worker', 'web', 'b'],
    ['kubectl config use-context pr', 'kubectl-contexts', 'prod\ndev', 'prod', 'od'],
    [
      'systemctl start ap',
      'systemd-service-units',
      'app.service\nworker.service',
      'app.service',
      'p.service',
    ],
    ['systemctl status ap', 'systemd-active-units', 'app.service', 'app.service', 'p.service'],
    ['systemctl is-failed ap', 'systemd-failed-units', 'app.service', 'app.service', 'p.service'],
    ['npm run de', 'npm-scripts', 'dev\nbuild', 'dev', 'v'],
  ]
  for (const [input, generatorId, output, selection, suffix] of cases)
    it(input, async () => {
      const h = await mount()
      await h.data(input)
      expect(h.sendComplete.mock.calls.at(-1)![1].generatorId).toBe(generatorId)
      await h.respond({ output })
      await h.choose(selection)
      expect(await h.data('\r')).toBe(true)
      expect(h.sendInput).toHaveBeenCalledExactlyOnceWith(suffix)
    })
  it('普通文件及 cd 目录插入后继续查询子目录', async () => {
    const h = await mount()
    await h.data('cat ./My')
    await h.respond({ output: '', candidates: [{ name: 'My File@*', is_dir: false }] })
    await h.choose('./My File@*')
    await h.data('\r')
    expect(h.sendInput).toHaveBeenLastCalledWith('\\ File\\@\\*')
    await h.data('\x03')
    await h.data('cd Pr')
    await h.respond({
      output: '',
      candidates: [
        { name: 'Projects', is_dir: true },
        { name: 'Private.txt', is_dir: false },
      ],
    })
    expect(h.value().popup.columns[0].suggestions.map((s) => s.name)).toEqual(['Projects/'])
    await h.choose('Projects/')
    await h.data('\r')
    expect(h.sendInput).toHaveBeenLastCalledWith('ojects/')
    expect(h.sendComplete.mock.calls.at(-1)![1].params.directory).toBe('Projects/')
  })
})

describe('键盘、鼠标和异步竞态', () => {
  it('Esc 取消尚未触发的防抖，且迟到响应不能重开菜单', async () => {
    const h = await mount()
    await h.data('docker lo', 0)
    await h.data('\x1b')
    expect(h.value().popup.open).toBe(false)
    await h.data('gs ')
    const id = h.sendComplete.mock.calls.at(-1)![0]
    await h.data('\x1b')
    await h.respond({ output: 'abc\tweb' }, id)
    expect(h.value().popup.open).toBe(false)
  })
  it('关闭补全开关立即关闭菜单，保留远端键盘输入', async () => {
    const h = await mount()
    await h.data('npm ')
    h.options.enabled = false
    await h.render()
    expect(h.value().popup.open).toBe(false)
    expect(await h.data('\x1b[B')).toBe(false)
  })
  it('完整子命令仍追加分隔空格，未闭合引号内不追加', async () => {
    const h = await mount()
    await h.data('docker logs')
    await h.choose('logs')
    await h.data('\r')
    expect(h.sendInput).toHaveBeenLastCalledWith(' ')
    await h.data('\x03')
    await h.data('docker "lo')
    await h.choose('logs')
    await h.data('\r')
    expect(h.sendInput).toHaveBeenLastCalledWith('gs')
  })
  it('光标离开行尾后不以整行末尾 token 补全而破坏中间文本', async () => {
    const h = await mount()
    await h.data('docker lo')
    await h.data('\x1b[D')
    expect(h.value().popup.open).toBe(false)
    expect(await h.data('\r')).toBe(false)
    expect(h.sendInput).not.toHaveBeenCalled()
  })
  it('级联右键选首目录会消费按键；旧父目录响应不能接到新父目录下', async () => {
    const h = await mount()
    await h.data('cd ')
    await h.respond({
      output: '',
      candidates: [
        { name: 'A', is_dir: true },
        { name: 'B', is_dir: true },
      ],
    })
    expect(await h.data('\x1b[C')).toBe(true)
    expect(await h.data('\x1b[C')).toBe(true)
    const requestA = h.sendComplete.mock.calls.at(-1)![0]
    await h.choose('B/')
    await h.respond({ output: '', candidates: [{ name: 'old-child', is_dir: true }] }, requestA)
    expect(h.value().popup.columns).toHaveLength(1)
    await act(async () => {
      expect(h.value().expandDirectory()).toBe(true)
    })
    await h.respond({ output: '', candidates: [{ name: 'file.txt', is_dir: false }, { name: 'new-child', is_dir: true }] })
    expect(h.value().popup.columns[1].suggestions.map((s) => s.name)).toEqual(['B/new-child/'])
    expect(await h.data('\x1b[D')).toBe(true)
    expect(h.value().popup.columns).toHaveLength(1)
  })
  it('鼠标应用选项和上下键边界不发送原始 Enter', async () => {
    const h = await mount()
    await h.data('npm install --save-d')
    await act(async () => h.value().clickSelect(0, 0))
    await act(async () => vi.advanceTimersByTime(0))
    expect(h.sendInput).toHaveBeenLastCalledWith('ev ')
    await h.data('\x03')
    await h.data('npm ')
    expect(await h.data('\x1b[A')).toBe(true)
    const selected = h.value().popup.columns[0].selectedIndex
    expect(await h.data('\x1b[B')).toBe(true)
    expect(h.value().popup.columns[0].selectedIndex).toBe(selected)
  })
  it('超过 200 项的动态结果仍可通过新前缀找到后面的候选', async () => {
    const h = await mount()
    await h.data('npm run ')
    await h.respond({
      output: Array.from({ length: 250 }, (_, i) => `script-${String(i).padStart(3, '0')}`).join('\n'),
    })
    expect(h.value().popup.columns[0].suggestions).toHaveLength(200)
    await h.data('script-249')
    expect(h.value().popup.columns[0].suggestions.map((s) => s.name)).toEqual(['script-249'])
  })
  it('动态错误、过期响应不影响静态候选及 Tab 透传', async () => {
    const h = await mount()
    await h.data('docker logs ')
    await h.respond({ output: '' }, undefined, 'missing docker', 127)
    expect(h.value().popup.columns[0].suggestions.map((s) => s.name)).toContain('--tail')
    expect(await h.data('\t')).toBe(false)
    expect(h.sendInput).not.toHaveBeenCalled()
  })
  it('Ctrl+W、退格、Ctrl+U 和 Ctrl+C 更新输入缓冲', async () => {
    const h = await mount()
    await h.data('npm invalid')
    await h.data('\x17')
    expect(h.value().popup.columns[0].suggestions.map((s) => s.name)).toContain('install')
    await h.data('ruX')
    await h.data('\x7f')
    expect(h.value().popup.columns[0].suggestions.map((s) => s.name)).toContain('run')
    await h.data('\x15')
    expect(h.value().popup.open).toBe(false)
    await h.data('npm run ')
    const id = h.sendComplete.mock.calls.at(-1)![0]
    await h.data('\x03')
    await h.respond({ output: 'old' }, id)
    expect(h.value().popup.open).toBe(false)
  })
  it('重连与配置切换丢弃缓存、请求和当前输入', async () => {
    const h = await mount()
    await h.data('systemctl start ')
    const id = h.sendComplete.mock.calls.at(-1)![0]
    h.options.connectionKey = 'two'
    await h.render()
    await h.respond({ output: 'old.service' }, id)
    expect(h.value().popup.open).toBe(false)
    await h.data('npm ')
    h.options.profileId = 'new-profile'
    await h.render()
    expect(h.value().popup.open).toBe(false)
  })
  it('TUI 控制序列跨分块或同包进入后退出仍正确恢复补全', async () => {
    const h = await mount()
    await act(async () => {
      h.value().handleOutputData('\x1b[?10')
      h.value().handleOutputData('49h')
    })
    await h.data('npm ')
    expect(h.value().popup.open).toBe(false)
    await act(async () => h.value().handleOutputData('\x1b[?1049h\x1b[?1049l'))
    await h.data('npm ')
    expect(h.value().popup.open).toBe(true)
  })
  it('历史完整命令原样替换行，保留其已有引号与空格', async () => {
    vi.mocked(queryHistory).mockReturnValue([{ command: 'ls "/srv/My Folder"', count: 2 }])
    const h = await mount()
    await h.data('cd /srv/')
    await h.respond({ output: '', candidates: [{ name: 'dir', is_dir: true }] })
    await h.choose('ls "/srv/My Folder"')
    await h.data('\r')
    expect(h.sendInput).toHaveBeenLastCalledWith('\x15ls "/srv/My Folder"')
  })
  it('多行粘贴不产生跨命令候选；emoji 退格不会留下半个字符', async () => {
    const h = await mount()
    await h.data('npm run dev\r\ndocker lo')
    expect(h.value().popup.open).toBe(false)
    await h.data('\x03')
    await h.data('npm run ')
    await h.respond({ output: 'dev\nbuild' })
    await h.data('🧪')
    await h.data('\x7f')
    expect(
      h
        .value()
        .popup.columns[0].suggestions.filter((s) => s.origin === 'dynamic')
        .map((s) => s.name),
    ).toEqual(['build', 'dev'])
  })
})
