import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  FileText,
  Hand,
  History,
  Plus,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import type { AiConversation, AiSettings } from '@eizhu/contracts'
import { useAiStore } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { useDesktopShellStore } from '@/store/desktopShell'
import { bridge } from '@/lib/bridge'
import { AiIcon } from '@/lib/serverIcons'
import { terminalActions } from '@/lib/terminalActions'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ShellIconButton, ShellResizeHandle } from '@/components/Layout/ShellControls'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AiMessage } from './AiMessage'
import './ai.css'

type Attachment = { name: string; content: string }
export function AiInspector({
  open,
  overlay,
  onClose,
  onChoose,
}: {
  open: boolean
  overlay: boolean
  onClose: () => void
  onChoose: () => void
}) {
  const { tabs, activeTabId } = useSessionStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  const { inspectorWidth, setInspectorWidth, setSettingsPage } = useDesktopShellStore()
  const {
    tabs: conversationsByTab,
    conversations,
    put,
    progress,
    forget,
    open: openConversation,
  } = useAiStore()
  const conversation = tab ? conversations[conversationsByTab[tab.id]] : undefined
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { text: string; attachments: Attachment[] }>>({})
  const draft = drafts[tab?.id ?? ''] ?? { text: '', attachments: [] }
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const [history, setHistory] = useState<Array<Pick<AiConversation, 'id' | 'title' | 'updatedAt'>> | null>(
    null,
  )
  const messages = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const actionRevision = useRef(0)
  const connected = tab?.status === 'connected' && Boolean(tab.sessionId)
  const busy = conversation?.status === 'thinking' || conversation?.status === 'executing'
  const updateDraft = (value: Partial<typeof draft>) => {
    if (tab) setDrafts((s) => ({ ...s, [tab.id]: { ...draft, ...value } }))
  }
  const act = useCallback(async (action: () => Promise<unknown>) => {
    const generation = workspaceGeneration(),
      revision = ++actionRevision.current
    setLoading(true)
    setError('')
    try {
      await action()
    } catch (e) {
      if (generation === workspaceGeneration() && revision === actionRevision.current)
        setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      if (generation === workspaceGeneration() && revision === actionRevision.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (!window.eizhu) return
    return bridge().events.on('eizhu-ai-message', (event) => {
      if (event.workspaceGeneration !== workspaceGeneration()) return
      if ('conversation' in event) put(event.conversation)
      else progress(event.conversationId, event.message)
    })
  }, [put, progress])
  useEffect(() => {
    if (!open) return
    if (!window.eizhu) {
      setError('请在 eizhu 桌面客户端中使用 AI 助手')
      return
    }
    let live = true
    void bridge()
      .ai.settings()
      .then(
        (v) => {
          if (live) setSettings(v)
        },
        (e) => {
          if (live) setError(e.message)
        },
      )
    return () => {
      live = false
    }
  }, [open])
  useEffect(() => {
    if (!open || !tab?.sessionId || tab.status !== 'connected') return
    void act(() => openConversation(tab.id, tab.sessionId!))
  }, [open, tab?.id, tab?.sessionId, tab?.status, act, openConversation])
  useEffect(() => {
    setHistory(null)
    setError('')
  }, [tab?.id])
  useLayoutEffect(() => {
    follow.current = true
  }, [conversation?.id, open])
  useLayoutEffect(() => {
    if (open && follow.current && messages.current) messages.current.scrollTop = messages.current.scrollHeight
  }, [open, conversation?.messages, conversation?.status])
  const attachFile = () =>
    act(async () => {
      const selected = await bridge().document.pick({
        multiple: false,
        mimeTypes: ['text/*', 'application/json', 'application/xml'],
      })
      for (const file of selected) {
        try {
          const content = await bridge().document.readText({ reference: file.reference, maxBytes: 65536 })
          updateDraft({ attachments: [...draft.attachments, { name: file.name, content }] })
        } finally {
          await bridge().document.release({ reference: file.reference })
        }
      }
    })
  const send = () =>
    act(async () => {
      if (!conversation || !tab || !draft.text.trim()) return
      await openConversation(tab.id, tab.sessionId!, conversation.id)
      await bridge().ai.send({
        conversationId: conversation.id,
        text: draft.text.trim(),
        attachments: draft.attachments,
      })
      updateDraft({ text: '', attachments: [] })
    })
  const showHistory = () =>
    act(async () => {
      if (tab) setHistory(await bridge().ai.history({ profileId: tab.profileId }))
    })
  return (
    <aside
      className={`shell-inspector ai-inspector ${overlay ? 'is-overlay' : ''}`}
      style={{ width: inspectorWidth }}
      hidden={!open}
      inert={!open}
      aria-label="AI 助手"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <ShellResizeHandle
        label="调整右侧栏宽度"
        value={inspectorWidth}
        min={320}
        max={560}
        onChange={setInspectorWidth}
        reverse
      />
      <div className="shell-inspector-heading">
        <Button
          variant="ghost"
          className="shell-inspector-switch"
          aria-label="切换侧栏内容"
          onClick={onChoose}
        >
          <AiIcon size={15} /> AI <ChevronDown size={13} />
        </Button>
        <div className="ai-inline-actions">
          <ShellIconButton
            label="新建 AI 对话"
            disabled={!connected || loading || busy}
            onClick={() => {
              setHistory(null)
              void act(() => openConversation(tab!.id, tab!.sessionId!, undefined, true))
            }}
          >
            <Plus size={15} />
          </ShellIconButton>
          <ShellIconButton
            label="AI 对话历史"
            disabled={!tab?.profileId || loading}
            onClick={() => void showHistory()}
          >
            <History size={15} />
          </ShellIconButton>
          <ShellIconButton label="AI 设置" onClick={() => setSettingsPage('ai')}>
            <Settings2 size={15} />
          </ShellIconButton>
          <ShellIconButton label="关闭右侧栏" onClick={onClose}>
            <X size={15} />
          </ShellIconButton>
        </div>
      </div>
      {(error || conversation?.error) && (
        <div className="ai-notice" role="alert">
          {error || conversation?.error}
          <Button size="sm" variant="link" onClick={() => setSettingsPage('ai')}>
            检查模型设置
          </Button>
        </div>
      )}
      {history ? (
        <div className="ai-history">
          <div className="ai-inline-actions">
            <Button size="sm" variant="ghost" onClick={() => setHistory(null)}>
              返回对话
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || busy}
              onClick={() =>
                void act(async () => {
                  if (!tab) return
                  await bridge().ai.remove({ profileId: tab.profileId })
                  setHistory([])
                  forget(tab.profileId)
                })
              }
            >
              清空本机历史
            </Button>
          </div>
          {history.length === 0 && <p className="ai-empty">暂无对话记录</p>}
          {history.map((h) => (
            <div className="ai-history-row" key={h.id}>
              <Button
                variant="ghost"
                disabled={loading || busy}
                onClick={() =>
                  void act(async () => {
                    if (!tab) return
                    const c = await bridge().ai.read({ profileId: tab.profileId, conversationId: h.id })
                    put(c)
                    useAiStore.setState((s) => ({ tabs: { ...s.tabs, [tab.id]: c.id } }))
                    setHistory(null)
                  })
                }
              >
                {h.title}
                <small>{new Date(h.updatedAt).toLocaleString()}</small>
              </Button>
              <ShellIconButton
                label={`删除对话：${h.title}`}
                disabled={loading || busy}
                onClick={() =>
                  void act(async () => {
                    await bridge().ai.remove({ profileId: tab!.profileId, conversationId: h.id })
                    setHistory(history.filter((v) => v.id !== h.id))
                    forget(tab!.profileId, h.id)
                  })
                }
              >
                <Trash2 size={14} />
              </ShellIconButton>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="ai-transcript">
            <div
              ref={messages}
              className="ai-messages"
              aria-label="AI 对话记录"
              onScroll={(e) => {
                const node = e.currentTarget
                follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
                setShowJump(!follow.current)
              }}
            >
              {!conversation?.messages.length && (
                <div className="ai-welcome">
                  <div className="ai-welcome-title">
                    <span className="ai-welcome-icon" aria-hidden="true">
                      <Bot size={21} strokeWidth={1.8} />
                    </span>
                    <h2>运维路上，有我同行</h2>
                  </div>
                  <p className="ai-welcome-subtitle">复杂的事不必一口气解开，我们可以一步一步来。</p>
                </div>
              )}
              {conversation?.messages.map((m, index) => (
                <AiMessage
                  key={m.id}
                  message={m}
                  target={conversation.target}
                  busy={Boolean(loading || busy || !connected)}
                  onError={setError}
                  onDecide={(proposalId, accepted) => {
                    void act(() => bridge().ai.decide({ proposalId, accepted }))
                  }}
                  onTimeout={(proposalId, seconds) => {
                    void act(() => bridge().ai.setTimeout({ proposalId, seconds }))
                  }}
                  onAsk={() => {
                    const request = conversation.messages
                      .slice(0, index)
                      .reverse()
                      .find((message) => message.role === 'user')
                    if (request) updateDraft({ text: request.text.slice(0, 16384), attachments: [] })
                    composer.current?.focus()
                  }}
                  onContinue={(text) => {
                    void act(async () => {
                      if (!tab?.sessionId) return
                      await openConversation(tab.id, tab.sessionId, undefined, true)
                      updateDraft({
                        text: ('请基于下面的回复继续：\n\n' + text).slice(0, 16384),
                        attachments: [],
                      })
                      composer.current?.focus()
                    })
                  }}
                />
              ))}
              {conversation?.status === 'thinking' && (
                <p className="ai-notice" role="status">
                  AI 正在分析…
                </p>
              )}
            </div>
            {showJump && (
              <ShellIconButton
                className="ai-jump-latest"
                label="滚动到最新回复"
                onClick={() => {
                  follow.current = true
                  setShowJump(false)
                  if (messages.current) messages.current.scrollTop = messages.current.scrollHeight
                }}
              >
                <ArrowDown size={16} />
              </ShellIconButton>
            )}
          </div>
          <div className="ai-composer">
            {showContext && (
              <details className="ai-context" open>
                <summary>查看将发送的上下文</summary>
                <pre>
                  {JSON.stringify(
                    conversation?.target ?? { host: tab?.host, username: tab?.username, cwd: tab?.cwd },
                    null,
                    2,
                  )}
                </pre>
                <p>
                  聊天内容、手动附件和 AI 命令结果会发送至
                  {settings?.source === 'custom' ? settings.endpoint : '官方 AI 服务'}；切换服务前可在此核对。
                </p>
              </details>
            )}
            {draft.attachments.map((a, i) => (
              <details className="ai-attachment" key={`${a.name}-${i}`}>
                <summary>
                  {a.name}
                  <button
                    type="button"
                    aria-label={`移除附件：${a.name}`}
                    onClick={(e) => {
                      e.preventDefault()
                      updateDraft({ attachments: draft.attachments.filter((_, j) => i !== j) })
                    }}
                  >
                    <X size={12} />
                  </button>
                </summary>
                <pre>{a.content}</pre>
              </details>
            ))}
            <Textarea
              ref={composer}
              aria-label="描述运维需求"
              placeholder={connected ? '告诉我你想从哪里开始……' : '请先连接服务器'}
              value={draft.text}
              disabled={!connected || loading}
              maxLength={16384}
              onChange={(e) => updateDraft({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (!busy && !loading && draft.text.trim()) void send()
                }
              }}
            />
            <div className="ai-composer-actions">
              <div className="ai-inline-actions">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <ShellIconButton
                      label="添加上下文"
                      disabled={!connected || loading || draft.attachments.length >= 8}
                    >
                      <Plus size={18} />
                    </ShellIconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onSelect={() => {
                        void attachFile()
                      }}
                    >
                      <FileText size={15} />
                      附加文本文件
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        const content = tab && terminalActions(tab.id)?.selection?.()
                        if (content)
                          updateDraft({
                            attachments: [
                              ...draft.attachments,
                              { name: '终端选区', content: content.slice(0, 65536) },
                            ],
                          })
                        else setError('请先在当前终端选择要附加的内容')
                      }}
                    >
                      附加终端选区
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setShowContext((value) => !value)}>
                      {showContext ? '收起上下文预览' : '查看将发送的上下文'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="ai-approval-mode" title="每条命令执行前均需确认" aria-label="逐条确认模式">
                  <Hand size={16} />
                </span>
              </div>
              <div className="ai-inline-actions ai-composer-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="ai-model-picker" aria-label="选择 AI 模型">
                      <span>{conversation?.model || settings?.model || '选择模型'}</span>
                      <ChevronDown size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled>
                      {settings?.source === 'custom' ? '自定义' : '官方 AI'} ·{' '}
                      {conversation?.model || settings?.model || '默认模型'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSettingsPage('ai')}>配置模型</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {busy ? (
                  <Button
                    size="icon-sm"
                    className="ai-submit"
                    variant="ghost"
                    aria-label="停止"
                    disabled={loading}
                    onClick={() => void act(() => bridge().ai.cancel({ conversationId: conversation.id }))}
                  >
                    <Square size={15} />
                  </Button>
                ) : (
                  <Button
                    size="icon-sm"
                    className="ai-submit"
                    variant="ghost"
                    aria-label="发送"
                    disabled={!connected || loading || !conversation || !draft.text.trim()}
                    onClick={() => void send()}
                  >
                    <ArrowUp size={18} />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
