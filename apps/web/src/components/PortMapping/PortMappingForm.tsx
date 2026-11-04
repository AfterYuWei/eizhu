import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { tunnelConfigSchema, isPublicTunnelBind } from '@eizhu/contracts'
import { tunnelApi, type TunnelConfig, type TunnelKind } from '@/api/tunnel'
import type { Profile } from '@/types/profile'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineError } from '@/components/ui/inline-error'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { AddressInput } from './AddressInput'
import { PortMappingFlow } from './PortMappingFlow'

interface EndpointDraft { bind_host: string; bind_port: string; target_host: string; target_port: string }

export function PortMappingForm({ config, profiles, onSaved, onClose }: { config: TunnelConfig | null; profiles: Profile[]; onSaved: (config: TunnelConfig) => void; onClose: () => void }) {
  const [name, setName] = useState(config?.name ?? '')
  const [kind, setKind] = useState<TunnelKind>(config?.kind ?? 'local')
  const [profileId, setProfileId] = useState(config?.profile_id ?? '')
  const [endpoints, setEndpoints] = useState<Record<TunnelKind, EndpointDraft>>(() => {
    const empty: EndpointDraft = { bind_host: '127.0.0.1', bind_port: '', target_host: '127.0.0.1', target_port: '' }
    return {
      local: { ...empty }, remote: { ...empty }, dynamic: { ...empty },
      ...(config ? { [config.kind]: { bind_host: config.bind_host, bind_port: String(config.bind_port), target_host: config.target_host, target_port: String(config.target_port) } } : {}),
    }
  })
  const { bind_host: bindHost, bind_port: bindPort, target_host: targetHost, target_port: targetPort } = endpoints[kind]
  const [errors, setErrors] = useState<Partial<Record<keyof TunnelConfig, string>>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [discard, setDiscard] = useState(false)
  const savingRef = useRef(false)
  const mounted = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const id = useId()
  const generation = workspaceGeneration()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const clearFieldError = (field: keyof TunnelConfig) => setErrors((old) => ({ ...old, [field]: undefined }))
  const updateEndpoint = (field: keyof EndpointDraft, value: string) => {
    setEndpoints((old) => ({ ...old, [kind]: { ...old[kind], [field]: value } }))
    clearFieldError(field)
  }
  const dirty = name !== (config?.name ?? '') || kind !== (config?.kind ?? 'local') || profileId !== (config?.profile_id ?? '')
    || bindHost !== (config?.bind_host ?? '127.0.0.1') || bindPort !== (config ? String(config.bind_port) : '')
    || targetHost !== (config?.target_host ?? '127.0.0.1') || targetPort !== (config ? String(config.target_port) : '')
  const close = () => { if (!savingRef.current) { if (dirty) setDiscard(true); else onClose() } }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || !mounted.current || generation !== workspaceGeneration()) return
    const configInput = {
      id: config?.id ?? '', name, profile_id: profileId, kind, bind_host: bindHost,
      bind_port: bindPort.trim() === '' ? NaN : Number(bindPort),
      target_host: kind === 'dynamic' ? '127.0.0.1' : targetHost.trim(),
      target_port: kind === 'dynamic' ? 80 : targetPort.trim() === '' ? NaN : Number(targetPort),
    }
    const result = tunnelConfigSchema.safeParse(configInput)
    const invalid: Partial<Record<keyof TunnelConfig, string>> = {}
    if (!result.success) for (const issue of result.error.issues) {
      const field = issue.path[0]
      if (field === 'name') invalid.name = '请输入名称（最多 512 个字符）'
      if (field === 'profile_id') invalid.profile_id = '请选择 SSH 服务器'
      if (field === 'bind_host') invalid.bind_host = '请选择有效的监听地址'
      if (field === 'bind_port') invalid.bind_port = '请输入 0–65535 的整数，0 表示自动分配'
      if (field === 'target_host') invalid.target_host = '请输入有效的目标域名或 IP（最多 512 个字符）'
      if (field === 'target_port') invalid.target_port = '请输入 1–65535 的整数'
    }
    if (!profiles.some((profile) => profile.id === profileId)) invalid.profile_id = '请选择仍然存在的 SSH 服务器'
    setErrors(invalid); setError('')
    if (!result.success || Object.keys(invalid).length) {
      const field = Object.keys(invalid)[0]
      form.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus()
      return
    }
    savingRef.current = true; setSaving(true)
    try {
      const saved = await tunnelApi.save(result.data)
      if (mounted.current && generation === workspaceGeneration()) onSaved(saved)
    } catch (cause) {
      if (mounted.current && generation === workspaceGeneration()) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      savingRef.current = false
      if (mounted.current && generation === workspaceGeneration()) setSaving(false)
    }
  }
  const listenerLabel = kind === 'remote' ? 'SSH 服务器监听' : kind === 'dynamic' ? '本机 SOCKS5 监听' : '本机监听'
  const listenerSide = kind === 'remote' ? '服务器' : '本机'
  const targetSide = kind === 'remote' ? '本机侧' : '远端'
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="port-mapping-dialog" showCloseButton={!saving}>
        <div className="pm-form-heading">
        <DialogTitle>{config ? '编辑映射' : '新增映射'}</DialogTitle>
        <DialogDescription className="sr-only">{kind === 'remote' ? '远端映射：服务器监听 → SSH → 本机侧目标服务。' : kind === 'dynamic' ? '动态代理：本机 SOCKS5 → SSH 服务器 → 客户端指定的目标。仅支持 TCP CONNECT。' : '本地映射：本机监听 → SSH 服务器 → 远端目标服务。'}</DialogDescription>
        </div>
        <form ref={form} noValidate onSubmit={(event) => void submit(event)} className="port-mapping-form">
          <div className="pm-editor-grid">
          <fieldset disabled={saving}>
            <div className="pm-field"><Label htmlFor={`${id}-name`}>名称</Label>
              <Input id={`${id}-name`} data-field="name" value={name} maxLength={512} onChange={(event) => { setName(event.target.value); clearFieldError('name') }} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${id}-name-error` : undefined} />
              <span id={`${id}-name-error`}><InlineError message={errors.name} /></span>
            </div>
            <div className="pm-form-columns"><div className="pm-field"><Label htmlFor={`${id}-kind`}>映射类型</Label>
              <Select value={kind} disabled={saving} onValueChange={(value) => { if (value === 'local' || value === 'remote' || value === 'dynamic') { setKind(value); setErrors({}); setError('') } }}>
                <SelectTrigger id={`${id}-kind`} data-field="kind"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local">本地映射</SelectItem><SelectItem value="remote">远端映射</SelectItem><SelectItem value="dynamic">动态代理</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="pm-field"><Label htmlFor={`${id}-profile`}>SSH 服务器</Label>
              <Select value={profileId} disabled={saving} onValueChange={(value) => { setProfileId(value); clearFieldError('profile_id') }}>
                <SelectTrigger id={`${id}-profile`} data-field="profile_id" aria-invalid={!!errors.profile_id} aria-describedby={errors.profile_id ? `${id}-profile-error` : undefined}><SelectValue placeholder="选择服务器" /></SelectTrigger>
                <SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent>
              </Select>
              <span id={`${id}-profile-error`}><InlineError message={errors.profile_id} /></span>
            </div></div>
            <div className="pm-form-group"><p>{listenerLabel}</p><div className="pm-form-columns">
              <div className="pm-field"><Label htmlFor={`${id}-bind-host`}>{listenerSide}监听地址</Label>
                <Select value={bindHost} disabled={saving} onValueChange={(value) => updateEndpoint('bind_host', value)}>
                  <SelectTrigger id={`${id}-bind-host`} data-field="bind_host"><SelectValue /></SelectTrigger>
                  <SelectContent>{['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::'].map((host) => <SelectItem key={host} value={host}>{host}</SelectItem>)}</SelectContent>
                </Select><InlineError message={errors.bind_host} />
              </div>
              <div className="pm-field"><Label htmlFor={`${id}-bind-port`}>{listenerSide}监听端口</Label>
                <Input id={`${id}-bind-port`} data-field="bind_port" type="number" min={0} max={65535} step={1} value={bindPort} onChange={(event) => updateEndpoint('bind_port', event.target.value)} placeholder="0 自动分配" aria-invalid={!!errors.bind_port} aria-describedby={`${id}-bind-port-hint`} />
                <span id={`${id}-bind-port-hint`}>{errors.bind_port ? <InlineError message={errors.bind_port} /> : <small>填写 0 自动分配端口</small>}</span>
              </div>
            </div></div>
            {isPublicTunnelBind(bindHost) && <div className="pm-public-warning" role="note"><p>该端口可能被局域网或公网访问，每次手动启动前都需要再次确认。</p>
              {kind === 'dynamic' && <p>此 SOCKS5 代理没有客户端认证，对外开放可能成为任何人可用的代理。</p>}
              {kind === 'remote' && <p>远端需服务端允许对外转发；运行中不代表公网已经可达。</p>}
            </div>}
            {kind === 'dynamic' && <p className="pm-public-warning">目标地址由代理客户端逐次指定，域名由 SSH 服务器解析；无需配置固定目标主机。</p>}
            {kind !== 'dynamic' && <div className="pm-form-group"><p>{targetSide}目标服务</p><div className="pm-form-columns">
              <div className="pm-field"><Label htmlFor={`${id}-target-host`}>{targetSide}目标主机</Label>
                <AddressInput id={`${id}-target-host`} data-field="target_host" value={targetHost} maxLength={512} disabled={saving} selectLabel={`选择${targetSide}目标地址`} placeholder="IP 或域名" onValueChange={(value) => updateEndpoint('target_host', value)} aria-invalid={!!errors.target_host} aria-describedby={`${id}-target-host-hint${errors.target_host ? ` ${id}-target-host-error` : ''}`} />
                <small id={`${id}-target-host-hint`}>由{kind === 'remote' ? '本机' : 'SSH 服务器'}访问目标；127.0.0.1 指{kind === 'remote' ? '当前电脑' : 'SSH 服务器自身'}。</small>
                <span id={`${id}-target-host-error`}><InlineError message={errors.target_host} /></span>
              </div>
              <div className="pm-field"><Label htmlFor={`${id}-target-port`}>{targetSide}目标端口</Label>
                <Input id={`${id}-target-port`} data-field="target_port" type="number" min={1} max={65535} step={1} value={targetPort} onChange={(event) => updateEndpoint('target_port', event.target.value)} aria-invalid={!!errors.target_port} aria-describedby={errors.target_port ? `${id}-target-port-error` : undefined} />
                <span id={`${id}-target-port-error`}><InlineError message={errors.target_port} /></span>
              </div>
            </div></div>}
          </fieldset>
          <PortMappingFlow kind={kind} bindHost={bindHost} bindPort={bindPort} targetHost={targetHost} targetPort={targetPort} profile={profiles.find((profile) => profile.id === profileId)} />
          </div>
          <div className="pm-dialog-actions"><InlineError message={error} /><Button type="button" variant="secondary" disabled={saving} onClick={close}>取消</Button><Button type="submit" variant="secondary" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent className="port-mapping-confirm">
      <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle><AlertDialogDescription>当前映射的修改尚未保存。</AlertDialogDescription>
      <AlertDialogFooter><AlertDialogCancel>继续编辑</AlertDialogCancel><AlertDialogAction onClick={onClose}>放弃修改</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>
}
