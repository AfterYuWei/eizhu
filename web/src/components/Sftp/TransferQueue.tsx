import { useState, useRef } from 'react'
import {
  ArrowUp,
  ArrowDown,
  X,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Copy,
  Pause,
  Play,
  RotateCcw,
  Save,
} from 'lucide-react'
import { useSftpStore } from './storeContext'
import { Button } from '@/components/ui/button'
import { sftpApi } from '@/api/sftp'
import { normalizeCommandError } from '@/api/tauri'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import type { TransferTask } from '@/types/sftp'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
}

function statusMeta(task: TransferTask) {
  switch (task.status) {
    case 'transferring':
      return { icon: <Loader2 size={12} className="sftp-tx-spin" />, label: '传输中', cls: 'transferring' }
    case 'paused':
      return { icon: <Pause size={12} />, label: '已暂停', cls: 'paused' }
    case 'recoverable':
      return { icon: <Play size={12} />, label: '待手动恢复', cls: 'paused' }
    case 'completed':
      return { icon: <Check size={12} />, label: '已完成', cls: 'completed' }
    case 'failed':
      return { icon: <AlertCircle size={12} />, label: '失败', cls: 'failed' }
    case 'cancelled':
      return { icon: <X size={12} />, label: '已取消', cls: 'cancelled' }
    default:
      return { icon: <Loader2 size={12} />, label: '排队中', cls: 'queued' }
  }
}

export function TransferQueue() {
  const { transfers, cancelTransfer, clearCompleted, pauseTransfer, resumeTransfer } = useSftpStore()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileTarget, setFileTarget] = useState<{ id: string; restart: boolean } | null>(null)
  const [restartTarget, setRestartTarget] = useState<TransferTask | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const run = async (id: string, action: () => Promise<unknown>, restart = false) => {
    if (busy.has(id)) return
    setBusy((old) => new Set(old).add(id))
    setErrors((old) => ({ ...old, [id]: '' }))
    try { await action() } catch (cause) {
      const error = normalizeCommandError(cause)
      if (error.error.code === 'SOURCE_REQUIRED') {
        setFileTarget({ id, restart })
        fileInput.current?.click()
      } else { setErrors((old) => ({ ...old, [id]: error.message })) }
    } finally { setBusy((old) => { const next = new Set(old); next.delete(id); return next }) }
  }
  const [collapsed, setCollapsed] = useState(false)

  const active = transfers.filter((t) => t.status === 'transferring' || t.status === 'queued')
  const done = transfers.filter((t) => t.status !== 'transferring' && t.status !== 'queued')

  if (transfers.length === 0) return null

  const totalProgress =
    transfers.length > 0
      ? transfers.reduce((sum, t) => sum + (t.size ? t.transferred / t.size : 0), 0) / transfers.length
      : 0

  return (
    <div className={`sftp-tx ${collapsed ? 'collapsed' : ''}`}>
      <input ref={fileInput} type="file" className="hidden" aria-label="重新选择上传源文件" onChange={(event) => {
        const file = event.target.files?.[0]
        const target = fileTarget
        event.target.value = ''
        setFileTarget(null)
        if (file && target) void run(target.id, () => resumeTransfer(target.id, target.restart, file))
      }} />
      <Dialog open={restartTarget !== null} onOpenChange={(open) => { if (!open) setRestartTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>重新开始传输</DialogTitle>
            <DialogDescription>重新读取源文件并舍弃本任务的旧检查点和暂存内容。已提交的目录文件不会回滚；新的覆盖仍需通过目标冲突检查。</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRestartTarget(null)}>取消</Button>
            <Button onClick={() => { const task = restartTarget; setRestartTarget(null); if (task) void run(task.id, () => resumeTransfer(task.id, true), true) }}>重新开始</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {errors.queue && <p role="alert" className="px-3 py-1 text-xs text-destructive">{errors.queue}</p>}
      <div className="sftp-tx-hdr" onClick={() => setCollapsed((v) => !v)}>
        <div className="sftp-tx-hdr-left">
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span className="sftp-tx-title">传输队列</span>
          <span className="sftp-tx-count">
            {active.length > 0 ? `${active.length} 个进行中` : `${done.length} 个已结束或待恢复`}
          </span>
          {active.length > 0 && (
            <div className="sftp-tx-mini-bar">
              <div className="sftp-tx-mini-fill" style={{ width: `${totalProgress * 100}%` }} />
            </div>
          )}
        </div>
        <div className="sftp-tx-hdr-right">
          {done.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sftp-tx-clear"
              title="清除已完成"
              onClick={(e) => {
                e.stopPropagation()
                void run('queue', clearCompleted)
              }}
            >
              <Trash2 size={12} />
              <span className="sftp-tx-clear-label">清除</span>
            </Button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="sftp-tx-list">
          {transfers.map((task) => {
            const meta = statusMeta(task)
            const pct = task.size ? Math.min(100, Math.round((task.transferred / task.size) * 100)) : 0
            return (
              <div key={task.id} className={`sftp-tx-item ${meta.cls}`}>
                <span className="sftp-tx-dir">
                  {task.direction === 'upload' ? <ArrowUp size={13} /> : task.direction === 'download' ? <ArrowDown size={13} /> : <Copy size={13} />}
                </span>
                <span className="sftp-tx-name" title={task.file_name}>
                  {task.file_name}
                </span>
                <span className="sftp-tx-progress">
                  <div className="sftp-tx-bar">
                    <div className={`sftp-tx-fill ${meta.cls}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="sftp-tx-pct">{pct}%</span>
                </span>
                <span className="sftp-tx-size">
                  {formatSize(task.transferred)} / {formatSize(task.size)}
                </span>
                <span className={`sftp-tx-status ${meta.cls}`}>
                  {meta.icon}
                  {task.status === 'transferring' ? formatSpeed(task.speed) : meta.label}
                </span>
                {(['queued', 'transferring'].includes(task.status)) && <Button variant="ghost" size="icon-xs" title="暂停" aria-label={`暂停 ${task.file_name}`} disabled={busy.has(task.id)} onClick={() => void run(task.id, () => pauseTransfer(task.id))}><Pause size={12} /></Button>}
                {(['paused', 'recoverable'].includes(task.status) || (task.status === 'failed' && task.retryable)) && <Button variant="ghost" size="icon-xs" title={task.status === 'failed' ? '重试' : '继续'} aria-label={`继续 ${task.file_name}`} disabled={busy.has(task.id)} onClick={() => void run(task.id, () => resumeTransfer(task.id))}><Play size={12} /></Button>}
                {(['failed', 'paused', 'recoverable'].includes(task.status)) && <Button variant="ghost" size="icon-xs" title="重新开始" disabled={busy.has(task.id)} onClick={() => setRestartTarget(task)}><RotateCcw size={12} /></Button>}
                {task.direction === 'download' && task.status === 'completed' && <Button variant="ghost" size="icon-xs" title="保存下载文件" disabled={busy.has(task.id)} onClick={() => void run(task.id, () => sftpApi.exportDownload(task.id))}><Save size={12} /></Button>}
                {(task.status !== 'completed') && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="sftp-tx-cancel"
                    title="取消并清理暂存"
                    disabled={busy.has(task.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      void run(task.id, () => cancelTransfer(task.id))
                    }}
                  >
                    <X size={12} />
                  </Button>
                )}
                {(task.error_message || errors[task.id]) && <details className="basis-full px-5 py-1 text-xs text-destructive"><summary>错误详情 {task.error_code && `· ${task.error_code}`}</summary>
                  <p role="alert" className="whitespace-pre-wrap break-all">{errors[task.id] || task.error_message}</p>
                  <p className="text-muted-foreground">恢复前请连接任务所属服务器。源文件或暂存内容不一致时需重新开始；取消将清理本任务暂存。</p>
                </details>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
