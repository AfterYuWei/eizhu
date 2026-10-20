import { useCallback,useEffect,useState } from 'react'
import { bridge } from '@/lib/bridge'
import { Clipboard,FileText,RefreshCw,Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs,TabsList,TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { writeClipboardText } from '@/lib/clipboard'

type LogKind = 'frontend' | 'backend' | 'audit'

interface LogSnapshot {
  kind: LogKind
  path: string
  content: string
}
const actionLabels: Record<string,string> = { profile_create:'创建服务器',profile_update:'更新服务器',profile_delete:'删除服务器',group_create:'创建分组',group_update:'更新分组',group_delete:'删除分组',vault_create:'创建凭据',vault_update:'更新凭据',vault_delete:'删除凭据',vault_reveal:'查看凭据',snippet_create:'创建片段',snippet_update:'更新片段',snippet_delete:'删除片段',backup_import:'导入或恢复备份',audit_clear:'清空审计',local_state_write:'保存本地设置' }

export function LogPanel() {
  const [kind, setKind] = useState<LogKind>('frontend')
  const [snapshot, setSnapshot] = useState<LogSnapshot | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      if (kind === 'audit') {
        const rows = await bridge().audit.list({ limit: 500 })
        setSnapshot({ kind, path: '当前本地空间 · 最近 500 条审计记录', content: rows.map(row => `${row.created_at}  ${actionLabels[row.action] ?? '本地操作'}  ${row.entity_id}`).join('\n') })
      } else setSnapshot(await bridge().diagnostics.read({ kind }))
    } catch (error) {
      if (!quiet) toast.error('读取日志失败', { description: String(error) })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const clear = async () => {
    try {
      if (kind === 'audit') await bridge().audit.clear()
      else await bridge().diagnostics.clear({ kind })
      await refresh()
      toast.success('日志已清空')
    } catch (error) {
      toast.error('清空日志失败', { description: String(error) })
    }
  }

  const copy = async () => {
    await writeClipboardText(snapshot?.content ?? '')
    toast.success('日志已复制')
  }

  return (
    <div className="settings-section log-panel">
      <div className="settings-section-title">
        <FileText size={14} />
        <span>调试日志（DEBUG）</span>
      </div>

      <div className="log-toolbar">
        <Tabs value={kind} onValueChange={(value) => setKind(value as LogKind)}>
          <TabsList className="log-kind-switch" aria-label="日志类型">
          <TabsTrigger value="frontend">
            前端日志
          </TabsTrigger>
          <TabsTrigger value="backend">
            后端日志
          </TabsTrigger>
          <TabsTrigger value="audit">本地审计</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="log-actions">
          <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!snapshot?.content}>
            <Clipboard size={13} />复制
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />刷新
          </Button>
          <Button variant="outline" size="sm" onClick={() => void clear()}>
            <Trash2 size={13} />清空
          </Button>
        </div>
      </div>

      <div className="log-path" title={snapshot?.path}>{snapshot?.path ?? '正在读取…'}</div>
      <pre className="log-viewer">{snapshot?.content || '暂无日志'}</pre>
      <div className="settings-field-desc">每 2 秒自动刷新；日志最多显示末尾 256 KiB，审计仅包含操作、记录标识和时间。</div>
    </div>
  )
}
