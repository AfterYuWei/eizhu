import { KeyRound,AlertCircle,Plus } from 'lucide-react'
import { useEffect,useRef } from 'react'
import { useVaultStore } from '@/store/vault'
import { VaultItemRow } from './VaultItemRow'
import { Button } from '@/components/ui/button'
import type { VaultItem } from '@/types/vault'

interface VaultListProps {
  selectedId: string | null
  disabled?: boolean
  onSelect: (item: VaultItem) => void
  onCreate: () => void
}

export function VaultList({ selectedId, disabled, onSelect, onCreate }: VaultListProps) {
  const { items, loading, error, fetchList, focusedItemId, searchQuery, filterType } = useVaultStore()
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusedItemId || loading) return
    const target = [...(grid.current?.querySelectorAll<HTMLElement>('[data-vault-item]') ?? [])].find((element) => element.dataset.vaultItem === focusedItemId)
    target?.scrollIntoView?.({ block: 'center' })
    target?.focus({ preventScroll: true })
  }, [focusedItemId, loading, items])

  // 加载态
  if (loading && items.length === 0) {
    return (
      <div className="vault-loading" role="status">
        <div className="vault-spinner" />
        <div className="vault-empty-desc">加载中…</div>
      </div>
    )
  }

  // 错误态
  if (error) {
    return (
      <div className="vault-error" role="alert">
        <AlertCircle size={28} className="vault-error-icon" />
        <div className="vault-error-title">加载失败</div>
        <div className="vault-error-desc">{error}</div>
        <Button type="button" variant="outline" size="sm" onClick={() => fetchList()}>
          重试
        </Button>
      </div>
    )
  }

  // 空态
  if (items.length === 0) {
    return (
      <div className="vault-empty">
        <KeyRound size={28} className="vault-empty-icon" />
        <div className="vault-empty-title">{searchQuery || filterType !== 'all' ? '没有匹配的凭据' : '暂无凭据'}</div>
        <div className="vault-empty-desc">创建密码或私钥以辅助服务器登录</div>
        <Button type="button" size="sm" onClick={onCreate} className="pf-btn-submit">
          <Plus size={14} /> 新建凭据
        </Button>
      </div>
    )
  }

  // 正常态
  return (
    <div className="vault-list-content" ref={grid} aria-busy={loading}>
      <div className="vault-list-items" aria-label="凭据列表">
        {items.map((item) => <VaultItemRow key={item.id} item={item} selected={selectedId === item.id} disabled={disabled} onSelect={onSelect} />)}
      </div>
      <div className="vault-list-count" aria-live="polite">{items.length} 项凭据</div>
    </div>
  )
}
