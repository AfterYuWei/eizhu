import { useEffect, useRef, useState } from 'react'
import { Check, Circle, Copy, X } from 'lucide-react'
import { normalizeCommandError, SYNC_MERGE_FIELDS } from '@eizhu/contracts'
import type {
  SyncConflict,
  SyncMergeField,
  SyncResolution,
  SyncResolveBatch,
  SyncRevealCredentials,
  SyncConflictCredentials,
} from '@eizhu/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { syncApi } from '@/api/sync'
import { vaultApi } from '@/api/vault'
import { useSyncStore } from '@/store/sync'
import { useProfileStore } from '@/store/profile'
import { useAccountStore } from '@/store/account'
import { conflictDependencies } from '@/lib/syncExperience'
import {
  SYNC_FIELD_LABELS,
  SYNC_CREDENTIAL_FIELD_LABELS,
  syncChangedFields,
  syncResolutionLabel,
  syncCredentialDescription,
} from '@/lib/syncMerge'
import { SYNC_ITEM_LABELS } from '@/types/sync'
import { SyncCredentialComparison } from './SyncCredentialComparison'

type Draft = { choice: SyncResolution['choice']; fields: NonNullable<SyncResolution['fields']> }
type Staged = { conflict: SyncConflict; resolution: SyncResolution }
const keyOf = (c: Pick<SyncConflict, 'itemType' | 'itemId'>) => `${c.itemType}:${c.itemId}`
const emptyDraft: Draft = { choice: 'merge', fields: {} }

export function SyncConflictDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const { conflicts, focusItem } = useSyncStore()
  const groups = useProfileStore((s) => s.groups),
    profiles = useProfileStore((s) => s.profiles)
  const enabled = useAccountStore((s) => s.status?.syncEnabled ?? false)
  const [vaultNames, setVaultNames] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let active = true
    void vaultApi
      .list()
      .then((items) => {
        if (active) {
          setVaultNames(Object.fromEntries(items.map((item) => [item.id, item.name])))
          setLoadError(null)
        }
      })
      .catch(() => {
        if (active) setLoadError('凭据名称读取失败，关联条目暂时显示标识。')
      })
    return () => {
      active = false
    }
  }, [open])
  return (
    <SyncConflictWorkbench
      open={open}
      onOpenChange={(value) => {
        if (!value) useSyncStore.setState({ focusItem: null })
        onOpenChange(value)
      }}
      conflicts={conflicts}
      focusItem={focusItem}
      groups={groups}
      profiles={profiles}
      enabled={enabled}
      vaultNames={vaultNames}
      loadError={loadError}
      revealCredentials={syncApi.revealConflictCredentials}
      resolveConflicts={async (input) => {
        try {
          await syncApi.resolveConflicts(input)
        } finally {
          await useSyncStore.getState().refresh()
        }
      }}
    />
  )
}

/** Both live and mock dialogs provide their own data and effects; this view owns only local choices. */
export function SyncConflictWorkbench({
  open,
  onOpenChange,
  conflicts,
  focusItem,
  groups,
  profiles,
  enabled,
  vaultNames,
  loadError,
  revealCredentials,
  resolveConflicts,
  mock = false,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  conflicts: SyncConflict[]
  focusItem: { type: string; id: string } | null
  groups: readonly { id: string; name: string }[]
  profiles: readonly { id: string; name: string }[]
  enabled: boolean
  vaultNames: Record<string, string>
  loadError?: string | null
  revealCredentials: (input: SyncRevealCredentials) => Promise<SyncConflictCredentials>
  resolveConflicts: (input: SyncResolveBatch) => Promise<void>
  mock?: boolean
}) {
  const [selected, setSelected] = useState<{ key: string; focus: typeof focusItem } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [staged, setStaged] = useState<Record<string, Staged>>({})
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState('')
  const lock = useRef(false)
  const focused = focusItem ? `${focusItem.type}:${focusItem.id}` : null
  const selectedKey = selected?.focus === focusItem ? selected.key : null
  const current =
    conflicts.find((c) => keyOf(c) === selectedKey) ??
    conflicts.find((c) => keyOf(c) === focused) ??
    conflicts[0]
  const currentKey = current ? keyOf(current) : ''
  const draft = drafts[currentKey] ?? emptyDraft
  const changed = current ? syncChangedFields(current) : []
  const canMerge = current && !current.localDeleted && !current.remoteDeleted
  const complete =
    draft.choice !== 'merge' ||
    (canMerge && changed.length > 0 && changed.every((field) => draft.fields[field]))
  const stagedEntries = Object.values(staged)
  const stale = stagedEntries.some(
    (entry) =>
      !conflicts.some(
        (c) =>
          keyOf(c) === keyOf(entry.conflict) &&
          c.localRevision === entry.conflict.localRevision &&
          c.remoteRevision === entry.conflict.remoteRevision &&
          c.remoteSource === entry.conflict.remoteSource,
      ),
  )
  function sourceName(c: SyncConflict) {
    return c.remoteSource === 'offline' ? '离线副本' : '云端'
  }
  function display(c: SyncConflict, field: SyncMergeField, side: 'local' | 'cloud'): string {
    const value = side === 'local' ? c.local : c.remote
    if (field === 'credential_changed') return syncCredentialDescription(value, vaultNames)
    if (field === 'options_changed')
      return value?.jump_profile_id
        ? `跳板：${profiles.find((p) => p.id === value.jump_profile_id)?.name ?? value.jump_profile_id}`
        : `${side === 'local' ? '本机' : sourceName(c)}高级配置`
    const raw = value?.[field]
    if ((field === 'group_id' || field === 'parent_id') && typeof raw === 'string')
      return groups.find((g) => g.id === raw)?.name ?? raw
    if (raw === undefined || raw === null || raw === '') return '未设置'
    if (Array.isArray(raw)) return raw.join('、') || '未设置'
    if (typeof raw === 'boolean') return raw ? '是' : '否'
    return String(raw)
  }
  function change(next: Draft) {
    setDrafts((previous) => ({ ...previous, [currentKey]: next }))
    setStaged((previous) => {
      const rest = { ...previous }
      delete rest[currentKey]
      return rest
    })
    setError(null)
    setMessage('')
  }
  function result(c: SyncConflict, resolution: Draft) {
    if (resolution.choice === 'keep_both') {
      const suffix = '（云端副本）'
      return (
        <>
          <p className="sync-conflict-result-note">{syncResolutionLabel(c, resolution.choice)}</p>
          <div className="sync-conflict-result-field">
            <span>新增副本</span>
            <span>
              {(c.remote?.name ?? c.name).slice(0, 512 - suffix.length)}
              {suffix}
            </span>
          </div>
        </>
      )
    }
    const side =
      resolution.choice === 'keep_local' ? 'local' : resolution.choice === 'use_cloud' ? 'cloud' : null
    if (side && (side === 'local' ? c.localDeleted : c.remoteDeleted))
      return (
        <p className="sync-conflict-result-note sync-conflict-danger">
          {syncResolutionLabel(c, resolution.choice)}
        </p>
      )
    return syncChangedFields(c).map((field) => (
      <div className="sync-conflict-result-field" key={field}>
        <span>{SYNC_FIELD_LABELS[field]}</span>
        <span>
          {side
            ? `${field === 'credential_changed' ? `采用${side === 'local' ? '本机' : sourceName(c)}凭据\n` : ''}${display(c, field, side)}`
            : resolution.fields[field]
              ? `${field === 'credential_changed' ? `采用${resolution.fields[field] === 'local' ? '本机' : sourceName(c)}凭据\n` : ''}${display(c, field, resolution.fields[field])}`
              : '待选择'}
        </span>
      </div>
    ))
  }
  function stage() {
    if (!current || !complete) return
    const resolution: SyncResolution = {
      itemType: current.itemType,
      itemId: current.itemId,
      remoteRevision: current.remoteRevision,
      remoteSource: current.remoteSource ?? 'cloud',
      choice: draft.choice,
      ...(draft.choice === 'merge' ? { fields: { ...draft.fields } } : {}),
    }
    const next = { ...staged, [currentKey]: { conflict: current, resolution } }
    setStaged(next)
    const pending = conflicts.find((c) => !next[keyOf(c)])
    if (pending) setSelected({ key: keyOf(pending), focus: focusItem })
    setMessage(`已暂存“${current.name}”的选择，尚未修改数据。`)
  }
  async function apply() {
    if (lock.current || stale || !stagedEntries.length) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await resolveConflicts({
        localRevision: stagedEntries[0].conflict.localRevision,
        resolutions: stagedEntries.map((entry) => entry.resolution),
      })
      setMessage(
        mock
          ? `已模拟应用 ${stagedEntries.length} 项选择，仅更新当前弹窗内的示例。`
          : `已应用 ${stagedEntries.length} 项选择。${enabled ? '待提交变更将继续同步。' : '自动同步仍已暂停，需上传的修改保留在本机队列。'}`,
      )
      setStaged({})
      setDrafts({})
      setPreview(false)
    } catch (cause) {
      const failure = normalizeCommandError(cause)
      setError(failure.error.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function close(value: boolean) {
    if (lock.current) return
    if (!value) {
      setPreview(false)
    }
    onOpenChange(value)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="sync-conflict-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (lock.current) event.preventDefault()
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <Button
          size="icon"
          variant="ghost"
          className="sync-conflict-close"
          aria-label="关闭合并工作台"
          disabled={busy}
          onClick={() => close(false)}
        >
          <X size={16} />
        </Button>
        <div className="sync-conflict-heading">
          <DialogTitle>
            {preview ? '确认合并结果' : '合并工作台'}
            {mock ? ' · Mock' : ''}
          </DialogTitle>
          <DialogDescription>
            {mock ? (
              '仅演示冲突选择，所有示例只存在于此弹窗，不写入或同步。'
            ) : (
              <>
                {preview ? '确认后统一应用至本机。' : '逐字段选择，暂存后统一应用。'}
                {enabled ? '自动同步已开启。' : '自动同步已暂停。'}
              </>
            )}
          </DialogDescription>
        </div>
        {(error || loadError || message || stale) && (
          <div className="sync-conflict-feedback" role={error || stale ? 'alert' : 'status'}>
            {error && <p className="sync-conflict-error">{error}</p>}
            {loadError && <p className="sync-conflict-error">{loadError}</p>}
            {stale && <p className="sync-conflict-error">数据已变化，请重新查看并暂存选择。</p>}
            {message && <p>{message}</p>}
          </div>
        )}
        <div className="sync-conflict-body">
          {preview ? (
            <div className="sync-conflict-preview">
              {stagedEntries.map(({ conflict: c, resolution }) => (
                <section key={keyOf(c)}>
                  <h3>
                    {c.name}
                    <span
                      className={
                        (resolution.choice === 'keep_local' && c.localDeleted) ||
                        (resolution.choice === 'use_cloud' && c.remoteDeleted)
                          ? 'sync-conflict-danger'
                          : undefined
                      }
                    >
                      {SYNC_ITEM_LABELS[c.itemType]} · {syncResolutionLabel(c, resolution.choice)}
                    </span>
                  </h3>
                  <div className="sync-conflict-preview-fields">
                    {result(c, { choice: resolution.choice, fields: resolution.fields ?? {} })}
                  </div>
                </section>
              ))}
            </div>
          ) : current ? (
            <div className="sync-conflict-workspace">
              <nav className="sync-conflict-list" aria-label="冲突条目">
                <div className="sync-conflict-list-heading">
                  <span>冲突条目</span>
                  <span>{conflicts.length}</span>
                </div>
                {conflicts.map((c) => (
                  <Tooltip key={keyOf(c)}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        aria-pressed={keyOf(c) === currentKey}
                        onClick={() => {
                          setSelected({ key: keyOf(c), focus: focusItem })
                          setError(null)
                        }}
                      >
                        <span className="sync-conflict-item-line">
                          <span className="sync-conflict-item-name">{c.name}</span>
                          {staged[keyOf(c)] ? <Check size={13} aria-label="已暂存" /> : null}
                        </span>
                        <small>
                          {SYNC_ITEM_LABELS[c.itemType]}
                          {staged[keyOf(c)] ? ' · 已暂存' : ''}
                        </small>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{c.name}</TooltipContent>
                  </Tooltip>
                ))}
              </nav>
              <section className="sync-conflict-detail" aria-label="字段差异">
                <div>
                  <h3>{current.name}</h3>
                  <p className="sync-conflict-help">
                    {current.localDeleted || current.remoteDeleted
                      ? '删除与修改冲突 · 选择保留的版本'
                      : current.reason === 'dependency'
                        ? '关联关系需要一并核对'
                        : `${changed.length} 个字段存在差异`}
                  </p>
                </div>
                {canMerge && (
                  <div className="sync-conflict-shortcuts">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-pressed={draft.choice === 'keep_local'}
                      onClick={() => change({ choice: 'keep_local', fields: {} })}
                    >
                      {draft.choice === 'keep_local' && <Check size={13} />}
                      整条用本机
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-pressed={draft.choice === 'use_cloud'}
                      onClick={() => change({ choice: 'use_cloud', fields: {} })}
                    >
                      {draft.choice === 'use_cloud' && <Check size={13} />}
                      整条用{sourceName(current)}
                    </Button>
                    {current.itemType === 'profile' && canMerge && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-pressed={draft.choice === 'keep_both'}
                        onClick={() => change({ choice: 'keep_both', fields: {} })}
                      >
                        {draft.choice === 'keep_both' ? <Check size={13} /> : <Copy size={13} />}
                        保留双方
                      </Button>
                    )}
                  </div>
                )}
                {canMerge ? (
                  changed.map((field) => (
                    <div className="sync-conflict-field" key={field}>
                      <span className="sync-conflict-field-label">{SYNC_FIELD_LABELS[field]}</span>
                      {field === 'credential_changed' && (
                        <p className="sync-conflict-help">
                          差异：
                          {current.local?.credential_differences
                            ?.map((key) => SYNC_CREDENTIAL_FIELD_LABELS[key])
                            .join('、') || '凭据内容'}
                          。 密码等内容默认隐藏；修改时间仅供参考，不代表凭据一定有效。
                        </p>
                      )}
                      <div className="sync-conflict-options">
                        {(['local', 'cloud'] as const).map((side) => {
                          const selected =
                            draft.choice === (side === 'local' ? 'keep_local' : 'use_cloud') ||
                            (draft.choice === 'merge' && draft.fields[field] === side)
                          return (
                            <Button
                              key={side}
                              variant="ghost"
                              disabled={busy}
                              aria-label={`${SYNC_FIELD_LABELS[field]}：采用${side === 'local' ? '本机' : sourceName(current)}`}
                              aria-pressed={selected}
                              onClick={() => {
                                const fields = { ...draft.fields }
                                if (draft.choice === 'keep_local' || draft.choice === 'use_cloud')
                                  for (const changedField of changed)
                                    fields[changedField] = draft.choice === 'keep_local' ? 'local' : 'cloud'
                                fields[field] = side
                                change({ choice: 'merge', fields })
                              }}
                            >
                              <span className="sync-conflict-source">
                                {selected ? (
                                  <Check className="sync-conflict-radio" />
                                ) : (
                                  <Circle className="sync-conflict-radio" />
                                )}
                                {side === 'local' ? '本机' : sourceName(current)}
                              </span>
                              <span>{display(current, field, side)}</span>
                            </Button>
                          )
                        })}
                      </div>
                      {field === 'credential_changed' && open && (
                        <SyncCredentialComparison
                          key={`${currentKey}:${current.localRevision}:${current.remoteRevision}:${current.remoteSource}`}
                          conflict={current}
                          busy={busy}
                          revealCredentials={revealCredentials}
                        />
                      )}
                    </div>
                  ))
                ) : (
                  <>
                    <div className="sync-conflict-deletion">
                      {(['local', 'cloud'] as const).map((side) => {
                        const deleted = side === 'local' ? current.localDeleted : current.remoteDeleted
                        const summary = side === 'local' ? current.local : current.remote
                        const choice = side === 'local' ? 'keep_local' : 'use_cloud'
                        const label = deleted
                          ? side === 'local'
                            ? '保留本机删除'
                            : `采用${sourceName(current)}删除`
                          : side === 'local'
                            ? '保留本机条目'
                            : `恢复${sourceName(current)}条目`
                        const fields: readonly SyncMergeField[] =
                          current.itemType === 'snippet'
                            ? ['content', 'description']
                            : current.itemType === 'profile'
                              ? ['host', 'port', 'username', 'note']
                              : current.itemType === 'group'
                                ? ['name', 'parent_id']
                                : ['name', 'username', 'remark']
                        return (
                          <Button
                            key={side}
                            variant="ghost"
                            className="sync-conflict-deletion-option"
                            data-deleted={deleted}
                            disabled={busy}
                            aria-label={label}
                            aria-pressed={draft.choice === choice}
                            onClick={() => change({ choice, fields: {} })}
                          >
                            <span className="sync-conflict-source">
                              {draft.choice === choice ? (
                                <Check className="sync-conflict-radio" />
                              ) : (
                                <Circle className="sync-conflict-radio" />
                              )}
                              {side === 'local' ? '本机' : sourceName(current)}
                              <span className="sync-conflict-version-state">
                                {deleted ? '已删除' : '保留修改'}
                              </span>
                            </span>
                            <span className="sync-conflict-deletion-title">{label}</span>
                            {deleted ? (
                              <span className="sync-conflict-deletion-empty">
                                不恢复此条目，保留删除结果。
                              </span>
                            ) : (
                              <span className="sync-conflict-version-fields">
                                {fields
                                  .filter((field) => summary?.[field] !== undefined && summary[field] !== '')
                                  .map((field) => (
                                    <span className="sync-conflict-version-field" key={field}>
                                      <span>{SYNC_FIELD_LABELS[field]}</span>
                                      <span>{display(current, field, side)}</span>
                                    </span>
                                  ))}
                                {(current.itemType === 'vault' || current.itemType === 'profile') && (
                                  <span className="sync-conflict-version-field">
                                    <span>认证与凭据</span>
                                    <span>{display(current, 'credential_changed', side)}</span>
                                  </span>
                                )}
                              </span>
                            )}
                            <span className="sync-conflict-choice-state">
                              {draft.choice === choice ? (
                                <>
                                  <Check size={13} />
                                  已选择
                                </>
                              ) : deleted ? (
                                '选择删除结果'
                              ) : (
                                '选择恢复版本'
                              )}
                            </span>
                          </Button>
                        )
                      })}
                    </div>
                    {open && (current.itemType === 'vault' || current.itemType === 'profile') && (
                      <SyncCredentialComparison
                        key={`${currentKey}:${current.localRevision}:${current.remoteRevision}:${current.remoteSource}`}
                        conflict={current}
                        busy={busy}
                        revealCredentials={revealCredentials}
                      />
                    )}
                  </>
                )}
                {canMerge && (
                  <details>
                    <summary>查看相同字段</summary>
                    {(SYNC_MERGE_FIELDS[current.itemType] as readonly SyncMergeField[])
                      .filter(
                        (field) =>
                          !changed.includes(field) &&
                          !field.endsWith('_changed') &&
                          current.local?.[field] !== undefined,
                      )
                      .map((field) => (
                        <div className="sync-conflict-same" key={field}>
                          <span>{SYNC_FIELD_LABELS[field]}</span>
                          <span>{display(current, field, 'local')}</span>
                        </div>
                      ))}
                  </details>
                )}
                {(current.itemType === 'vault' || current.itemType === 'profile') && (
                  <p className="sync-conflict-help">
                    认证与凭据按整组选择。查看仅用于核对，暂存并应用后才会采用所选内容。
                  </p>
                )}
                {!!conflictDependencies(current).length && (
                  <div className="sync-conflict-dependencies">
                    <span>关联条目</span>
                    {conflictDependencies(current).map((dep) => {
                      const target = conflicts.find((c) => c.itemType === dep.type && c.itemId === dep.id)
                      const name =
                        target?.name ??
                        (dep.type === 'group'
                          ? groups.find((g) => g.id === dep.id)?.name
                          : dep.type === 'vault'
                            ? vaultNames[dep.id]
                            : profiles.find((p) => p.id === dep.id)?.name) ??
                        dep.id
                      return (
                        <Button
                          key={`${dep.type}:${dep.id}`}
                          size="sm"
                          variant="link"
                          disabled={!target || busy}
                          onClick={() => {
                            if (target) setSelected({ key: keyOf(target), focus: focusItem })
                          }}
                        >
                          {name}
                          {target ? ' · 处理关联冲突' : ''}
                        </Button>
                      )
                    })}
                  </div>
                )}
              </section>
              <aside className="sync-conflict-result" aria-label="合并结果">
                <div className="sync-conflict-result-heading">
                  <h3>合并结果</h3>
                  <span>{staged[currentKey] ? '已暂存' : complete ? '待暂存' : '待选择'}</span>
                </div>
                {result(current, draft)}
                <p className="sync-conflict-help">暂存不会立即修改或上传数据。</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !complete || Boolean(staged[currentKey])}
                  onClick={stage}
                >
                  {staged[currentKey] ? (
                    <>
                      <Check size={13} />
                      已暂存
                    </>
                  ) : (
                    '暂存此项'
                  )}
                </Button>
              </aside>
            </div>
          ) : (
            <div className="sync-conflict-empty">
              <Check size={20} />
              <h3>本次冲突已处理</h3>
              <p>{mock ? '关闭后丢弃示例，下次打开重新开始。' : '关闭窗口后可在云同步页查看待同步状态。'}</p>
            </div>
          )}
        </div>
        <footer className="sync-conflict-footer">
          <p aria-live="polite">
            {conflicts.length ? (
              <>
                已暂存 {stagedEntries.length} / {conflicts.length} 项 · 尚未应用
              </>
            ) : (
              '本次冲突已处理'
            )}
          </p>
          <div>
            {preview ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setPreview(false)}>
                  返回修改
                </Button>
                <Button disabled={busy || stale || !stagedEntries.length} onClick={() => void apply()}>
                  {busy ? '正在应用…' : mock ? '模拟应用' : '应用至本机'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => close(false)}>
                  {conflicts.length ? '稍后处理' : '完成'}
                </Button>
                {!!conflicts.length && (
                  <Button disabled={!stagedEntries.length || stale || busy} onClick={() => setPreview(true)}>
                    预览已选（{stagedEntries.length}）
                  </Button>
                )}
              </>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
