import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Square, History, ChevronDown, Settings2, ArrowUp, FileText, X } from 'lucide-react'
import type {
  AiConversation,
  AiBackend,
  AiCapabilities,
  AiCliStatus,
  AiModelCatalog,
  AiProvider,
} from '@eizhu/contracts'
import { useAiStore } from '@/store/ai'
import { useSessionStore } from '@/store/session'
import { useDesktopShellStore } from '@/store/desktopShell'
import { bridge } from '@/lib/bridge'
import { AiIcon, AiAgentIcon, AiModeCheckIcon, AiDeleteIcon, AI_PERMISSION_ICONS } from '@/lib/serverIcons'
import { useAccountStore } from '@/store/account'
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
  const { tabs } = useSessionStore()
  const { inspectorWidth, setInspectorWidth, setSettingsPage } = useDesktopShellStore()
  const { selectedId, conversations, select, put, progress, forget, settings, setSettings } = useAiStore()
  const conversation = selectedId ? conversations[selectedId] : undefined
  const conversationId = conversation?.id
  const [newPermission, setNewPermission] = useState<AiConversation['permission']>('confirm')
  const mode = permissionModes.find((m) => m.value === (conversation?.permission ?? newPermission))!
  const loggedIn = useAccountStore((s) => s.status?.loggedIn)
  const [cliStatuses, setCliStatuses] = useState<AiCliStatus[]>([])
  const [official, setOfficial] = useState<AiCapabilities | null>(null)
  const [newBackend, setNewBackend] = useState<AiBackend | null>(null)
  const connectedTabs = tabs.filter((t) => t.sessionId && t.status === 'connected')
  const sessionIds = [...new Set(connectedTabs.map((t) => t.sessionId!))].sort()
  const sessionKey = JSON.stringify(sessionIds)
  const targetKey = JSON.stringify(conversation?.targets.map((t) => t.sessionId).sort() ?? [])
  const scopeReady = sessionIds.length > 0 && sessionIds.length <= 32 && sessionKey === targetKey
  const scopeQueue = useRef(Promise.resolve())
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const key = selectedId ?? 'new',
    draft = drafts[key] ?? { text: '', attachments: [] }
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<Array<
    Pick<AiConversation, 'id' | 'title' | 'updatedAt' | 'backend'>
  > | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [pickerPosition, setPickerPosition] = useState<{ offset: number; boundary: HTMLElement | null }>({
    offset: 8,
    boundary: null,
  })
  const messages = useRef<HTMLDivElement>(null),
    follow = useRef(true)
  const pending = conversation?.messages.findLast((m) => m.tool?.state === 'pending')?.tool
  const busy =
    conversation?.status === 'thinking' ||
    conversation?.status === 'executing' ||
    conversation?.status === 'awaiting_confirmation'
  const update = (value: Partial<Draft>) => setDrafts((s) => ({ ...s, [key]: { ...draft, ...value } }))
  const positionPicker = (id: 'ai-agent-picker' | 'ai-chat-model') => {
    const trigger = document.getElementById(id)
    const composer = trigger?.closest<HTMLElement>('.ai-composer')
    if (!trigger || !composer) return
    setPickerPosition({
      offset: trigger.getBoundingClientRect().top - composer.getBoundingClientRect().top + 8,
      boundary: trigger.closest<HTMLElement>('.ai-inspector'),
    })
  }
  const act = useCallback(
    async (action: () => Promise<unknown>, onError: (message: string) => void = setError) => {
      const generation = workspaceGeneration()
      setLoading(true)
      onError('')
      try {
        await action()
      } catch (e) {
        if (generation === workspaceGeneration()) onError(e instanceof Error ? e.message : '操作失败')
      } finally {
        if (generation === workspaceGeneration()) setLoading(false)
      }
    },
    [setLoading, setError],
  )
  useEffect(() => {
    if (!open || !conversationId || sessionKey === targetKey || !window.eizhu) return
    let live = true
    scopeQueue.current = scopeQueue.current.then(async () => {
      if (!live) return
      await act(async () => {
        const ids: string[] = JSON.parse(sessionKey)
        const next =
          ids.length && ids.length <= 32
            ? await bridge().ai.scope({ conversationId, sessionIds: ids })
            : (await bridge().ai.cancel({ conversationId }), await bridge().ai.read({ conversationId }))
        if (live) put(next)
      })
    })
    return () => {
      live = false
    }
  }, [open, conversationId, sessionKey, targetKey, act, put])
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
      if (conversation) put(await bridge().ai.backend({ conversationId: conversation.id, backend: next }))
      else setNewBackend(next)
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
  const newConversation = async () => {
    if (!agent || !ready) throw new Error('请选择可用的Agent和模型')
    let created = await bridge().ai.open({
      sessionIds,
      backend: { ...agent.backend, model },
    })
    if (created.permission !== newPermission)
      created = await bridge().ai.permission({ conversationId: created.id, permission: newPermission })
    setDrafts((current) => ({ ...current, [created.id]: draft }))
    put(created)
    select(created.id)
    setHistory(null)
    return created
  }
  const send = () =>
    act(async () => {
      if (!settings?.enabled || !draft.text.trim()) return
      if (!ready) throw new Error('请选择可用的Agent和模型')
      if (!sessionIds.length) throw new Error('请先打开SSH连接')
      if (sessionIds.length > 32) throw new Error('AI最多支持32个已连接的SSH会话，请关闭多余连接')
      await scopeQueue.current
      const c = conversation ?? (await newConversation())
      if (conversation && !scopeReady) put(await bridge().ai.scope({ conversationId: c.id, sessionIds }))
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
        <div className="ai-inline-actions">
          <ShellIconButton
            label="新建AI对话"
            disabled={loading || busy || !settings?.enabled}
            onClick={() => {
              select(null)
              setNewBackend(null)
              setNewPermission('confirm')
              setHistory(null)
            }}
          >
            <Plus size={15} />
          </ShellIconButton>
          <Dialog
            open={open && history !== null}
            onOpenChange={(value) => {
              if (!value) {
                setHistory(null)
                return
              }
              setHistory([])
              void act(async () => {
                const rows = await bridge().ai.history()
                setHistory((current) => (current === null ? null : rows))
              }, setHistoryError)
            }}
          >
            <DialogTrigger asChild>
              <ShellIconButton label="对话历史" disabled={loading}>
                <History size={15} />
              </ShellIconButton>
            </DialogTrigger>
            <DialogContent className="ai-history-dialog" showCloseButton={false}>
              <DialogHeader className="ai-history-heading">
                <div>
                  <DialogTitle>对话历史</DialogTitle>
                  <DialogDescription>打开或删除已保存的对话。</DialogDescription>
                </div>
                <DialogClose asChild>
                  <ShellIconButton label="关闭对话历史">
                    <X size={16} />
                  </ShellIconButton>
                </DialogClose>
              </DialogHeader>
              <div className="ai-history-list">
                {history?.map((h) => (
                  <div className="ai-history-row" key={h.id} data-conversation-id={h.id}>
                    <Button
                      variant="ghost"
                      disabled={loading}
                      aria-label={'打开对话：' + h.title}
                      aria-current={selectedId === h.id ? 'true' : undefined}
                      onClick={() =>
                        void act(async () => {
                          const c = await bridge().ai.read({ conversationId: h.id })
                          put(c)
                          select(c.id)
                          setHistory(null)
                        }, setHistoryError)
                      }
                    >
                      <span>{h.title}</span>
                      <small>{new Date(h.updatedAt).toLocaleString('zh-CN')}</small>
                    </Button>
                    <ShellIconButton
                      label={'删除对话：' + h.title}
                      className="ai-history-delete"
                      disabled={loading}
                      onClick={() =>
                        void act(async () => {
                          await scopeQueue.current
                          await bridge().ai.remove({ conversationId: h.id })
                          if (selectedId === h.id) setNewPermission('confirm')
                          forget(h.id)
                          setHistory((current) => current?.filter((row) => row.id !== h.id) ?? null)
                          setDrafts((current) => {
                            const next = { ...current }
                            delete next[h.id]
                            return next
                          })
                        }, setHistoryError)
                      }
                    >
                      <AiDeleteIcon size={16} />
                    </ShellIconButton>
                  </div>
                ))}
                {loading && !history?.length && <Loading />}
                {!loading && !history?.length && !historyError && (
                  <p className="ai-history-empty">暂无历史对话</p>
                )}
              </div>
              <InlineError message={historyError} />
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
              <p>打开SSH连接，选择Agent开始运维任务</p>
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
      {!settings?.enabled && <p className="ai-command-notice">请在设置中启用AI助手。</p>}
      {settings?.enabled && !ready && (
        <p className="ai-command-notice">请选择可用的Agent和模型；可在设置中配置供应商或检查CLI安装。</p>
      )}
      {!sessionIds.length && <p className="ai-command-notice">请先打开SSH连接。</p>}
      {sessionIds.length > 32 && <p className="ai-command-notice">AI最多支持32个SSH会话，请关闭多余连接。</p>}
      <div className="ai-composer">
        {pending && conversation ? (
          <AiApproval
            call={pending}
            target={conversation.targets.find((t) => t.sessionId === pending.sessionId)}
            disabled={
              loading ||
              !settings?.enabled ||
              !scopeReady ||
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
                      id="ai-permission-picker"
                      variant="ghost"
                      className="ai-permission-picker"
                      data-permission={mode.value}
                      aria-label={'执行模式：' + mode.label}
                      title={mode.description}
                      disabled={loading || !settings?.enabled}
                    >
                      <mode.Icon size={14} />
                      <span>{mode.short}</span>
                      <ChevronDown size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {mode.label}：{mode.description}
                </TooltipContent>
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
                        void act(async () =>
                          put(
                            await bridge().ai.permission({
                              conversationId: conversation.id,
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
                  positionPicker('ai-agent-picker')
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
                    id="ai-agent-picker"
                    className="ai-agent-picker"
                    aria-label={agent ? '选择Agent：' + agent.label : '选择Agent'}
                    title={agent?.label}
                  >
                    <AiAgentIcon kind={agent?.backend.kind} provider={agent?.provider} size={14} />
                    <SelectValue placeholder="Agent">{agent?.label}</SelectValue>
                  </SelectTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">{agent?.label ?? '选择Agent'}</TooltipContent>
              </Tooltip>
              <SelectContent
                position="popper"
                side="top"
                align="start"
                sideOffset={pickerPosition.offset}
                collisionBoundary={pickerPosition.boundary}
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
                if (open) positionPicker('ai-chat-model')
              }}
              onValueChange={(value) => {
                if (agent) void changeBackend({ ...agent.backend, model: value.slice(6) })
              }}
            >
              <SelectTrigger
                id="ai-chat-model"
                className="ai-model-picker"
                aria-label="选择模型"
                title={model}
              >
                <SelectValue placeholder="模型" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                side="top"
                align="end"
                sideOffset={pickerPosition.offset}
                collisionBoundary={pickerPosition.boundary}
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
                  conversation && void act(() => bridge().ai.cancel({ conversationId: conversation.id }))
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
                  !sessionIds.length ||
                  sessionIds.length > 32
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
