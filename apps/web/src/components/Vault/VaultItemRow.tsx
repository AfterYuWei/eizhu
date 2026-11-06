import { ItemSyncBadge } from '@/components/SyncIndicator'
import { VAULT_TYPE_LABELS, type VaultItem } from '@/types/vault'
import { VAULT_TYPE_ICONS } from '@/lib/vaultIcons'
import { cn } from '@/lib/utils'

interface VaultItemRowProps {
  item: VaultItem
  selected: boolean
  disabled?: boolean
  onSelect: (item: VaultItem) => void
}

export function VaultItemRow({ item, selected, disabled, onSelect }: VaultItemRowProps) {
  const Icon = VAULT_TYPE_ICONS[item.type]
  const date = new Date(item.updated_at)
  const updated = Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  return <div className={cn('vault-list-entry', selected && 'is-selected')}>
    <button type="button" className="vault-list-item" data-vault-item={item.id} aria-pressed={selected} disabled={disabled} onClick={() => onSelect(item)}>
      <Icon size={16} aria-hidden="true" />
      <span className="vault-list-item-copy">
        <span className="vault-list-item-name">{item.name || '未命名'}</span>
        <span className="vault-list-item-meta"><span>{VAULT_TYPE_LABELS[item.type]} · {item.ref_count > 0 ? `引用 ${item.ref_count}` : '未引用'}</span><time dateTime={item.updated_at}>{updated}</time></span>
      </span>
    </button>
    <ItemSyncBadge type="vault" id={item.id} />
  </div>
}
