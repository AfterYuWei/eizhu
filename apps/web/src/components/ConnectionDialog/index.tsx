import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, LoaderCircle, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { writeClipboardText } from '@/lib/clipboard'
import { ServerIcon } from '@/lib/serverIcons'
import type { ConnectionLogEntry } from '@/types/sessionMessage'
import { connectionDiagnosis, stageLabel } from './diagnostics'
import '@/styles/connection-dialog.css'

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profileName: string
  host: string
  port: number
  username: string
  icon?: string
  status: 'connecting' | 'connected' | 'error' | 'reconnecting' | 'hostkey'
  currentStage?: string
  logs?: ConnectionLogEntry[]
  errorMessage?: string
  errorCode?: string
  onCancel?: () => void
  reconnectAttempt?: number
  nextRetryAt?: number
  onReconnectNow?: () => void
  hostKeyFingerprint?: string
  knownHostKeyFingerprint?: string
  onHostKeyDecision?: (decision: 'trust_once' | 'trust_permanently' | 'reject') => void
}

// 阶段只决定视觉位置，不作为耗时或完成百分比展示。
const STAGE_PROGRESS: Record<string, number> = {
  submitting: 4,
  preparing: 12,
  credential: 20,
  connecting: 12,
  resolve: 25,
  proxy: 34,
  establishing_ssh: 44,
  host_key: 58,
  hostkey_check: 58,
  hostkey_confirm: 60,
  ssh_auth: 76,
  starting_shell: 92,
  ready: 94,
}

export function ConnectionDialog({
  open,
  onOpenChange,
  profileName,
  host,
  port,
  username,
  icon,
  status,
  currentStage,
  logs = [],
  errorMessage,
  errorCode,
  onCancel,
  reconnectAttempt,
  nextRetryAt,
  onReconnectNow,
  hostKeyFingerprint,
  knownHostKeyFingerprint,
  onHostKeyDecision,
}: ConnectionDialogProps) {
  const [now, setNow] = useState(() => Date.now())
  const [openedAt, setOpenedAt] = useState(now)
  const [progress, setProgress] = useState({ startedAt: 0, value: 0 })
  const [logsExpanded, setLogsExpanded] = useState(false)
  const [copied, setCopied] = useState<'known' | 'current' | 'diagnostics' | null>(null)
  const [copyFailure, setCopyFailure] = useState<ConnectionLogEntry | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const logsId = useId()
  const waiting = status === 'hostkey' || (status === 'connecting' && currentStage === 'hostkey_confirm')
  const changedKey = waiting && Boolean(knownHostKeyFingerprint)
  const busy = status === 'connecting' || status === 'reconnecting'
  const failed = status === 'error' || status === 'reconnecting'
  const latestLog = logs.at(-1)
  // Older snapshots used "failed" instead of retaining the last real operation.
  const stage =
    currentStage && !['failed', 'retry_wait'].includes(currentStage)
      ? currentStage
      : logs.findLast((log) => log.level !== 'error' && !['failed', 'retry_wait'].includes(log.stage))?.stage
  const diagnosis = connectionDiagnosis(errorCode)
  const startedAt = logs[0]?.at || openedAt
  const phaseProgress = waiting
    ? STAGE_PROGRESS.hostkey_confirm
    : (STAGE_PROGRESS[stage || 'submitting'] ?? 8)
  const endedAt = status === 'error' || status === 'connected' ? latestLog?.at || now : now
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000))
  const duration = seconds ? `${seconds} 秒` : '不足 1 秒'
  const remaining = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : 0
  const endpoint = `${username}@${host.includes(':') ? `[${host}]` : host}:${port}`
  const title =
    status === 'connected'
      ? '连接成功'
      : status === 'error'
        ? diagnosis.title
        : status === 'reconnecting'
          ? '连接中断，等待重连'
          : waiting
            ? changedKey
              ? '服务器身份发生变化'
              : '确认服务器身份'
            : stageLabel(stage)
  const detail = failed
    ? errorMessage || logs.findLast((log) => log.level === 'error')?.message || '未收到具体失败原因。'
    : waiting
      ? changedKey
        ? '本次主机指纹与已保存记录不同。可能是服务器重装或密钥轮换，也可能存在中间人攻击；请先通过可信渠道核对。'
        : '首次连接这台服务器。请通过可信渠道核对主机指纹，确认目标服务器身份。'
      : status === 'connected'
        ? '远程终端已经就绪。'
        : latestLog && latestLog.stage === stage
          ? latestLog.message
          : '等待连接服务返回当前操作。'

  const records = [...logs]
  let failureIndex = -1
  if (failed) {
    failureIndex = records.findLastIndex((log) => log.message === detail)
    if (failureIndex < 0) {
      failureIndex = records.length
      records.push({
        at: latestLog?.at || openedAt,
        stage: stage || 'connecting',
        level: 'error',
        message: detail,
      })
    } else {
      records[failureIndex] = { ...records[failureIndex], level: 'error' }
    }
  }
  if (changedKey && !records.some((log) => log.level === 'warn' && log.message === detail)) {
    records.push({ at: latestLog?.at || openedAt, stage: 'hostkey_confirm', level: 'warn', message: detail })
  }
  if (copyFailure) records.push(copyFailure)

  useEffect(() => {
    if (!open) return
    setProgress((current) => ({
      startedAt,
      value:
        status === 'connected'
          ? 100
          : status === 'reconnecting'
            ? 0
            : Math.min(
                96,
                current.startedAt === startedAt ? Math.max(current.value, phaseProgress) : phaseProgress,
              ),
    }))
    if (status !== 'connecting' || waiting) return
    const ceiling = Math.min(96, phaseProgress + 8)
    const timer = setInterval(
      () =>
        setProgress((current) =>
          current.value >= ceiling
            ? current
            : {
                ...current,
                value: current.value + (ceiling - current.value) * 0.04,
              },
        ),
      200,
    )
    return () => clearInterval(timer)
  }, [open, startedAt, phaseProgress, status, waiting])

  useEffect(() => {
    if (failed || changedKey) setLogsExpanded(true)
  }, [failed, changedKey])

  useEffect(() => {
    if (!open) return
    const at = Date.now()
    setNow(at)
    setOpenedAt(at)
  }, [open])
  useEffect(() => {
    if (!open || (!busy && !waiting)) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open, busy, waiting])
  useEffect(() => {
    if (!open || status !== 'connected') return
    const timer = setTimeout(() => onOpenChange(false), 700)
    return () => clearTimeout(timer)
  }, [open, status, onOpenChange])
  useEffect(() => {
    if (!open || !logsExpanded) return
    const container = logContainerRef.current
    if (container) {
      const failure = container.querySelector<HTMLElement>('[data-diagnosis="true"]')
      container.scrollTop =
        failure && !copyFailure ? failure.offsetTop - container.offsetTop : container.scrollHeight
    }
  }, [logs, logsExpanded, open, failed, copyFailure])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async (kind: 'known' | 'current' | 'diagnostics', value: string) => {
    try {
      await writeClipboardText(value)
      setCopied(kind)
      setCopyFailure(null)
    } catch {
      setCopyFailure({
        at: Date.now(),
        stage: 'clipboard',
        level: 'error',
        message: '复制失败，请手动选择并复制所需信息。',
      })
      setLogsExpanded(true)
    }
  }
  const diagnostics = [
    `服务器：${profileName}`,
    `连接：${endpoint}`,
    `状态：${title}`,
    `阶段：${stageLabel(stage)}`,
    ...(errorCode ? [`错误码：${errorCode}`] : []),
    ...(failed ? [`原因：${detail}`] : []),
    ...logs.map((log) => `${new Date(log.at).toISOString()} [${stageLabel(log.stage)}] ${log.message}`),
  ].join('\n')

  if (!open) return null
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy && !waiting) onOpenChange(false)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="connection-dialog"
        data-status={status}
        data-host-key-change={changedKey}
        onEscapeKeyDown={(event) => {
          if (busy || waiting) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (busy || waiting) event.preventDefault()
        }}
      >
        <header className="connection-dialog-header">
          <div className="connection-server-icon" aria-hidden="true">
            <ServerIcon iconKey={icon} size={18} />
          </div>
          <div className="connection-server-identity">
            <DialogTitle>{profileName}</DialogTitle>
            <DialogDescription title={endpoint}>{endpoint}</DialogDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {status === 'connected' ? '关闭' : '隐藏'}
          </Button>
        </header>

        <div className="connection-progress-wrap">
          <div
            className="connection-progress-bar"
            role="progressbar"
            aria-label="连接进度"
            aria-valuenow={status === 'connected' ? 100 : undefined}
            aria-valuetext={
              status === 'connected'
                ? '连接已完成'
                : status === 'reconnecting'
                  ? '等待重新连接'
                  : status === 'error'
                    ? '连接已停止'
                    : waiting
                      ? '等待确认主机指纹'
                      : stageLabel(stage)
            }
          >
            <span
              className="connection-progress-fill"
              aria-hidden="true"
              style={{ transform: `scaleX(${progress.value / 100})` }}
            />
          </div>
        </div>

        {!failed && (
          <main className="connection-dialog-main">
            {!waiting && (
              <section className="connection-status" aria-live="polite">
                <div className="connection-status-heading">
                  <span className="connection-status-icon" aria-hidden="true">
                    {status === 'connected' ? (
                      <Check />
                    ) : (
                      <LoaderCircle className="motion-safe:animate-spin" />
                    )}
                  </span>
                  <h2>{title}</h2>
                  <span className="connection-duration">
                    {status === 'connected' ? '耗时' : '已用'} {duration}
                  </span>
                </div>
                <p>{detail}</p>
              </section>
            )}

            {waiting && (
              <section className="connection-host-key">
                <div className="connection-section-label">
                  主机指纹 <span>SHA-256</span>
                </div>
                {!changedKey && <p className="connection-host-key-description">{detail}</p>}
                <div className="connection-fingerprints">
                  {knownHostKeyFingerprint && (
                    <div className="connection-fingerprint">
                      <span>上次保存</span>
                      <code>{knownHostKeyFingerprint}</code>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="复制历史指纹"
                        title="复制历史指纹"
                        onClick={() => void copy('known', knownHostKeyFingerprint)}
                      >
                        {copied === 'known' ? <Check /> : <Copy />}
                      </Button>
                    </div>
                  )}
                  <div className="connection-fingerprint">
                    <span>{changedKey ? '本次返回' : '服务器指纹'}</span>
                    <code>{hostKeyFingerprint || '尚未收到指纹'}</code>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="复制当前指纹"
                      title="复制当前指纹"
                      disabled={!hostKeyFingerprint}
                      onClick={() => void copy('current', hostKeyFingerprint!)}
                    >
                      {copied === 'current' ? <Check /> : <Copy />}
                    </Button>
                  </div>
                </div>
                {onHostKeyDecision && (
                  <div className="connection-actions">
                    <Button
                      size="sm"
                      variant={changedKey ? 'destructive' : 'outline'}
                      onClick={() => onHostKeyDecision('reject')}
                    >
                      {changedKey ? '拒绝并断开' : '取消连接'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onHostKeyDecision('trust_once')}>
                      仅本次信任
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={changedKey ? undefined : 'connection-primary-action'}
                      onClick={() => onHostKeyDecision('trust_permanently')}
                    >
                      {changedKey ? '更新指纹并继续' : '信任并继续'}
                    </Button>
                  </div>
                )}
              </section>
            )}

            {status === 'connecting' && !waiting && onCancel && (
              <div className="connection-actions">
                <Button size="sm" variant="outline" onClick={onCancel}>
                  取消连接
                </Button>
              </div>
            )}
          </main>
        )}

        <footer className={`connection-records${failed ? ' is-primary' : ''}`}>
          <div className="connection-records-toolbar">
            <button
              type="button"
              className="connection-records-toggle"
              onClick={() => setLogsExpanded((value) => !value)}
              aria-expanded={logsExpanded}
              aria-controls={logsId}
            >
              <SquareTerminal size={14} aria-hidden="true" />
              <span>连接记录</span>
              <small>
                {records.length}
                {failed ? ` · 耗时 ${duration}` : ''}
              </small>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <Button variant="ghost" size="sm" onClick={() => void copy('diagnostics', diagnostics)}>
              {copied === 'diagnostics' ? <Check size={14} /> : <Copy size={14} />}
              {copied === 'diagnostics' ? '已复制' : '复制诊断信息'}
            </Button>
          </div>
          {logsExpanded && (
            <div id={logsId} className="connection-live-logs" ref={logContainerRef}>
              {records.length ? (
                <ol>
                  {records.map((log, index) => (
                    <li
                      key={`${log.at}-${index}`}
                      data-level={log.level}
                      data-diagnosis={index === failureIndex}
                    >
                      <time>{new Date(log.at).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                      <div>
                        <span>
                          {stageLabel(log.stage)}
                          {log.level === 'error' ? ' · 错误' : log.level === 'warn' ? ' · 注意' : ''}
                          {index === failureIndex && errorCode && <code> · {errorCode}</code>}
                        </span>
                        <div
                          className="connection-log-message"
                          role={log.level === 'error' || log.level === 'warn' ? 'alert' : undefined}
                        >
                          {(log.level === 'error' || log.level === 'warn') && (
                            <AlertTriangle size={14} aria-hidden="true" />
                          )}
                          <p>
                            {index === failureIndex && <strong>{diagnosis.title} · </strong>}
                            {log.message}
                          </p>
                        </div>
                        {index === failureIndex && (
                          <p className="connection-log-suggestion">建议：{diagnosis.suggestion}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="connection-records-empty">尚未收到连接记录。</p>
              )}
            </div>
          )}
          {failed && (
            <div className="connection-actions connection-records-actions">
              {status === 'reconnecting' && (
                <span className="connection-retry-status">
                  {remaining ? `${remaining} 秒后重试` : '正在准备重试'}
                  {reconnectAttempt ? ` · 第 ${reconnectAttempt} 次重连` : ''}
                </span>
              )}
              {onCancel && (
                <Button size="sm" variant="outline" onClick={onCancel}>
                  取消连接
                </Button>
              )}
              {onReconnectNow && (
                <Button
                  size="sm"
                  variant="outline"
                  className="connection-primary-action"
                  onClick={onReconnectNow}
                >
                  {status === 'error' ? '重新连接' : '立即重连'}
                </Button>
              )}
            </div>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
