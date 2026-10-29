import { Loading } from '@/components/ui/loading'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, MoreHorizontal, Pencil, Server, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { vaultApi } from '@/api/vault'
import { Button } from '@/components/ui/button'
import { InlineError } from '@/components/ui/inline-error'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { writeSensitiveClipboardText } from '@/lib/clipboard'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { VAULT_TYPE_LABELS, type VaultCredential, type VaultItem, type ProfileRef } from '@/types/vault'

interface VaultDetailProps {
  item: VaultItem
  onEdit: (item: VaultItem) => void
  onDelete: (item: VaultItem, references: ProfileRef[]) => void
}
type SecretField = keyof VaultCredential

export function VaultDetail({ item, onEdit, onDelete }: VaultDetailProps) {
  const [revealed, setRevealed] = useState<Partial<VaultCredential>>({})
  const [busy, setBusy] = useState(false)
  const [refsOpen, setRefsOpen] = useState(false)
  const [references, setReferences] = useState<ProfileRef[] | null>(null)
  const [refsError, setRefsError] = useState('')
  const alive = useRef(false)
  const pending = useRef(false)
  const refsRequest = useRef(0)
  const generation = workspaceGeneration()
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const current = () => alive.current && workspaceGeneration() === generation
  const handleSecret = async (field: SecretField, copy: boolean) => {
    if (pending.current) return
    if (!copy && revealed[field] !== undefined) {
      setRevealed((values) => { const next = { ...values }; delete next[field]; return next })
      return
    }
    pending.current = true
    setBusy(true)
    try {
      const value = revealed[field] ?? (await vaultApi.reveal(item.id))[field] ?? ''
      if (!current()) return
      if (copy) {
        if (!value) { toast.warning('此凭据未保存该内容'); return }
        await writeSensitiveClipboardText(value)
        if (current()) toast.success('已复制，30 秒后自动清理剪贴板')
      } else setRevealed((values) => ({ ...values, [field]: value }))
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : '读取凭据内容失败')
    } finally {
      pending.current = false
      if (current()) setBusy(false)
    }
  }
  const loadReferences = async () => {
    const request = ++refsRequest.current
    setRefsError('')
    setReferences(null)
    try {
      const refs = await vaultApi.references(item.id)
      if (current() && request === refsRequest.current) setReferences(refs)
    } catch (error) {
      if (current() && request === refsRequest.current) setRefsError(error instanceof Error ? error.message : '加载引用失败')
    }
  }
  const requestDelete = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const refs = await vaultApi.references(item.id)
      if (current()) onDelete(item, refs)
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : '查询引用失败')
    } finally {
      pending.current = false
      if (current()) setBusy(false)
    }
  }
  const secretSection = (field: SecretField, title: string, multiline = false) => <section className="vault-detail-group" aria-label={title}>
    <div className="vault-detail-group-head">
      <span>{title}</span>
      <div className="vault-detail-content-actions">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void handleSecret(field, false)} aria-label={`${revealed[field] !== undefined ? '隐藏' : '显示'}${title}`} aria-pressed={revealed[field] !== undefined}>
          {revealed[field] !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}{revealed[field] !== undefined ? '隐藏' : '显示'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void handleSecret(field, true)} aria-label={`复制${title}`}><Copy size={14} />复制</Button>
      </div>
    </div>
    <pre className={multiline ? 'vault-detail-secret is-multiline' : 'vault-detail-secret'} aria-label={`${title}内容`}>{revealed[field] !== undefined ? revealed[field] || '未保存' : '••••••••••••••••••••••••'}</pre>
  </section>
  const date = new Date(item.updated_at)

  return <div className="vault-detail-view">
    <header className="vault-detail-heading">
      <div><h2>{item.name || '未命名'}</h2><div className="vault-detail-meta">{VAULT_TYPE_LABELS[item.type]} · {Number.isNaN(date.getTime()) ? '更新时间未知' : `${date.toLocaleDateString('zh-CN')} 更新`}</div></div>
      <div className="vault-detail-heading-actions">
        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(item)}><Pencil size={14} />编辑</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="更多凭据操作"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem disabled={busy} variant="destructive" onSelect={() => void requestDelete()}><Trash2 size={14} />删除凭据</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    {item.type === 'password' && <div className="vault-detail-note"><span>用户名</span>{item.username || '需补充用户名'}</div>}
    {item.remark && <div className="vault-detail-note"><span>备注</span>{item.remark}</div>}
    {secretSection(item.type === 'password' ? 'password' : 'private_key', item.type === 'password' ? '密码' : '私钥', item.type === 'private_key')}
    {item.type === 'private_key' && secretSection('public_key', '公钥', true)}
    {item.has_passphrase && secretSection('passphrase', '私钥口令')}
    <section className="vault-detail-group vault-reference-group">
      <button type="button" className="vault-reference-toggle" aria-expanded={refsOpen} aria-controls={`vault-references-${item.id}`} onClick={() => { if (!refsOpen) void loadReferences(); setRefsOpen(!refsOpen) }}>
        <span>关联连接</span><span>{item.ref_count > 0 ? `${item.ref_count} 个连接` : '未引用'}{refsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
      </button>
      {refsOpen && <div id={`vault-references-${item.id}`} className="vault-reference-list">
        {refsError ? <div className="vault-reference-row"><InlineError message={refsError}/><Button type="button" variant="ghost" size="sm" onClick={() => void loadReferences()}>重试</Button></div> : references === null ? <Loading className="min-h-12" /> : references.length === 0 ? <p>暂无连接引用此凭据</p> : references.map((ref) => <div className="vault-reference-row" key={ref.id}><Server size={16} aria-hidden="true" /><span>{ref.name || '未命名连接'}</span></div>)}
      </div>}
    </section>
  </div>
}
