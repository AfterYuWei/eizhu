import { mergeStatuses } from '@/lib/tunnelStatuses'
import { useEffect, useState, useMemo } from 'react'
import { listen } from '@tauri-apps/api/event'
import { tunnelApi, type TunnelConfig, type TunnelStatus } from '@/api/tunnel'
import { sessionApi } from '@/api/session'
import { useProfileStore } from '@/store/profile'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthPromptDialog } from './AuthPromptDialog'
import { ConnectionDialog } from '@/components/ConnectionDialog'
import type { AuthenticationRequestPayload } from '@/types/sessionMessage'
const initial = (): TunnelConfig => ({ id: '', name: '', profile_id: '', kind: 'local', bind_host: '127.0.0.1', bind_port: 8080, target_host: '127.0.0.1', target_port: 80 })
interface TunnelEvent { workspaceGeneration?: number; session_id: string; type: string; payload: TunnelStatus | AuthenticationRequestPayload }
const labels: Record<TunnelStatus['status'], string> = { stopped: '已停止', connecting: '连接中', running: '运行中', reconnecting: '重连中', failed: '失败' }
export function TunnelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const profiles = useProfileStore((state) => state.profiles)
  const [configs, setConfigs] = useState<TunnelConfig[]>([])
  const [states, setStates] = useState<Record<string, TunnelStatus>>({})
  const [editing, setEditing] = useState<TunnelConfig | null>(null)
  const [deleting, setDeleting] = useState<TunnelConfig | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = workspaceGeneration()
  const load = async () => { const [configs, statuses] = await Promise.all([tunnelApi.list(), tunnelApi.statuses()]); if (generation !== workspaceGeneration()) return; setConfigs(configs); setStates((old) => mergeStatuses(old, statuses)) }
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action(); if (generation === workspaceGeneration()) await load() } catch (cause) { if (generation === workspaceGeneration()) setError(cause instanceof Error ? cause.message : String(cause)) } finally { if (generation === workspaceGeneration()) setBusy(false) }
  }
  useEffect(() => {
    if (!open) return
    let disposed = false
    void Promise.all([tunnelApi.list(), tunnelApi.statuses()]).then(([configs, statuses]) => { if (!disposed && generation === workspaceGeneration()) { setConfigs(configs); setStates((old) => mergeStatuses(old, statuses)) } }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)) })
    const listener = listen<TunnelEvent>('eizhu-session-message', ({ payload: event }) => {
      if (disposed || generation !== workspaceGeneration() || (event.workspaceGeneration !== undefined && event.workspaceGeneration !== generation)) return
      if (event.type === 'tunnel_status') setStates((old) => mergeStatuses(old, [event.payload as TunnelStatus]))
    })
    return () => { disposed = true; void listener.then((stop) => stop()) }
  }, [open, generation])
  return <>
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogTitle>SSH 隧道</DialogTitle><DialogDescription>配置仅保存在本账号空间；启动使用独立 SSH 连接。重启后需手动启动，监听只允许回环地址。</DialogDescription>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end"><Button disabled={busy} onClick={() => setEditing(initial())}>新增隧道</Button></div>
      {configs.map((config) => { const status = states[config.id]; const running = status && ['running', 'connecting', 'reconnecting'].includes(status.status)
        return <div key={config.id} className="space-y-2 rounded-md border p-3 text-sm"><div className="flex items-center justify-between gap-2"><strong>{config.name} · {config.kind === 'remote' ? '远端' : '本地'}</strong><span>{labels[status?.status ?? 'stopped']}</span></div>
          <p className="break-all text-muted-foreground">{config.bind_host}:{status?.bound_port ?? config.bind_port} → {config.target_host}:{config.target_port} · {profiles.find((profile) => profile.id === config.profile_id)?.name ?? '服务器配置已删除'}</p>
          <p>活动连接 {status?.active_connections ?? 0} / 32{status?.retry_attempt ? ` · 重试 ${status.retry_attempt} / 10` : ''}</p>
          {status?.error_message && <details><summary className="text-destructive">错误详情 · {status.error_code}</summary><p className="whitespace-pre-wrap break-all">{status.error_message}</p></details>}
          <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void run(() => running ? tunnelApi.stop(config.id) : tunnelApi.start(config.id))}>{running ? '停止' : '启动'}</Button>
            <Button variant="ghost" disabled={busy || Boolean(running)} onClick={() => setEditing(config)}>编辑</Button><Button variant="ghost" disabled={busy} onClick={() => setDeleting(config)}>删除</Button></div>
        </div>
      })}
      {!configs.length && <p className="text-sm text-muted-foreground">暂无隧道配置</p>}
    </DialogContent></Dialog>
    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null) }}><DialogContent><DialogTitle>{editing?.id ? '编辑隧道' : '新增隧道'}</DialogTitle><DialogDescription>{editing?.kind === 'remote' ? '远端转发：在 SSH 服务器回环监听，转发到本机可访问的目标。' : '本地转发：连接本机监听端口，由 SSH 服务器访问目标。'}</DialogDescription>
      {editing && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(async () => { await tunnelApi.save(editing); setEditing(null) }) }}>
        <Label>名称<Input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Label>
        <Label>类型<select className="w-full rounded-md border bg-background p-2" value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as TunnelConfig['kind'] })}><option value="local">本地转发</option><option value="remote">远端转发</option></select></Label>
        <Label>SSH 服务器<select required className="w-full rounded-md border bg-background p-2" value={editing.profile_id} onChange={(event) => setEditing({ ...editing, profile_id: event.target.value })}><option value="">选择服务器</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Label>
        {(['bind_host', 'bind_port', 'target_host', 'target_port'] as const).map((key) => <Label key={key}>{({ bind_host: '回环监听地址', bind_port: '监听端口（0 自动分配）', target_host: '目标域名或 IP', target_port: '目标端口' })[key]}<Input required type={key.endsWith('port') ? 'number' : 'text'} min={key === 'bind_port' ? 0 : 1} max={65535} value={editing[key]} onChange={(event) => setEditing({ ...editing, [key]: key.endsWith('port') ? Number(event.target.value) : event.target.value })} /></Label>)}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button disabled={busy}>保存</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null) }}><DialogContent><DialogTitle>删除隧道</DialogTitle><DialogDescription>删除 {deleting?.name} 前将停止监听并清理正在转发的连接。</DialogDescription><Button disabled={busy} onClick={() => { const config = deleting; if (config) void run(async () => { await tunnelApi.remove(config.id); setDeleting(null) }) }}>确认删除</Button></DialogContent></Dialog>
  </>
}
/** Always mounted: a pending connection can prompt after its management dialog is closed. */
export function TunnelPrompts() {
  const [prompts, setPrompts] = useState<{ id: string; type: string; request: AuthenticationRequestPayload & { fingerprint?: string; known_fingerprint?: string } }[]>([])
  const prompt = prompts[0] ?? null
  const [error, setError] = useState('')
  useEffect(() => {
    const generation = workspaceGeneration(); let disposed = false
    const listener = listen<TunnelEvent>('eizhu-session-message', ({ payload: event }) => {
      if (disposed || generation !== workspaceGeneration() || (event.workspaceGeneration !== undefined && event.workspaceGeneration !== generation)) return
      if (event.type === 'tunnel_auth_closed') setPrompts((current) => current.filter((pending) => pending.request.request_id !== (event.payload as AuthenticationRequestPayload).request_id))
      if (event.type === 'tunnel_auth_request' || event.type === 'tunnel_host_key_request') setPrompts((current) => current.some((pending) => pending.request.request_id === (event.payload as AuthenticationRequestPayload).request_id) ? current : [...current, { id: event.session_id, type: event.type, request: event.payload as AuthenticationRequestPayload }])
      if (event.type === 'tunnel_status' && ['stopped', 'failed'].includes((event.payload as TunnelStatus).status)) setPrompts((current) => current.filter((pending) => pending.id !== event.session_id))
    })
    return () => { disposed = true; void listener.then((stop) => stop()) }
  }, [])
  const authRequest = useMemo(() => prompt?.type === 'tunnel_auth_request' ? { ...prompt.request, instructions: [prompt.request.instructions, error].filter(Boolean).join('\n') } : undefined, [prompt, error])
  const respond = async (responses: string[]) => { if (!prompt) return; try { await sessionApi.respondAuth(prompt.request.request_id, responses); setPrompts((current) => current.filter((pending) => pending.request.request_id !== prompt.request.request_id)); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  const stop = () => { if (prompt) void tunnelApi.stop(prompt.id).then(() => setPrompts((current) => current.filter((pending) => pending.id !== prompt.id))).catch((cause) => setError(String(cause))) }
  return <>
    <AuthPromptDialog request={authRequest} onSubmit={(responses) => void respond(responses)} onCancel={stop} />
    <ConnectionDialog open={prompt?.type === 'tunnel_host_key_request'} onOpenChange={(open) => { if (!open) stop() }} profileName={prompt?.request.name ?? '隧道'} host="SSH 隧道" port={22} username="" status="hostkey" logs={[]} errorMessage={error} hostKeyFingerprint={prompt?.request.fingerprint} knownHostKeyFingerprint={prompt?.request.known_fingerprint} onCancel={stop} onReconnectNow={() => {}} onHostKeyDecision={(decision) => void respond([decision, prompt?.request.fingerprint ?? ''])} />
  </>
}
