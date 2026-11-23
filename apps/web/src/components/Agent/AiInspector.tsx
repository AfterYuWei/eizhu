import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Square, History, ChevronDown, Settings2, ArrowUp, FileText, TriangleAlert, X } from 'lucide-react'
import type {
  AiConversation,
  AiBackend,
  AiCapabilities,
  AiCliStatus,
  AiHistoryItem,
  AiModelCatalog,
  AiProvider,
} from '@eizhu/contracts'
import { aiRetryableReply, failureOf } from '@eizhu/contracts'
import { useAiStore } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { useDesktopShellStore } from '@/store/desktopShell'
import { bridge } from '@/lib/bridge'
import { AiIcon, AiAgentIcon, AiModeCheckIcon, AiDeleteIcon, AI_PERMISSION_ICONS } from '@/lib/serverIcons'
import { useAccountStore } from '@/store/account'
import { terminalActions } from '@/lib/terminalActions'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { InlineError } from '@/components/ui/inline-error'
import { Loading } from '@/components/ui/loading'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShellIconButton, ShellResizeHandle } from '@/components/Layout/ShellControls'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import { AiMessage } from './AiMessage'
import { AiApproval } from './AiApproval'
import './ai.css'
const permissionModes = [
  {
    value: 'observer',
    label: '只读观察',
    short: '只读',
    description: '仅允许读取，不执行命令或修改文件',
    Icon: AI_PERMISSION_ICONS.observer,
  },
  {
    value: 'confirm',
    label: '执行前确认',
    short: '审批',
    description: '命令执行和文件修改前由你审批',
    Icon: AI_PERMISSION_ICONS.confirm,
  },
  {
    value: 'auto',
    label: '自动执行',
    short: '自动',
    description: '在当前SSH会话范围内直接执行',
    Icon: AI_PERMISSION_ICONS.auto,
  },
] as const
const ConfirmationIcon = AI_PERMISSION_ICONS.confirm

type Draft = { text: string; attachments: Array<{ name: string; content: string }> }
export function AiInspector({
  tabId,
  open,
  overlay,
  onClose,
  onChoose,
  onOpenTab,
}: {
  tabId: string
  open: boolean
  overlay: boolean
  onClose: () => void
  onChoose: () => void
  onOpenTab?: (tabId: string) => void
}) {
  const tab = useSessionStore((state) => state.tabs.find((item) => item.id === tabId))
  const sessionId = tab?.sessionId ?? null
  const connected = tab?.status === 'connected' && Boolean(sessionId)
  const { inspectorWidth, setInspectorWidth, setSettingsPage } = useDesktopShellStore()
  const selectedId = useAiStore((state) => state.selectedByTab[tabId] ?? null)
  const conversation = useAiStore((state) => selectedId ? state.conversations[selectedId] : undefined)
  const settings = useAiStore((state) => state.settings)
  const { select, put, progress, forget, setSettings } = useAiStore.getState()
  const conversationId = conversation?.id
  const boundSession = conversation?.targets[0]?.sessionId
  const binding = conversation && sessionId && boundSession === sessionId
    ? { conversationId: conversation.id, sessionId } : undefined
  const [newPermission, setNewPermission] = useState<AiConversation['permission']>('confirm')
  const mode = permissionModes.find((m) => m.value === (conversation?.permission ?? newPermission))!
  const loggedIn = useAccountStore((s) => s.status?.loggedIn)
  const [cliStatuses, setCliStatuses] = useState<AiCliStatus[]>([])
  const [official, setOfficial] = useState<AiCapabilities | null>(null)
  const [newBackend, setNewBackend] = useState<AiBackend | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const key = selectedId ?? 'new'
  const draft = drafts[key] ?? { text: '', attachments: [] }
  const [problem, setProblem] = useState<{ message: string; code?: string; sessionId?: string }>()
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<AiHistoryItem[] | null>(null)
  const [legacy, setLegacy] = useState<AiHistoryItem[] | null>(null)
  const [legacyChat, setLegacyChat] = useState<AiConversation>()
  const [historyError, setHistoryError] = useState('')
  const [pickerBoundary, setPickerBoundary] = useState<HTMLElement | null>(null)
  const messages = useRef<HTMLDivElement>(null),
    follow = useRef(true)
  const pending = conversation?.messages.findLast((m) => m.tool?.state === 'pending')?.tool
  const busy =
    conversation?.status === 'thinking' ||
    conversation?.status === 'executing' ||
    conversation?.status === 'awaiting_confirmation'
  const runningJob = conversation?.jobs.some((job) => job.status === 'running')
  const turns = useMemo(() => {
    const groups: Array<{
      id: string
      messages: AiConversation['messages']
      request?: AiConversation['messages'][number]
    }> = []
    let request: AiConversation['messages'][number] | undefined
    for (const message of conversation?.messages ?? []) {
      const last = groups.at(-1)
      if (message.role === 'user') {
        request = message
        groups.push({ id: message.id, messages: [message] })
      } else if (last && last.messages[0]?.role !== 'user') last.messages.push(message)
      else groups.push({ id: request ? request.id + ':reply' : message.id, messages: [message], request })
    }
    const last = groups.at(-1)
    if ((busy || request?.stopped) && last?.messages[0]?.role === 'user')
      groups.push({ id: last.id + ':reply', messages: [], request: last.messages[0] })
    return groups
  }, [conversation?.messages, busy])
  const pausedCall =
    conversation?.status === 'paused'
      ? turns
          .at(-1)
          ?.messages.findLast(
            (message) => message.tool?.state === 'unknown' || message.tool?.state === 'failed',
          )?.tool
      : undefined
  const unknown = pausedCall?.state === 'unknown' ||
    (conversation?.status === 'paused' && conversation.jobs.some((job) => job.status === 'unknown'))
  const setError = useCallback((message: string) => setProblem(message ? { message } : undefined), [])
  const latestMessage = conversation?.messages.at(-1)
  const activity =
    conversation?.status === 'awaiting_confirmation'
      ? '等待你确认'
      : conversation?.status === 'executing'
        ? '正在执行操作…'
        : latestMessage?.role === 'assistant' && latestMessage.text
          ? '正在回复…'
          : '正在思考…'
  const update = (value: Partial<Draft>) => setDrafts((s) => ({ ...s, [key]: { ...draft, ...value } }))
  const inspector = useRef<HTMLElement>(null)
  const positionPicker = () => setPickerBoundary(inspector.current)
  const act = useCallback(
    async (action: () => Promise<unknown>, onError?: (message: string) => void) => {
      const generation = workspaceGeneration()
      setLoading(true)
      if (onError) onError('')
      else setProblem(undefined)
      try {
        await action()
      } catch (error) {
        if (generation !== workspaceGeneration()) return
        const failure = failureOf(error)
        const message = error instanceof Error ? error.message : failure.message
        if (onError) onError(message)
        else setProblem({ message, code: failure.code })
      } finally {
        if (generation === workspaceGeneration()) setLoading(false)
      }
    },
    [],
  )
  useEffect(() => {
    if (!window.eizhu || !conversationId || !sessionId || !boundSession) return
    let live = true
    const generation = workspaceGeneration()
    const api = bridge().ai
    const request = { conversationId, sessionId }
    const change = sessionId === boundSession ? api.scope(request) : connected ? api.read(request) : null
    void change?.then((next) => {
      if (live && generation === workspaceGeneration()) put(next)
    }, (error: unknown) => {
      if (live && generation === workspaceGeneration() && connected) {
        const failure = failureOf(error)
        setProblem({ ...failure, sessionId })
      }
    })
    return () => { live = false }
  }, [conversationId, sessionId, boundSession, connected, put])
  useEffect(() => {
    if (!window.eizhu || !selectedId) return
    return bridge().events.on('eizhu-ai-message', (event) => {
      if (event.workspaceGeneration !== workspaceGeneration()) return
      if ('conversation' in event) {
        if (event.conversation.id === selectedId && event.conversation.targets[0]?.sessionId === sessionId)
          put(event.conversation)
      } else if (event.conversationId === selectedId) progress(event.conversationId, event.message)
    })
  }, [selectedId, sessionId, put, progress])
  useEffect(() => {
    if (open && window.eizhu)
      void bridge()
        .ai.settings()
        .then(setSettings, (e) => setError(e.message))
  }, [open, setSettings, setError])
  useEffect(() => {
    if (follow.current && messages.current) messages.current.scrollTop = messages.current.scrollHeight
  }, [conversation?.messages, conversation?.status])
  const refreshAgents = useCallback(async () => {
    if (!window.eizhu || !settings?.enabled) return
    const generation = workspaceGeneration()
    const [clis, catalog] = await Promise.allSettled([
      bridge().ai.cliStatus(),
      loggedIn ? bridge().ai.capabilities() : Promise.resolve(null),
    ])
    if (generation !== workspaceGeneration()) return
    setCliStatuses(clis.status === 'fulfilled' ? clis.value : [])
    setOfficial(catalog.status === 'fulfilled' ? catalog.value : null)
  }, [loggedIn, settings?.enabled])
  useEffect(() => {
    if (open) void refreshAgents()
  }, [open, refreshAgents])
  const agents = useMemo(() => {
    const choices: Array<{
      value: string
      label: string
      backend: AiBackend
      models: AiModelCatalog['models']
      provider?: Pick<AiProvider, 'name' | 'endpoint'>
    }> = []
    if (!settings?.enabled) return choices
    if (official?.available && official.models.length)
      choices.push({
        value: 'official',
        label: '官方AI',
        models: official.models,
        backend: { kind: 'official', model: official.defaultModel || official.models[0].id },
      })
    for (const provider of settings.providers) {
      const models = new Map((provider.models ?? []).map((m) => [m.id, m]))
      if (!models.has(provider.model))
        models.set(provider.model, { id: provider.model, name: provider.model })
      choices.push({
        provider,
        value: 'provider:' + provider.id,
        label: provider.name,
        models: [...models.values()],
        backend: { kind: 'custom', providerId: provider.id, model: provider.model },
      })
    }
    for (const cli of cliStatuses.filter((c) => c.available)) {
      const configured = settings.clis.find((c) => c.kind === cli.kind)
      const model = configured?.model ?? ''
      choices.push({
        value: 'cli:' + cli.kind,
        label: { codex: 'Codex', claude: 'Claude Code', deepseek: 'DeepSeek Harness' }[cli.kind],
        backend: { kind: cli.kind, model },
        models: [{ id: model, name: model || 'CLI默认' }],
      })
    }
    return choices
  }, [settings, official, cliStatuses])
  const backend = conversation?.backend ?? newBackend ?? settings?.defaultBackend
  const agentKey =
    backend?.kind === 'custom'
      ? 'provider:' + backend.providerId
      : backend?.kind === 'official'
        ? 'official'
        : backend
          ? 'cli:' + backend.kind
          : ''
  const agent = agents.find((a) => a.value === agentKey)
  const model = backend?.model || agent?.backend.model || ''
  const ready = Boolean(agent && agent.models.some((m) => m.id === model))
  const changeBackend = (next: AiBackend) =>
    act(async () => {
      if (binding) put(await bridge().ai.backend({ ...binding, backend: next }))
      else if (!conversation) setNewBackend(next)
    })
  const upload = () =>
    act(async () => {
      const generation = workspaceGeneration()
      const selected = await bridge().document.pick({
        multiple: true,
        mimeTypes: ['text/*', 'application/json'],
      })
      const additions: Draft['attachments'] = []
      try {
        if (selected.length + draft.attachments.length > 8) throw new Error('最多添加8个附件')
        for (const file of selected)
          additions.push({
            name: file.name,
            content: await bridge().document.readText({ reference: file.reference, maxBytes: 65536 }),
          })
        if (
          [...draft.attachments, ...additions].reduce(
            (n, a) => n + new TextEncoder().encode(a.content).length,
            0,
          ) > 131072
        )
          throw new Error('附件总大小不能超过128KiB')
      } finally {
        await Promise.all(selected.map((file) => bridge().document.release({ reference: file.reference })))
      }
      if (generation === workspaceGeneration()) update({ attachments: [...draft.attachments, ...additions] })
    })
  const send = () =>
    act(async () => {
      if (!settings?.enabled || !draft.text.trim() || !agent || !ready || !sessionId || !connected || busy ||
        (conversation && !binding)) return
      const generation = workspaceGeneration()
      let c = conversation
      if (!c) {
        c = await bridge().ai.open({ sessionId, backend: { ...agent.backend, model } })
        if (c.permission !== newPermission) {
          const request = { conversationId: c.id, sessionId }
          try {
            c = await bridge().ai.permission({ ...request, permission: newPermission })
          } catch (error) {
            await bridge().ai.release(request)
            throw error
          }
        }
        if (generation !== workspaceGeneration()) return
        const created = c
        setDrafts((current) => ({ ...current, [created.id]: draft }))
        put(created)
        select(tabId, created.id)
      }
      const request = { conversationId: c.id, sessionId }
      const next = await bridge().ai.scope(request)
      const latest = useSessionStore.getState().tabs.find((item) => item.id === tabId)
      if (generation !== workspaceGeneration() || latest?.sessionId !== sessionId || latest?.status !== 'connected') return
      put(next)
      await bridge().ai.send({ ...request, text: draft.text.trim(), attachments: draft.attachments })
      if (generation === workspaceGeneration()) setDrafts((current) => ({
        ...current,
        [key]: { text: '', attachments: [] },
        [request.conversationId]: { text: '', attachments: [] },
      }))
    })
  const showTerminal = () => terminalActions(tabId)?.focus()
  const reconnect = async () => { await terminalActions(tabId)?.reconnect() }
  const showSettings = () => setSettingsPage('ai')
  const currentProblem = problem && (!problem.sessionId || problem.sessionId === sessionId) ? problem : undefined
  const code = currentProblem?.code ?? conversation?.errorCode ?? pausedCall?.errorCode
  const message = currentProblem?.message || conversation?.error || pausedCall?.error
  const notice = unknown
    ? { title: '执行结果待核查', message: connected ? '请先在终端核查本次操作结果。' : 'SSH 已断开，命令结果未知。', label: '查看终端', action: showTerminal }
    : !connected
      ? { title: tab?.status === 'connecting' || tab?.status === 'reconnecting' ? '正在连接 SSH' : 'SSH 已断开',
          message: draft.text.trim() ? '草稿尚未发送，连接就绪后可继续。' : '连接就绪后可继续当前对话。',
          label: tab?.status !== 'connecting' && tab?.status !== 'reconnecting' ? '重新连接' : undefined,
          action: () => void act(reconnect) }
      : code === 'AI_BUSY' && pausedCall
        ? { title: '终端忙', message: '本次操作未执行。请先返回空闲提示符。', label: '查看终端', action: showTerminal }
        : !settings?.enabled || !ready || ['AI_UNAUTHORIZED', 'AI_CONFIG', 'AI_CLI_UNAVAILABLE'].includes(code ?? '')
          ? { title: code === 'AI_UNAUTHORIZED' ? '模型鉴权失败' : !settings?.enabled ? 'AI 助手尚未启用' : '当前模型不可用',
              message: message || '请确认 AI 设置中的供应商或模型。', label: '打开 AI 设置', action: showSettings }
          : conversation && binding && aiRetryableReply(conversation)
            ? { title: '模型回复中断', message: '模型回复未完成，可以重试本轮。', label: '重试回复', action: () => void act(() => bridge().ai.retry(binding)) }
            : message ? { title: 'AI 操作未完成', message, label: pausedCall || code === 'AI_SCOPE_CHANGED' ? '查看终端' : undefined, action: showTerminal } : undefined
  return (
    <aside
      ref={inspector}
      className={'shell-inspector ai-inspector' + (overlay ? ' is-overlay' : '')}
      style={{ width: inspectorWidth }}
      hidden={!open}
      inert={!open}
      aria-label="AI助手"
      onKeyDown={(e) => {
        if (
          e.key === 'Escape' &&
          !e.defaultPrevented &&
          !(e.target instanceof Element && e.target.closest('[role=menu],[role=listbox],[role=dialog]'))
        ) {
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
        <span className="ai-host-name" title={tab?.profileName}>{tab?.profileName}</span>
        <div className="ai-inline-actions">
          <ShellIconButton
            label="新建AI对话"
            disabled={loading || busy || runningJob || !settings?.enabled}
            onClick={() => void act(async () => {
              if (binding) await bridge().ai.release(binding)
              if (conversationId) forget(conversationId)
              select(tabId, null)
              setNewBackend(null)
              setNewPermission('confirm')
              setHistory(null)
            })}
          >
            <Plus size={15} />
          </ShellIconButton>
          <Dialog
            open={open && history !== null}
            onOpenChange={(value) => {
              if (!value) {
                setHistory(null)
                setLegacy(null)
                setLegacyChat(undefined)
                return
              }
              if (!sessionId) return
              setHistory([])
              void act(async () => {
                const rows = await bridge().ai.history({ sessionId })
                setHistory((current) => (current === null ? null : rows))
              }, setHistoryError)
            }}
          >
            <DialogTrigger asChild>
              <ShellIconButton label="对话历史" disabled={loading || !sessionId}>
                <History size={15} />
              </ShellIconButton>
            </DialogTrigger>
            <DialogContent className="ai-history-dialog" showCloseButton={false}>
              <DialogHeader className="ai-history-heading">
                <div>
                  <DialogTitle>{legacy ? '旧版对话记录' : (tab?.profileName ?? '当前主机') + ' · 对话历史'}</DialogTitle>
                  <DialogDescription>{legacy ? '旧版记录的主机归属无法确认，可只读查看。' : '选择一条对话，继续在此主机使用。'}</DialogDescription>
                </div>
                <DialogClose asChild>
                  <ShellIconButton label="关闭对话历史"><X size={16} /></ShellIconButton>
                </DialogClose>
              </DialogHeader>
              <div className="ai-history-list">
                {legacyChat ? legacyChat.messages.map((message) => (
                  <AiMessage key={message.id} messages={[message]} targets={legacyChat.targets} onError={setHistoryError} />
                )) : (legacy ?? history)?.map((h) => {
                  const otherTab = h.activeSessionId && h.activeSessionId !== sessionId
                    ? useSessionStore.getState().tabs.find((item) => item.sessionId === h.activeSessionId)
                    : undefined
                  const elsewhere = Boolean(h.activeSessionId && h.activeSessionId !== sessionId)
                  return (
                    <div className="ai-history-row" key={h.id} data-conversation-id={h.id}>
                      <Button
                        variant="ghost"
                        disabled={loading || (!legacy && (elsewhere ? !otherTab : !connected || busy || runningJob))}
                        aria-label={'打开对话：' + h.title}
                        aria-current={!legacy && selectedId === h.id ? 'true' : undefined}
                        onClick={() => void act(async () => {
                          if (legacy) {
                            setLegacyChat(await bridge().ai.legacyRead({ conversationId: h.id }))
                            return
                          }
                          if (otherTab) {
                            onOpenTab?.(otherTab.id)
                            setHistory(null)
                            return
                          }
                          if (!sessionId) return
                          const target = { conversationId: h.id, sessionId }
                          const generation = workspaceGeneration()
                          let c: AiConversation
                          try {
                            c = await bridge().ai.read(target)
                          } catch (error) {
                            if (failureOf(error).code === 'AI_TAB_IN_USE')
                              setHistory(await bridge().ai.history({ sessionId }))
                            throw error
                          }
                          if (binding && h.id !== conversationId) {
                            try {
                              await bridge().ai.release(binding)
                            } catch (error) {
                              await bridge().ai.release(target)
                              throw error
                            }
                          }
                          if (generation !== workspaceGeneration()) return
                          if (conversationId && conversationId !== c.id) forget(conversationId)
                          put(c)
                          select(tabId, c.id)
                          setProblem(undefined)
                          setHistory(null)
                        }, setHistoryError)}
                      >
                        <span>{h.title}</span>
                        <small>{elsewhere ? '在另一标签页使用' : new Date(h.updatedAt).toLocaleString('zh-CN')}</small>
                      </Button>
                      {!legacy && <ShellIconButton
                        label={'删除对话：' + h.title}
                        className="ai-history-delete"
                        disabled={loading || elsewhere}
                        onClick={() => void act(async () => {
                          if (!sessionId) return
                          await bridge().ai.remove({ conversationId: h.id, sessionId })
                          if (selectedId === h.id) setNewPermission('confirm')
                          forget(h.id)
                          setHistory((current) => current?.filter((row) => row.id !== h.id) ?? null)
                          setDrafts((current) => {
                            const next = { ...current }
                            delete next[h.id]
                            return next
                          })
                        }, setHistoryError)}
                      ><AiDeleteIcon size={16} /></ShellIconButton>}
                    </div>
                  )
                })}
                {loading && !(legacy ?? history)?.length && <Loading />}
                {!loading && !(legacy ?? history)?.length && !historyError && (
                  <p className="ai-history-empty">暂无历史对话</p>
                )}
              </div>
              <InlineError message={historyError} />
              <Button variant="ghost" className="ai-history-legacy" disabled={loading} onClick={() => {
                setHistoryError('')
                if (legacyChat) setLegacyChat(undefined)
                else if (legacy) setLegacy(null)
                else void act(async () => setLegacy(await bridge().ai.legacyHistory()), setHistoryError)
              }}>{legacyChat ? '返回旧版列表' : legacy ? '返回主机历史' : '查看旧版记录'}</Button>
            </DialogContent>
          </Dialog>
          <ShellIconButton label="AI设置" onClick={() => setSettingsPage('ai')}>
            <Settings2 size={15} />
          </ShellIconButton>
        </div>
      </div>
      <div className="ai-transcript">
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
              <p>描述要在此终端完成的任务</p>
            </div>
          )}
          {turns.map((turn, i) => (
            <AiMessage
              key={turn.id}
              messages={turn.messages}
              targets={conversation?.targets}
              busy={busy && i === turns.length - 1}
              startedAt={turn.request?.startedAt}
              completedAt={turn.request?.completedAt}
              stopped={turn.request?.stopped}
              onError={setError}
            />
          ))}
        </div>
      </div>
      {busy && (
        <div className="ai-response-status" role="status" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true">
            {conversation?.status === 'awaiting_confirmation' ? (
              <ConfirmationIcon size={16} />
            ) : (
              <Loading inline />
            )}
          </span>
          <span>{activity}</span>
        </div>
      )}
      {conversation && binding && runningJob && (
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
                      put(await bridge().ai.stopJob({ ...binding, jobId: job.id })),
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
            onClick={() => void act(() => bridge().ai.cancel(binding))}
          >
            停止Agent及全部任务
          </Button>
        </div>
      )}
      {settings && notice && (
        <div className="ai-fixed-notice">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="ai-fixed-notice-copy" role="status" aria-live="polite" aria-atomic="true">
            <strong>{notice.title}</strong>
            {notice.message && <span>{notice.message}</span>}
          </div>
          {notice.label && <Button variant="outline" size="sm" disabled={loading} onClick={notice.action}>
            {notice.label}
          </Button>}
        </div>
      )}
      <div className="ai-composer">
        {pending && conversation ? (
          <AiApproval
            call={pending}
            target={conversation.targets.find((t) => t.sessionId === pending.sessionId)}
            hostName={tab?.profileName}
            disabled={loading || !settings?.enabled || !connected || !binding || binding.sessionId !== pending.sessionId}
            onDecide={(decision) => {
              if (!binding) return
              void act(() => bridge().ai.decide({ ...binding, callId: pending.id, decision, revision: conversation.revision }))
            }}
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
                  if (!busy && !loading && connected) void send()
                }
              }}
            />
            <div className="ai-attachment-chips">
              {draft.attachments.map((a, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="ghost"
                  className="ai-attachment-chip"
                  disabled={busy || loading}
                  aria-label={'移除附件 ' + a.name}
                  title={a.name}
                  onClick={() => update({ attachments: draft.attachments.filter((_, j) => i !== j) })}
                >
                  <FileText size={12} />
                  <span>{a.name}</span>
                  <X size={12} />
                </Button>
              ))}
            </div>
          </>
        )}
        <div className="ai-composer-actions">
          <div className="ai-inline-actions ai-composer-start">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ShellIconButton
                  label="添加附件"
                  showTooltip={false}
                  disabled={loading || busy || !settings?.enabled}
                >
                  <Plus size={16} />
                </ShellIconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem onSelect={() => void upload()}>
                  <FileText size={14} />
                  上传附件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id={open ? 'ai-permission-picker' : undefined}
                      variant="ghost"
                      className="ai-permission-picker"
                      data-permission={mode.value}
                      aria-label={'执行模式：' + mode.label}
                      disabled={loading || !settings?.enabled}
                    >
                      <mode.Icon size={14} />
                      <span>{mode.short}</span>
                      <ChevronDown size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">切换操作权限</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="top" align="start" className="ai-permission-menu">
                <DropdownMenuLabel>AI操作权限</DropdownMenuLabel>
                <DropdownMenuGroup aria-label="执行模式">
                  {permissionModes.map((item) => (
                    <DropdownMenuItem
                      key={item.value}
                      role="menuitemradio"
                      data-permission={item.value}
                      aria-checked={mode.value === item.value}
                      onSelect={() => {
                        if (item.value === mode.value) return
                        if (!conversation) {
                          setNewPermission(item.value)
                          return
                        }
                        if (!binding) return
                        void act(async () =>
                          put(
                            await bridge().ai.permission({
                              ...binding,
                              permission: item.value,
                            }),
                          ),
                        )
                      }}
                    >
                      <item.Icon size={16} />
                      <span className="ai-permission-copy">
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </span>
                      {mode.value === item.value && (
                        <AiModeCheckIcon size={14} className="ai-permission-check" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Select
              value={agent?.value ?? ''}
              disabled={loading || !settings?.enabled}
              onOpenChange={(open) => {
                if (open) {
                  positionPicker()
                  void refreshAgents()
                }
              }}
              onValueChange={(value) => {
                const next = agents.find((a) => a.value === value)
                if (next) void changeBackend(next.backend)
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <SelectTrigger
                    id={open ? 'ai-agent-picker' : undefined}
                    className="ai-agent-picker"
                    aria-label={agent ? '选择Agent：' + agent.label : '选择Agent'}
                  >
                    <AiAgentIcon kind={agent?.backend.kind} provider={agent?.provider} size={14} />
                    <SelectValue placeholder="Agent">{agent?.label}</SelectValue>
                  </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">切换供应商</TooltipContent>
              </Tooltip>
              <SelectContent
                position="popper"
                side="top"
                align="start"
                sideOffset={8}
                collisionBoundary={pickerBoundary}
                collisionPadding={8}
                className="ai-composer-select"
              >
                {agents.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    <span className="ai-agent-option">
                      <AiAgentIcon kind={a.backend.kind} provider={a.provider} size={16} />
                      {a.label}
                    </span>
                  </SelectItem>
                ))}
                {!agents.length && (
                  <SelectItem value="unavailable" disabled>
                    暂无可用Agent
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="ai-inline-actions ai-composer-end">
            <Select
              value={ready ? 'model:' + model : ''}
              disabled={loading || !agent || !settings?.enabled}
              onOpenChange={(open) => {
                if (open) positionPicker()
              }}
              onValueChange={(value) => {
                if (agent) void changeBackend({ ...agent.backend, model: value.slice(6) })
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <SelectTrigger id={open ? 'ai-chat-model' : undefined} className="ai-model-picker" aria-label="选择模型">
                    <SelectValue placeholder="模型" />
                  </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">切换模型</TooltipContent>
              </Tooltip>
              <SelectContent
                position="popper"
                side="top"
                align="end"
                sideOffset={8}
                collisionBoundary={pickerBoundary}
                collisionPadding={8}
                className="ai-composer-select"
              >
                {agent?.models.map((m) => (
                  <SelectItem key={m.id} value={'model:' + m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {busy ? (
              <Button
                className="ai-submit"
                size="icon"
                aria-label="停止Agent"
                disabled={loading}
                onClick={() =>
                  binding && void act(() => bridge().ai.cancel(binding))
                }
              >
                <Square size={13} />
              </Button>
            ) : (
              <Button
                className="ai-submit"
                size="icon"
                aria-label="发送"
                disabled={
                  loading ||
                  !settings?.enabled ||
                  !ready ||
                  !draft.text.trim() ||
                  !connected ||
                  Boolean(conversation && !binding)
                }
                onClick={() => void send()}
              >
                <ArrowUp size={16} />
                <span className="sr-only">发送</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
