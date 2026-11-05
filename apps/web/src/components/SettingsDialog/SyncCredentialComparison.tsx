import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { normalizeCommandError } from '@eizhu/contracts'
import type { SyncConflict, SyncConflictCredentials, SyncRevealCredentials } from '@eizhu/contracts'
import { Button } from '@/components/ui/button'
import { SYNC_CREDENTIAL_FIELD_LABELS } from '@/lib/syncMerge'

/** Mounted only for the visible conflict. Leaving it drops both revealed values and pending results. */
export function SyncCredentialComparison({
  conflict,
  busy,
  revealCredentials,
}: {
  conflict: SyncConflict
  busy: boolean
  revealCredentials: (input: SyncRevealCredentials) => Promise<SyncConflictCredentials>
}) {
  const [values, setValues] = useState<SyncConflictCredentials | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const fields = (['password', 'private_key', 'public_key', 'passphrase', 'proxy_password'] as const).filter(
    (field) =>
      [conflict.local, conflict.remote].some((summary) => summary?.credential_fields?.includes(field)),
  )
  if (!fields.length) return null
  async function reveal() {
    if (loading || busy || (conflict.itemType !== 'vault' && conflict.itemType !== 'profile')) return
    const version = ++request.current
    setLoading(true)
    setError('')
    try {
      const next = await revealCredentials({
        itemType: conflict.itemType,
        itemId: conflict.itemId,
        localRevision: conflict.localRevision,
        remoteRevision: conflict.remoteRevision,
        remoteSource: conflict.remoteSource ?? 'cloud',
      })
      if (version === request.current) setValues(next)
    } catch (cause) {
      if (version === request.current) setError(normalizeCommandError(cause).error.message)
    } finally {
      if (version === request.current) setLoading(false)
    }
  }
  return (
    <div className="sync-credential-comparison">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || loading}
        aria-expanded={Boolean(values)}
        onClick={() => (values ? setValues(null) : void reveal())}
      >
        {values ? <EyeOff size={13} /> : <Eye size={13} />}
        {loading ? '正在读取…' : values ? '隐藏双方凭据' : '查看双方凭据'}
      </Button>
      {error && (
        <p className="sync-conflict-error" role="alert">
          {error}
        </p>
      )}
      {values && (
        <div className="sync-credential-values">
          {(['local', 'remote'] as const).map((side) => (
            <section
              key={side}
              aria-label={`${side === 'local' ? '本机' : conflict.remoteSource === 'offline' ? '离线副本' : '云端'}凭据内容`}
            >
              <h3>{side === 'local' ? '本机' : conflict.remoteSource === 'offline' ? '离线副本' : '云端'}</h3>
              {fields.map((field) => (
                <div className="sync-conflict-result-field" key={field}>
                  <span>{SYNC_CREDENTIAL_FIELD_LABELS[field]}</span>
                  <pre>{values[side]?.[field] || '未设置'}</pre>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
