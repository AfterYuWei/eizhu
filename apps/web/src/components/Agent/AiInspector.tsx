import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Square, History, ChevronDown, Settings2 } from 'lucide-react'
import type { AiConversation } from '@eizhu/contracts'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AiMessage } from './AiMessage'
import { AiApproval } from './AiApproval'
import './ai.css'
type Draft = { text: string; attachments: Array<{ name: string; content: string }> }
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
  const { inspectorWidth, setInspectorWidth, setSettingsPage } = useDesktopShellStore()
  const { selectedId, conversations, select, put, progress, forget, settings, setSettings } = useAiStore()
  const conversation = selectedId ? conversations[selectedId] : undefined
  const [selectedSessions, setSelectedSessions] = useState<string[]>(() => {
    const tab = tabs.find((t) => t.id === activeTabId)
    return tab?.sessionId && tab.status === 'connected' ? [tab.sessionId] : []
  })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const key = selectedId ?? 'new',
    draft = drafts[key] ?? { text: '', attachments: [] }
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<Array<
    Pick<AiConversation, 'id' | 'title' | 'updatedAt' | 'backend'>
  > | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const messages = useRef<HTMLDivElement>(null),
    follow = useRef(true)
  const pending = conversation?.messages.findLast((m) => m.tool?.state === 'pending')?.tool
  const busy =
    conversation?.status === 'thinking' ||
    conversation?.status === 'executing' ||
    conversation?.status === 'awaiting_confirmation'
  const update = (value: Partial<Draft>) => setDrafts((s) => ({ ...s, [key]: { ...draft, ...value } }))
  const act = useCallback(async (action: () => Promise<unknown>) => {
    const generation = workspaceGeneration()
    setLoading(true)
    setError('')
    try {
      await action()
    } catch (e) {
      if (generation === workspaceGeneration()) setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      if (generation === workspaceGeneration()) setLoading(false)
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
    if (open && window.eizhu)
      void bridge()
        .ai.settings()
        .then(setSettings, (e) => setError(e.message))
  }, [open, setSettings])
  useEffect(() => {
    if (follow.current && messages.current) messages.current.scrollTop = messages.current.scrollHeight
  }, [conversation?.messages, conversation?.status])
  const selectedBackend = settings?.defaultBackend
  const backendLabel = !settings?.enabled
    ? 'AI助手未启用'
    : selectedBackend?.kind === 'custom'
      ? '内置助手 · ' +
        (settings.providers.find((p) => p.id === selectedBackend.providerId)?.name ?? '自定义模型')
      : selectedBackend?.kind === 'official'
        ? '内置助手 · 官方AI'
        : selectedBackend
          ? { codex: 'Codex', claude: 'Claude Code', deepseek: 'DeepSeek Harness' }[selectedBackend.kind]
          : '正在读取设置…'
  const newConversation = async () => {
    const created = await bridge().ai.open({ sessionIds: selectedSessions })
    put(created)
    select(created.id)
    setHistory(null)
    return created
  }
  const send = () =>
    act(async () => {
      if (!settings?.enabled || !draft.text.trim()) return
      const c = conversation ?? (await newConversation())
      await bridge().ai.send({
        conversationId: c.id,
        text: draft.text.trim(),
        attachments: draft.attachments,
      })
      setDrafts((s) => ({
        ...s,
        [key]: { text: '', attachments: [] },
        [c.id]: { text: '', attachments: [] },
      }))
    })
  return (
    <aside
      className={'shell-inspector ai-inspector' + (overlay ? ' is-overlay' : '')}
      style={{ width: inspectorWidth }}
      hidden={!open}
      inert={!open}
      aria-label="AI助手"
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
            label="新建AI对话"
            disabled={loading || busy || !settings?.enabled}
            onClick={() => {
              select(null)
              setHistory(null)
            }}
          >
            <Plus size={15} />
          </ShellIconButton>
          <ShellIconButton
            label="对话历史"
            onClick={() => void act(async () => setHistory(await bridge().ai.history()))}
          >
            <History size={15} />
          </ShellIconButton>
          <ShellIconButton label="AI设置" onClick={() => setSettingsPage('ai')}>
            <Settings2 size={15} />
          </ShellIconButton>
        </div>
      </div>
      <div className="ai-session-controls">
        <div className="ai-backend-current">
          <span>{backendLabel}</span>
          <Button size="sm" variant="ghost" onClick={() => setSettingsPage('ai')}>
            设置
          </Button>
        </div>
        <div className="ai-inline-actions">
          <Button size="sm" variant="ghost" onClick={() => setScopeOpen((v) => !v)}>
            连接范围 · {conversation?.targets.length ?? selectedSessions.length}
          </Button>
          <Select
            value={conversation?.permission ?? 'confirm'}
            disabled={!conversation || loading}
            onValueChange={(value) => {
              if (conversation && (value === 'observer' || value === 'confirm' || value === 'auto'))
                void act(async () =>
                  put(await bridge().ai.permission({ conversationId: conversation.id, permission: value })),
                )
            }}
          >
            <SelectTrigger aria-label="操作权限">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="observer">观察</SelectItem>
              <SelectItem value="confirm">确认</SelectItem>
              <SelectItem value="auto">自动</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {scopeOpen && (
        <div className="ai-scope" aria-label="选择已打开的连接">
          {tabs
            .filter((t) => t.sessionId && t.status === 'connected')
            .map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={selectedSessions.includes(t.sessionId!)}
                  onChange={(e) =>
                    setSelectedSessions((ids) =>
                      e.target.checked ? [...ids, t.sessionId!] : ids.filter((id) => id !== t.sessionId),
                    )
                  }
                />
                {t.profileName}
              </label>
            ))}
          {!selectedSessions.length && <p>请选择已连接的终端</p>}
          <Button
            size="sm"
            disabled={loading || !selectedSessions.length}
            onClick={() =>
              void act(async () => {
                if (conversation)
                  put(
                    await bridge().ai.scope({
                      conversationId: conversation.id,
                      sessionIds: selectedSessions,
                    }),
                  )
                setScopeOpen(false)
              })
            }
          >
            应用连接范围
          </Button>
        </div>
      )}
      <div className="ai-transcript">
        {history ? (
          <div className="ai-history">
            {history.map((h) => (
              <Button
                key={h.id}
                variant="ghost"
                onClick={() =>
                  void act(async () => {
                    const c = await bridge().ai.read({ conversationId: h.id })
                    put(c)
                    select(c.id)
                    setSelectedSessions(c.targets.map((t) => t.sessionId))
                    setHistory(null)
                  })
                }
              >
                {h.title}
              </Button>
            ))}
            {!history.length && <p>暂无历史对话</p>}
            <Button variant="ghost" onClick={() => setHistory(null)}>
              返回对话
            </Button>
          </div>
        ) : (
          <div
            className="ai-messages"
            ref={messages}
            onScroll={() => {
              const el = messages.current
              if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
          >
            {!conversation?.messages.length && (
              <div className="ai-welcome">
                <AiIcon size={25} />
                <p>选择连接与Agent，开始运维任务</p>
                <p>当前对话独立于终端标签</p>
              </div>
            )}
            {conversation?.messages.map((m, i) => (
              <AiMessage
                key={m.id}
                message={m}
                target={conversation.targets.find((t) => t.sessionId === m.tool?.sessionId)}
                continuation={i > 0 && conversation.messages[i - 1].role !== 'user' && m.role !== 'user'}
                onError={setError}
              />
            ))}
          </div>
        )}
      </div>
      {conversation?.jobs.some((j) => j.status === 'running') && (
        <div className="ai-task-state">
          {conversation.jobs
            .filter((j) => j.status === 'running')
            .map((job) => (
              <div key={job.id} className="ai-inline-actions">
                <span title={job.command}>
                  {conversation.targets.find((t) => t.sessionId === job.sessionId)?.host} ·{' '}
                  {job.command.slice(0, 60)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  aria-label={'停止任务 ' + job.id}
                  onClick={() =>
                    void act(async () =>
                      put(await bridge().ai.stopJob({ conversationId: conversation.id, jobId: job.id })),
                    )
                  }
                >
                  停止任务
                </Button>
              </div>
            ))}
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => void act(() => bridge().ai.cancel({ conversationId: conversation.id }))}
          >
            停止Agent及全部任务
          </Button>
        </div>
      )}
      {(error || conversation?.error) && (
        <p className="ai-error" role="alert">
          {error || conversation?.error}
        </p>
      )}
      {conversation?.status === 'paused' && (
        <p className="ai-command-notice">任务已暂停。请先核查结果，再发送后续指令。</p>
      )}
      {!settings?.enabled && <p className="ai-command-notice">请在设置中启用AI助手并选择使用方式。</p>}
      <div className="ai-composer">
        {pending && conversation ? (
          <AiApproval
            call={pending}
            target={conversation.targets.find((t) => t.sessionId === pending.sessionId)}
            disabled={
              loading ||
              !settings?.enabled ||
              !conversation.targets.some(
                (t) =>
                  t.sessionId === pending.sessionId &&
                  tabs.some((tab) => tab.sessionId === t.sessionId && tab.status === 'connected'),
              )
            }
            onDecide={(decision) =>
              void act(() =>
                bridge().ai.decide({
                  conversationId: conversation.id,
                  callId: pending.id,
                  decision,
                  revision: conversation.revision,
                }),
              )
            }
            onError={setError}
          />
        ) : (
          <>
            <Textarea
              aria-label="AI需求"
              value={draft.text}
              placeholder="描述要完成的任务…"
              disabled={loading || busy}
              onChange={(e) => update({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (!busy) void send()
                }
              }}
            />
            {draft.attachments.map((a, i) => (
              <Button
                key={i}
                size="sm"
                variant="ghost"
                onClick={() => update({ attachments: draft.attachments.filter((_, j) => i !== j) })}
              >
                {a.name} ×
              </Button>
            ))}
            <div className="ai-composer-toolbar">
              <div className="ai-inline-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const text = terminalActions(activeTabId)?.selection?.()
                    if (text)
                      update({ attachments: [...draft.attachments, { name: '终端选区', content: text }] })
                  }}
                >
                  附加选区
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const selected = await bridge().document.pick({
                        multiple: false,
                        mimeTypes: ['text/*', 'application/json'],
                      })
                      for (const file of selected) {
                        try {
                          const content = await bridge().document.readText({
                            reference: file.reference,
                            maxBytes: 65536,
                          })
                          update({ attachments: [...draft.attachments, { name: file.name, content }] })
                        } finally {
                          await bridge().document.release({ reference: file.reference })
                        }
                      }
                    })
                  }
                >
                  附加文件
                </Button>
              </div>
              {busy ? (
                <Button
                  size="sm"
                  aria-label="停止Agent"
                  onClick={() =>
                    conversation && void act(() => bridge().ai.cancel({ conversationId: conversation.id }))
                  }
                >
                  <Square size={14} />
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={
                    loading ||
                    !settings?.enabled ||
                    !draft.text.trim() ||
                    (!conversation && !selectedSessions.length)
                  }
                  onClick={() => void send()}
                >
                  发送
                </Button>
              )}
            </div>
          </>
        )}
        {pending && conversation && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void act(() => bridge().ai.cancel({ conversationId: conversation.id }))}
          >
            停止Agent
          </Button>
        )}
      </div>
      {conversation && (
        <Button
          size="sm"
          variant="ghost"
          disabled={loading || busy}
          onClick={() =>
            void act(async () => {
              await bridge().ai.remove({ conversationId: conversation.id })
              forget(conversation.id)
            })
          }
        >
          删除对话
        </Button>
      )}
    </aside>
  )
}
