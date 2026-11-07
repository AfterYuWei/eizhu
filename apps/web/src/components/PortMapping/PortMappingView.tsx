import { useEffect, useRef, useState } from 'react'
import { DesktopError, isPublicTunnelBind } from '@eizhu/contracts'
import { Copy, LoaderCircle, Pencil, Play, Plus, Search, Square, Trash2, Waypoints } from 'lucide-react'
import { tunnelApi, type TunnelConfig, type TunnelStatus } from '@/api/tunnel'
import { profileApi } from '@/api/profile'
import type { Profile } from '@/types/profile'
import { listen } from '@/lib/bridge'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { mergeStatuses } from '@/lib/tunnelStatuses'
import { writeClipboardText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineError } from '@/components/ui/inline-error'
import { Loading } from '@/components/ui/loading'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { PortMappingForm } from './PortMappingForm'
import '@/styles/port-mapping.css'

const kinds = { local: '本地映射', remote: '远端映射', dynamic: '动态代理' }
const statuses = { stopped: '已停止', connecting: '连接中', running: '运行中', reconnecting: '重连中', failed: '失败' }
const endpoint = (host: string, port: number) => `${host.includes(':') ? `[${host}]` : host}:${port}`

export function PortMappingView({ active }: { active: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [configs, setConfigs] = useState<TunnelConfig[]>([])
  const [states, setStates] = useState<Record<string, TunnelStatus>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState<TunnelConfig | 'new' | null>(null)
  const [deleting, setDeleting] = useState<TunnelConfig | null>(null)
  const [publicStarting, setPublicStarting] = useState<TunnelConfig | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const locks = useRef(new Set<string>())
  const mounted = useRef(false)
  const generation = workspaceGeneration()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!active) return
    let disposed = false
    const current = () => !disposed && generation === workspaceGeneration()
    setLoading(true); setLoadError('')
    // Subscribe before the snapshot; revisions prevent a late snapshot from rolling back a newer event.
    const subscription = listen('eizhu-session-message', ({ payload: event }) => {
      if (!current() || event.workspaceGeneration !== generation || event.type !== 'tunnel_status') return
      setStates((old) => mergeStatuses(old, [event.payload]))
    })
    void subscription.then(async () => {
      if (!current()) return
      const [configs, states, profiles] = await Promise.all([tunnelApi.list(), tunnelApi.statuses(), profileApi.list()])
      if (current()) { setConfigs(configs); setProfiles(profiles); setStates((old) => mergeStatuses(old, states)) }
    }).catch((cause: unknown) => {
      if (current()) setLoadError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (current()) setLoading(false) })
    return () => { disposed = true; void subscription.then((stop) => stop(), () => undefined) }
  }, [active, attempt, generation])

  const run = async (id: string, action: (current: () => boolean) => Promise<void>) => {
    if (locks.current.has(id) || !mounted.current || generation !== workspaceGeneration()) return
    const current = () => mounted.current && generation === workspaceGeneration()
    locks.current.add(id); setBusy(new Set(locks.current)); setErrors((old) => ({ ...old, [id]: '' })); setCopied(null)
    try { await action(current) }
    catch (cause) { if (current()) setErrors((old) => ({ ...old, [id]: cause instanceof Error ? cause.message : String(cause) })) }
    finally { locks.current.delete(id); if (current()) setBusy(new Set(locks.current)) }
  }
  const needle = query.trim().toLowerCase()
  const start = (config: TunnelConfig, confirmed = false) => run(config.id, async (current) => {
    try {
      const next = confirmed ? await tunnelApi.start(config.id, config) : await tunnelApi.start(config.id)
      if (current()) setStates((old) => mergeStatuses(old, [next]))
    } catch (cause) {
      if (cause instanceof DesktopError && cause.error.code === 'TUNNEL_CONFIG_CHANGED') {
        const configs = await tunnelApi.list()
        if (current()) setConfigs(configs)
      }
      throw cause
    }
  })
  const filtered = configs.filter((config) => (kind === 'all' || config.kind === kind)
    && (statusFilter === 'all' || (states[config.id]?.status ?? 'stopped') === statusFilter)
    && [config.name, profiles.find((p) => p.id === config.profile_id)?.name, profiles.find((p) => p.id === config.profile_id)?.host, config.bind_host, String(states[config.id]?.bound_port ?? config.bind_port), config.kind === 'dynamic' ? 'SOCKS5' : endpoint(config.target_host, config.target_port)].join(' ').toLowerCase().includes(needle))
  const publicProfile = profiles.find((profile) => profile.id === publicStarting?.profile_id)
  return <div className="port-mapping-view">
    <div className="pm-heading"><div><h1>端口映射</h1><p>通过 SSH 转发 TCP 连接，分别设置监听端与目标端。</p></div>
      <Button className="pm-create" disabled={loading || !!loadError} onClick={() => setEditing('new')}><Plus size={16} />新增映射</Button>
    </div>
    <div className="pm-filters"><div className="pm-search"><Search size={16} aria-hidden="true" /><Input aria-label="搜索端口映射" placeholder="搜索名称、服务器或端点" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <Select value={kind} onValueChange={setKind}><SelectTrigger aria-label="映射类型筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{Object.entries(kinds).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
      <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger aria-label="映射状态筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(statuses).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
    </div>
    <div className="pm-content" aria-busy={loading}>
      {loading ? <Loading /> : loadError ? <div className="pm-empty"><InlineError message={loadError} /><Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>重新加载</Button></div>
        : !filtered.length ? <div className="pm-empty"><Waypoints size={28} aria-hidden="true" /><p>{configs.length ? '没有匹配的映射' : '暂无端口映射'}</p>
          {configs.length ? <Button variant="secondary" onClick={() => { setQuery(''); setKind('all'); setStatusFilter('all') }}>清除筛选</Button> : <Button variant="secondary" onClick={() => setEditing('new')}>新增映射</Button>}
        </div> : <ul className="pm-rules" aria-label="端口映射规则">{filtered.map((config) => {
          const state = states[config.id]
          const status = state?.status ?? 'stopped'
          const running = status === 'connecting' || status === 'running' || status === 'reconnecting'
          const pending = busy.has(config.id)
          const bound = state?.bound_port
          const address = endpoint(config.bind_host, bound ?? config.bind_port)
          return <li key={config.id} className="pm-rule" data-mapping-id={config.id} aria-label={config.name} aria-busy={pending}>
            <div className="pm-rule-heading"><h2>{config.name}</h2><span className={`pm-status is-${status}`} title={status === 'running' ? 'SSH 和监听已建立，未探测目标服务健康状态' : undefined}>
              {(status === 'connecting' || status === 'reconnecting') && <LoaderCircle size={13} className="motion-safe:animate-spin" aria-hidden="true" />}{statuses[status]}</span></div>
            <p className="pm-rule-meta">{profiles.find((p) => p.id === config.profile_id)?.name ?? '服务器配置已删除'}<span>·</span>{kinds[config.kind]}{isPublicTunnelBind(config.bind_host) && <span className="pm-public-label">对外监听</span>}</p>
            <div className="pm-route"><div><span>{config.kind === 'remote' ? '服务器监听' : config.kind === 'dynamic' ? '本机代理监听' : '本机监听'}</span><code>{config.bind_port === 0 && bound == null ? `${config.bind_host} · 自动分配端口` : address}</code></div><span className="pm-route-arrow" aria-hidden="true">→</span>
              <div><span>{config.kind === 'remote' ? '本机侧目标服务' : config.kind === 'dynamic' ? '客户端指定目标' : '远端目标服务'}</span><code>{config.kind === 'dynamic' ? 'SOCKS5 · TCP CONNECT' : endpoint(config.target_host, config.target_port)}</code></div>
            </div>
            <div className="pm-rule-footer"><p>活动连接 {state?.active_connections ?? 0} / 32{status === 'reconnecting' ? ` · 重连 ${state?.retry_attempt ?? 0} / 10` : ''}</p><div className="pm-rule-actions">
              <Button variant="secondary" disabled={pending} aria-label={`${running ? '停止' : '启动'} ${config.name}`} onClick={() => {
                if (running) void run(config.id, async (current) => { await tunnelApi.stop(config.id); const next = await tunnelApi.statuses(); if (current()) setStates((old) => mergeStatuses(old, next)) })
                else if (isPublicTunnelBind(config.bind_host)) setPublicStarting(config)
                else void start(config)
              }}>{pending ? <Loading inline /> : running ? <Square size={14} /> : <Play size={14} />}{running ? '停止' : '启动'}</Button>
              <Button variant="ghost" disabled={pending || status !== 'running' || bound == null} aria-label={`复制 ${config.name} 监听地址`} onClick={() => void run(config.id, async (current) => { await writeClipboardText(address); if (current()) setCopied(config.id) })}><Copy size={14} />{copied === config.id ? '已复制' : '复制地址'}</Button>
              <Button variant="ghost" disabled={pending || running} aria-label={`编辑 ${config.name}`} onClick={() => setEditing(config)}><Pencil size={14} />编辑</Button>
              <Button variant="ghost" disabled={pending} className="pm-delete" aria-label={`删除 ${config.name}`} onClick={() => setDeleting(config)}><Trash2 size={14} />删除</Button>
            </div></div>
            {state?.error_message && <details className="pm-rule-error"><summary>错误详情{state.error_code ? ` · ${state.error_code}` : ''}</summary><p>{state.error_message}</p></details>}
            <InlineError message={errors[config.id]} />
          </li>
        })}</ul>}
    </div>
    <p className="pm-footnote">切换页面或关闭终端不会停止映射；退出应用时停止，重启后需手动启动。运行中表示监听已就绪。</p>
    {active && editing && <PortMappingForm key={editing === 'new' ? 'new' : editing.id} profiles={profiles} config={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(saved) => { setConfigs((old) => old.some((c) => c.id === saved.id) ? old.map((c) => c.id === saved.id ? saved : c) : [...old, saved]); setEditing(null) }} />}
    <AlertDialog open={active && publicStarting !== null} onOpenChange={(open) => { if (!open) setPublicStarting(null) }}><AlertDialogContent className="port-mapping-confirm pm-public-confirm">
      <AlertDialogTitle>确认对外开放此映射？</AlertDialogTitle>
      <AlertDialogDescription>“{publicStarting?.name}”将对外监听，其他设备可能通过局域网或公网访问此端口。</AlertDialogDescription>
      {publicStarting && <div className="pm-public-details"><p>SSH 服务器：{publicProfile ? `${publicProfile.name} · ${endpoint(publicProfile.host, publicProfile.port)}` : publicStarting.profile_id}</p><p>{publicStarting.kind === 'remote' ? '服务器' : '本机'}监听：{publicStarting.bind_port === 0 ? `${publicStarting.bind_host} · 自动分配端口` : endpoint(publicStarting.bind_host, publicStarting.bind_port)}</p><p>{publicStarting.kind === 'remote' ? '本机侧目标' : publicStarting.kind === 'dynamic' ? '客户端指定目标' : '远端目标'}：{publicStarting.kind === 'dynamic' ? 'SOCKS5 TCP CONNECT' : endpoint(publicStarting.target_host, publicStarting.target_port)}</p></div>}
      <div className="pm-public-warning"><p>{publicStarting?.kind === 'dynamic' ? '此 SOCKS5 代理没有客户端认证，任何能访问监听端口的人都可能使用它。' : '请确认目标服务已配置访问认证，并仅开放必要的防火墙规则。'}</p>
        {publicStarting?.kind === 'remote' && <p>SSH 服务端需允许对外转发，建议配置 GatewayPorts clientspecified。应用不会修改服务器配置或防火墙，监听就绪也不表示公网可达。</p>}</div>
      <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { const config = publicStarting; setPublicStarting(null); if (config) void start(config, true) }}>确认对外开放并启动</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <Dialog open={active && deleting !== null} onOpenChange={(open) => { if (!open && (!deleting || !busy.has(deleting.id))) setDeleting(null) }}><DialogContent className="port-mapping-confirm" showCloseButton={!deleting || !busy.has(deleting.id)}>
      <DialogTitle>删除映射</DialogTitle><DialogDescription>删除“{deleting?.name}”前将停止监听，并断开正在转发的连接。</DialogDescription>
      <div className="pm-dialog-actions"><InlineError message={deleting ? errors[deleting.id] : ''} /><Button variant="secondary" disabled={!!deleting && busy.has(deleting.id)} onClick={() => setDeleting(null)}>取消</Button><Button variant="secondary" disabled={!!deleting && busy.has(deleting.id)} onClick={() => {
        const config = deleting
        if (config) void run(config.id, async (current) => { await tunnelApi.remove(config.id); if (current()) { setConfigs((old) => old.filter((c) => c.id !== config.id)); setDeleting(null) } })
      }}>确认删除</Button></div>
    </DialogContent></Dialog>
  </div>
}
