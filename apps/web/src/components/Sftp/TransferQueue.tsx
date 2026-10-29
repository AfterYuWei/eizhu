import { useId, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, X, Check, AlertCircle, Loader2, ChevronDown, ChevronUp, Trash2, Copy, Pause, Play, RotateCcw, Save } from 'lucide-react'
import { useSftpStore } from './storeContext'
import { Button } from '@/components/ui/button'
import { InlineError } from '@/components/ui/inline-error'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { sftpApi } from '@/api/sftp'
import { normalizeCommandError } from '@eizhu/contracts'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import type { TransferTask } from '@/types/sftp'
import { transferProgress, transferPhaseLabel } from '@/lib/transferTasks'

type QueueFilter = 'all' | 'active' | 'attention' | 'finished'
function taskGroup(task: TransferTask): Exclude<QueueFilter, 'all'> {
  if (task.status === 'transferring' || task.status === 'queued') return 'active'
  if (task.status === 'completed' || task.status === 'cancelled') return 'finished'
  return 'attention'
}
const groupOrder = { active: 0, attention: 1, finished: 2 }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function formatSpeed(bytesPerSec: number): string { return `${formatSize(bytesPerSec)}/s` }
function isSending(task: TransferTask) {
  return task.status === 'transferring' && (!task.phase || task.phase === 'transferring') && task.transferred < task.size
}
function statusMeta(task: TransferTask) {
  if (task.conflict_count && ['paused', 'recoverable'].includes(task.status)) return { icon: <AlertCircle size={12} />, label: '等待处理冲突' }
  switch (task.status) {
    case 'transferring': return { icon: <Loader2 size={12} className="sftp-tx-spin" />, label: transferPhaseLabel(task) }
    case 'paused': return { icon: <Pause size={12} />, label: '已暂停' }
    case 'recoverable': return { icon: <Play size={12} />, label: '待恢复' }
    case 'completed': return { icon: <Check size={12} />, label: '已完成' }
    case 'failed': return { icon: <AlertCircle size={12} />, label: '传输失败' }
    case 'cancelled': return { icon: <X size={12} />, label: '已取消' }
    default: return { icon: <Loader2 size={12} />, label: '排队中' }
  }
}

export function TransferQueue() {
  const listId = useId()
  const { transfers, cancelTransfer, clearCompleted, pauseTransfer, resumeTransfer } = useSftpStore()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileTarget, setFileTarget] = useState<{ id: string; restart: boolean } | null>(null)
  const [restartTarget, setRestartTarget] = useState<TransferTask | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState(true)
  const [filter, setFilter] = useState<QueueFilter>('all')
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
  const active = transfers.filter((task) => taskGroup(task) === 'active')
  const attention = transfers.filter((task) => taskGroup(task) === 'attention')
  const finished = transfers.filter((task) => taskGroup(task) === 'finished')
  const speed = active.reduce((sum, task) => sum + (isSending(task) ? task.speed : 0), 0)
  const activeSize = active.reduce((sum, task) => sum + task.size, 0)
  const progress = activeSize > 0
    ? active.reduce((sum, task) => sum + transferProgress(task) * task.size, 0) / activeSize
    : 0
  const visible = transfers.filter((task) => filter === 'all' || taskGroup(task) === filter)
    .sort((a, b) => groupOrder[taskGroup(a)] - groupOrder[taskGroup(b)] || b.started_at - a.started_at)
  const filters: { id: QueueFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: transfers.length },
    { id: 'active', label: '进行中', count: active.length },
    { id: 'attention', label: '需处理', count: attention.length },
    { id: 'finished', label: '已结束', count: finished.length },
  ]
  if (transfers.length === 0) return null

  return (
    <section className={`sftp-tx ${collapsed ? 'collapsed' : ''}`} aria-label="传输队列">
      <input ref={fileInput} type="file" className="hidden" aria-label="重新选择上传源文件" onChange={(event) => {
        const file = event.target.files?.[0]
        const target = fileTarget
        event.target.value = ''
        setFileTarget(null)
        if (file && target) void run(target.id, () => resumeTransfer(target.id, target.restart, file))
      }} />
      <Dialog open={restartTarget !== null} onOpenChange={(open) => { if (!open) setRestartTarget(null) }}>
        <DialogContent className="sftp-dialog">
          <DialogHeader><DialogTitle>重新开始传输</DialogTitle>
            <DialogDescription>重新读取未完成的源文件并舍弃对应检查点和暂存内容。已提交的目录文件保持原样，只重传剩余部分；新的覆盖仍需通过目标冲突检查。</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRestartTarget(null)}>取消</Button>
            <Button onClick={() => { const task = restartTarget; setRestartTarget(null); if (task) void run(task.id, () => resumeTransfer(task.id, true), true) }}>重新开始</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="sftp-tx-hdr">
        <Button variant="ghost" className="sftp-tx-toggle" aria-label={collapsed ? '展开传输队列' : '收起传输队列'} aria-expanded={!collapsed} aria-controls={listId} onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span className="sftp-tx-title">传输队列</span>
          <span className="sftp-tx-count">{active.length > 0 ? `${active.length} 项进行中` : `${transfers.length} 项记录`}</span>
          {attention.length > 0 && <span className="sftp-tx-attention"><AlertCircle size={12} />{attention.length} 项需处理</span>}
          {active.length > 0 && <span className="sftp-tx-mini-bar" aria-hidden="true"><span className="sftp-tx-mini-fill" style={{ width: `${progress}%` }} /></span>}
        </Button>
        {!collapsed && <div className="sftp-tx-filters" role="group" aria-label="按传输状态筛选">
          {filters.map((item) => <Button key={item.id} variant="ghost" size="xs" className="sftp-tx-filter" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></Button>)}
        </div>}
        <div className="sftp-tx-hdr-right">
          <InlineError message={errors.queue}/>
          {speed > 0 && <span className="sftp-tx-speed" aria-label="当前总传输速度">{formatSpeed(speed)}</span>}
          {finished.length > 0 && <Button variant="ghost" size="xs" className="sftp-tx-clear" aria-label="清除记录" title="清除已完成和已取消的记录" disabled={busy.has('queue')} onClick={() => void run('queue', clearCompleted)}><Trash2 size={12} /><span>清除记录</span></Button>}
        </div>
      </div>
      <div className="sftp-tx-list" id={listId} hidden={collapsed}>
        {visible.length === 0 && <p className="sftp-tx-empty">暂无{filters.find((item) => item.id === filter)?.label}任务</p>}
        {visible.map((task) => {
          const meta = statusMeta(task)
          const pct = transferProgress(task)
          const preparing = task.status === 'transferring' && ['scanning', 'archiving'].includes(task.phase ?? '')
          const direction = task.direction === 'upload' ? '上传' : task.direction === 'download' ? '下载' : '传输'
          const error = errors[task.id] || task.error_message
          const statusContent = <>{meta.icon}<span>{meta.label}{errors[task.id] && ' · 操作失败'}{isSending(task) && task.speed > 0 && <small>{formatSpeed(task.speed)}</small>}</span></>
          return <div key={task.id} className={`sftp-tx-item ${task.status}`}>
            <span className="sftp-tx-dir" title={direction} aria-label={direction}>{task.direction === 'upload' ? <ArrowUp size={14} /> : task.direction === 'download' ? <ArrowDown size={14} /> : <Copy size={14} />}</span>
            <span className="sftp-tx-name" title={`${task.file_name}\n${task.current_file ?? ''}\n${direction} · ${formatSize(task.transferred)} / ${formatSize(task.size)}`}>
              <span>{task.file_name}</span>
              {task.items_total !== undefined && (task.items_total > 1 || task.phase === 'scanning') && <small>{task.phase === 'scanning' ? `已扫描 ${task.items_total} 项` : `${task.items_completed ?? 0} / ${task.items_total} 项`}{task.current_file && ` · ${task.current_file.split('/').pop()}`}</small>}
            </span>
            <span className="sftp-tx-progress">
              <span className={`sftp-tx-bar${preparing ? ' is-indeterminate' : ''}`} role="progressbar" aria-label={`${task.file_name} 传输进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={preparing ? undefined : pct} aria-valuetext={preparing ? meta.label : `${pct}% · ${meta.label}`}><span className={`sftp-tx-fill ${task.status}`} style={{ width: preparing ? '35%' : `${pct}%` }} /></span>
              <span className="sftp-tx-pct">{preparing ? '—' : `${pct}%`}</span>
            </span>
            <span className="sftp-tx-size">{formatSize(task.transferred)} / {formatSize(task.size)}</span>
            {error ? <Popover>
              <PopoverTrigger asChild><button type="button" className={`sftp-tx-status sftp-tx-error-trigger ${task.status}`} aria-label={`${meta.label} · 查看 ${task.file_name} 的错误详情`} title={error}>{statusContent}</button></PopoverTrigger>
              <PopoverContent side="top" align="end" className="sftp-dialog sftp-tx-error-popover">
                <strong>错误详情{task.error_code && ` · ${task.error_code}`}</strong>
                <InlineError message={error}/>
                <p>恢复前请连接任务所属服务器。源文件或暂存内容变化时需重新开始；取消将清理本任务暂存。</p>
              </PopoverContent>
            </Popover> : <span className={`sftp-tx-status ${task.status}`}>{statusContent}</span>}
            <div className="sftp-tx-actions">
              {taskGroup(task) === 'active' && <Button variant="ghost" size="icon-xs" title="暂停" aria-label={`暂停 ${task.file_name}`} disabled={busy.has(task.id)} onClick={() => void run(task.id, () => pauseTransfer(task.id))}><Pause size={12} /></Button>}
              {(task.status === 'paused' || task.status === 'recoverable' || task.status === 'failed' && task.retryable) && <Button variant="ghost" size="icon-xs" title={task.status === 'failed' ? '重试' : '继续'} aria-label={`${task.status === 'failed' ? '重试' : '继续'} ${task.file_name}`} disabled={busy.has(task.id)} onClick={() => void run(task.id, () => resumeTransfer(task.id))}><Play size={12} /></Button>}
              {taskGroup(task) === 'attention' && <Button variant="ghost" size="icon-xs" title="重新开始" aria-label={`重新开始 ${task.file_name}`} disabled={busy.has(task.id)} onClick={() => setRestartTarget(task)}><RotateCcw size={12} /></Button>}
              {task.direction === 'download' && task.target_profile === '__staging__' && task.status === 'completed' && <Button variant="ghost" size="icon-xs" title="保存下载文件" aria-label={`保存 ${task.file_name}`} disabled={busy.has(task.id)} onClick={() => void run(task.id, () => sftpApi.exportDownload(task.id))}><Save size={12} /></Button>}
              {taskGroup(task) !== 'finished' && <Button variant="ghost" size="icon-xs" className="sftp-tx-cancel" title="取消并清理暂存" aria-label={`取消并清理 ${task.file_name}`} disabled={busy.has(task.id)} onClick={() => void run(task.id, () => cancelTransfer(task.id))}><X size={12} /></Button>}
            </div>
          </div>
        })}
      </div>
    </section>
  )
}
