import { Loading } from '@/components/ui/loading'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, KeyRound, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useVaultStore } from '@/store/vault'
import { useWorkspaceViewStore } from '@/store/workspaceView'
import { toast } from 'sonner'
import { VaultList } from './VaultList'
import { VaultDetail } from './VaultDetail'
import { VaultForm, type VaultEditorState } from './VaultFormDialog'
import { VaultGenerateDialog } from './VaultGenerateDialog'
import type { VaultItem, ProfileRef } from '@/types/vault'

const FILTER_OPTIONS = [{ value: 'all', label: '全部' }, { value: 'password', label: '密码' }, { value: 'private_key', label: '私钥' }] as const
interface DeleteTarget { item: VaultItem; refs: ProfileRef[] }

export function VaultView() {
  const { items, loading, error, focusedItemId, filterType, searchQuery, setFilterType, setSearchQuery, fetchList, remove } = useVaultStore()
  const active = useWorkspaceViewStore((state) => state.activePage === 'vault')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorInstance, setEditorInstance] = useState(0)
  const [editing, setEditing] = useState<VaultItem | null>(null)
  const [editorState, setEditorState] = useState<VaultEditorState>({ dirty: false, busy: false })
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const lastFocused = useRef<string | null>(null)
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  useEffect(() => { void fetchList() }, [fetchList])
  const finishEditing = useCallback(() => {
    setEditorOpen(false)
    setEditing(null)
    setEditorState({ dirty: false, busy: false })
  }, [])
  const afterEditing = useCallback((action: () => void) => {
    if (editorState.busy) return
    const next = () => { finishEditing(); action() }
    if (editorOpen && editorState.dirty) setPendingAction(() => next)
    else next()
  }, [editorOpen, editorState, finishEditing])
  useEffect(() => {
    if (focusedItemId === lastFocused.current) return
    lastFocused.current = focusedItemId
    if (focusedItemId) afterEditing(() => setSelectedId(focusedItemId))
  }, [focusedItemId, afterEditing])

  const startEditor = (item: VaultItem | null) => afterEditing(() => { setEditing(item); setEditorInstance((value) => value + 1); setEditorOpen(true) })
  const handleSaved = (saved: VaultItem) => {
    finishEditing()
    setSelectedId(saved.id)
    if (searchQuery || filterType !== 'all') {
      useVaultStore.setState({ searchQuery: '', filterType: 'all' })
      void fetchList()
    }
  }
  const confirmDelete = async () => {
    if (!deleteTarget || deleteTarget.refs.length > 0 || deleting) return
    setDeleting(true)
    try { await remove(deleteTarget.item.id); setDeleteTarget(null) }
    catch (error) { toast.error(error instanceof Error ? error.message : '删除失败') }
    finally { setDeleting(false) }
  }

  return <div className="vault-view vault-master-detail">
    <div className="vault-toolbar">
      <span className="vault-toolbar-title"><KeyRound size={16} aria-hidden="true" />密钥管理</span>
      <div className="vault-toolbar-filter">
        <Select value={filterType} onValueChange={(value) => afterEditing(() => setFilterType(value as typeof filterType))} disabled={editorState.busy}>
          <SelectTrigger className="w-full" aria-label="凭据类型"><SelectValue placeholder="请选择" /></SelectTrigger>
          <SelectContent>{FILTER_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Input type="search" aria-label="搜索凭据" className="vault-toolbar-search" placeholder="搜索名称/用户名/备注…" value={searchQuery} disabled={editorState.busy} onChange={(event) => { const value = event.target.value; afterEditing(() => setSearchQuery(value)) }} />
      <div className="vault-toolbar-actions">
        <Button type="button" variant="outline" size="sm" disabled={editorState.busy} onClick={() => afterEditing(() => setGenOpen(true))}><KeyRound size={14} />生成密钥对</Button>
        <Button type="button" variant="outline" size="sm" disabled={editorState.busy} onClick={() => startEditor(null)}><Plus size={14} />新建凭据</Button>
      </div>
    </div>
    <div className="vault-columns">
      <aside className="vault-list-panel" aria-label="凭据列表区域">
        <VaultList selectedId={selected?.id ?? null} disabled={editorState.busy} onSelect={(item) => afterEditing(() => setSelectedId(item.id))} onCreate={() => startEditor(null)} />
      </aside>
      <section className="vault-inspector" aria-label={editorOpen ? '编辑凭据' : '凭据详情'}>
        {editorOpen ? <div className="vault-inline-editor">
          <header className="vault-detail-heading"><h2>{editing ? '编辑凭据' : '新建凭据'}</h2></header>
          <VaultForm key={editorInstance} item={editing} onStateChange={setEditorState} onOpenChange={(open) => { if (!open) afterEditing(() => {}) }} onSaved={handleSaved} />
        </div> : selected && !error ? active && <VaultDetail key={`${selected.id}:${selected.updated_at}`} item={selected} onEdit={startEditor} onDelete={(item, refs) => setDeleteTarget({ item, refs })} /> : loading ? <Loading /> : <div className="vault-detail-placeholder">选择凭据以查看详情</div>}
      </section>
    </div>
    <VaultGenerateDialog open={genOpen} onOpenChange={setGenOpen} />
    <AlertDialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle><AlertDialogDescription>当前凭据的修改尚未保存。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>继续编辑</AlertDialogCancel><AlertDialogAction onClick={() => { pendingAction?.(); setPendingAction(null) }}>放弃修改</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{deleteTarget && deleteTarget.refs.length > 0 ? '无法删除' : '确认删除'}</DialogTitle></DialogHeader>
        {deleteTarget && deleteTarget.refs.length > 0 ? <>
          <div className="vault-delete-refs"><div className="vault-delete-refs-title"><AlertTriangle size={14} aria-hidden="true" />该凭据被以下连接引用，无法删除</div><ul className="vault-delete-refs-list">{deleteTarget.refs.map((ref) => <li key={ref.id}>{ref.name}</li>)}</ul></div>
          <div className="pf-footer"><Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>知道了</Button></div>
        </> : <>
          <p>确认删除凭据「{deleteTarget?.item.name || '未命名'}」？此操作不可撤销。</p>
          <div className="pf-footer"><Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button><Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? '删除中…' : '删除'}</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </div>
}
