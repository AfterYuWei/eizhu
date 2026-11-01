import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bot, Copy, FileText, History, Plus, Send, Settings2, Square, Trash2, X } from 'lucide-react'
import type { AiConversation, AiSettings } from '@eizhu/contracts'
import { useAiStore } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { useDesktopShellStore } from '@/store/desktopShell'
import { bridge } from '@/lib/bridge'
import { terminalActions } from '@/lib/terminalActions'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { writeClipboardText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ShellIconButton, ShellResizeHandle } from '@/components/Layout/ShellControls'
import './ai.css'

type Attachment = { name: string; content: string }
const labels = {
  pending: '等待确认',
  running: '执行中',
  completed: '已结束',
  unknown: '结果未知',
  rejected: '已拒绝',
  expired: '已失效',
}

export function AiInspector({
  open,
  overlay,
  onClose,
}: {
  open: boolean
  overlay: boolean
  onClose: () => void
}) {
  const { tabs, activeTabId } = useSessionStore()
  const tab = tabs.find((t) => t.id === activeTabId)
  const { aiWidth, setAiWidth, setSettingsPage } = useDesktopShellStore()
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
      style={{ width: aiWidth }}
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
        label="调整 AI 助手宽度"
        value={aiWidth}
        min={320}
        max={560}
        onChange={setAiWidth}
        reverse
      />
      <div className="shell-inspector-heading">
        <span>
          <Bot size={15} /> AI 助手
        </span>
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
          <ShellIconButton label="关闭 AI 助手" onClick={onClose}>
            <X size={15} />
          </ShellIconButton>
        </div>
      </div>
      <div className="ai-server">
        <strong>{tab?.profileName || '请选择服务器'}</strong>
        <span>
          {tab?.username}@{tab?.host}
          {tab?.port ? `:${tab.port}` : ''}
        </span>
        <small>
          {settings?.source === 'custom' ? '自配模型' : '官方 AI'} ·{' '}
          {conversation?.model || settings?.model || '默认模型'}
        </small>
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
          <div
            ref={messages}
            className="ai-messages"
            aria-label="AI 对话记录"
            onScroll={(e) => {
              const node = e.currentTarget
              follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
            }}
          >
            {!conversation?.messages.length && (
              <div className="ai-empty">
                描述你要完成的任务，AI 会先给出命令，确认后才执行。
                <br />
                支持非交互命令和免密 sudo。
              </div>
            )}
            {conversation?.messages.map((m) => (
              <article className={`ai-message is-${m.role}`} key={m.id}>
                <div className="ai-message-role">{m.role === 'user' ? '你' : 'AI'}</div>
                {m.text && <div className="ai-message-text">{m.text}</div>}
                {m.proposal && (
                  <div className="ai-command">
                    <div className="ai-command-heading">
                      <strong>{labels[m.proposal.state]}</strong>
                      <ShellIconButton
                        label="复制 AI 命令"
                        onClick={() => void act(() => writeClipboardText(m.proposal!.command))}
                      >
                        <Copy size={13} />
                      </ShellIconButton>
                    </div>
                    <p>{m.proposal.purpose}</p>
                    <div className="ai-command-target">
                      {conversation.target.username}@{conversation.target.host}:{conversation.target.port}
                      <br />
                      目录：{m.proposal.cwd}
                    </div>
                    <pre>{m.proposal.command}</pre>
                    <p className="ai-impact">影响：{m.proposal.impact}</p>
                    {m.proposal.state === 'pending' && (
                      <>
                        <label className="ai-timeout">
                          超时（秒）
                          <input
                            type="number"
                            min={1}
                            max={600}
                            defaultValue={m.proposal.timeoutSeconds}
                            disabled={loading}
                            onBlur={(e) => {
                              const seconds = Number(e.target.value)
                              if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 600)
                                void act(() =>
                                  bridge().ai.setTimeout({ proposalId: m.proposal!.id, seconds }),
                                )
                              else e.target.value = String(m.proposal!.timeoutSeconds)
                            }}
                          />
                        </label>
                        <div className="ai-inline-actions">
                          <Button
                            size="sm"
                            disabled={!connected || loading || busy}
                            onClick={() =>
                              void act(() =>
                                bridge().ai.decide({ proposalId: m.proposal!.id, accepted: true }),
                              )
                            }
                          >
                            执行此命令
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={loading || busy}
                            onClick={() =>
                              void act(() =>
                                bridge().ai.decide({ proposalId: m.proposal!.id, accepted: false }),
                              )
                            }
                          >
                            拒绝
                          </Button>
                        </div>
                      </>
                    )}
                    {m.proposal.result && (
                      <div className="ai-result">
                        {m.proposal.result.stdout && (
                          <>
                            <small>stdout</small>
                            <pre>{m.proposal.result.stdout}</pre>
                          </>
                        )}
                        {m.proposal.result.stderr && (
                          <>
                            <small>stderr</small>
                            <pre>{m.proposal.result.stderr}</pre>
                          </>
                        )}
                        <p>
                          {m.proposal.result.exitCode === null
                            ? '退出码未知'
                            : `退出码 ${m.proposal.result.exitCode}`}{' '}
                          · {(m.proposal.result.elapsedMs / 1000).toFixed(1)} 秒
                          {m.proposal.result.truncated ? ' · 输出已截断' : ''}
                        </p>
                        {m.proposal.result.message && <p>{m.proposal.result.message}</p>}
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
            {conversation?.status === 'thinking' && (
              <p className="ai-notice" role="status">
                AI 正在分析…
              </p>
            )}
          </div>
          <div className="ai-composer">
            <details className="ai-context">
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
              aria-label="描述运维需求"
              placeholder={connected ? '描述需求…（Enter 发送，Shift+Enter 换行）' : '请先连接服务器'}
              value={draft.text}
              disabled={!connected || busy || loading}
              maxLength={16384}
              onChange={(e) => updateDraft({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (draft.text.trim()) void send()
                }
              }}
            />
            <div className="ai-composer-actions">
              <div className="ai-inline-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!connected || loading || busy || draft.attachments.length >= 8}
                  onClick={() => {
                    const content = terminalActions(tab!.id)?.selection?.()
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
                  附加选区
                </Button>
                <ShellIconButton
                  label="附加文本文件"
                  disabled={!connected || loading || busy || draft.attachments.length >= 8}
                  onClick={() => void attachFile()}
                >
                  <FileText size={15} />
                </ShellIconButton>
              </div>
              {busy ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void act(() => bridge().ai.cancel({ conversationId: conversation.id }))}
                >
                  <Square size={13} />
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!connected || loading || !conversation || !draft.text.trim()}
                  onClick={() => void send()}
                >
                  <Send size={13} />
                  发送
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
