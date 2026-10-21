import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { bridge } from '@/lib/bridge'
import { useProfileStore } from '@/store/profile'
import { useVaultStore } from '@/store/vault'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { BackupSource } from '@/api/backup'
import type { RestorePreview } from '@/types/backup'

export function LocalRestorePanel({
  source,
  password,
  onRestored,
}: {
  source: BackupSource | null
  password: string
  onRestored: () => void
}) {
  const [safety, setSafety] = useState<Array<{ id: string; createdAt: string }>>([])
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try {
      setSafety(await bridge().backup.safetyVersions())
    } catch {
      setSafety([])
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh, source])
  async function prepare(id?: string) {
    setBusy(true)
    try {
      setPreview(
        id
          ? await bridge().backup.previewSafety({ id })
          : await bridge().backup.prepareRestore({ filePath: source!.path, password: password || undefined }),
      )
    } catch (error) {
      toast.error('恢复预览失败', { description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }
  async function apply(mode: 'merge' | 'replace') {
    if (!preview) return
    setBusy(true)
    try {
      await bridge().backup.applyRestore({ token: preview.token, mode })
    } catch (error) {
      setBusy(false)
      toast.error('恢复失败', { description: (error as Error).message })
      return
    }
    setPreview(null)
    onRestored()
    try {
      await Promise.all([
        useProfileStore.getState().refreshAll(),
        useVaultStore.getState().fetchList(),
        refresh(),
      ])
      toast.success('本地数据已恢复，已保留覆盖前的加密安全快照')
    } catch {
      toast.warning('数据已恢复，列表刷新失败，请重新启动应用')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="backup-card backup-file-restore">
      <h3>完整恢复与安全快照</h3>
      <p className="settings-field-desc">
        先选择并解锁上方备份，再查看完整变化。合并保留其他本地记录；替换移除备份中不存在的记录。每次导入或恢复前保留设备密钥加密的安全快照。
      </p>
      <Button variant="outline" size="sm" disabled={!source || busy} onClick={() => void prepare()}>
        预览完整恢复
      </Button>
      {safety.map((v) => (
        <div className="backup-row" key={v.id}>
          <span>{new Date(v.createdAt).toLocaleString()}</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare(v.id)}>
            预览安全快照
          </Button>
        </div>
      ))}
      <AlertDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复本地数据</AlertDialogTitle>
            <AlertDialogDescription>
              {preview?.source.kind === 'safety' ? '设备加密安全快照' : preview?.source.name}
              。取消预览保留当前数据；本地数据变化后需要重新预览。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && (
            <div className="space-y-2 text-xs">
              <p>
                导出时间：{preview.exportedAt || '未记录'} · 凭据：
                {preview.credentialMode === 'none'
                  ? '不包含'
                  : preview.credentialMode === 'plain'
                    ? '明文备份'
                    : '加密保护'}
              </p>
              <table className="w-full">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>新增</th>
                    <th>变更</th>
                    <th>相同</th>
                    <th>替换时移除</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['groups', '分组'],
                      ['vault', '凭据'],
                      ['profiles', '服务器'],
                      ['snippets', '片段'],
                    ] as const
                  ).map(([key, label]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>{preview.changes[key].added}</td>
                      <td>{preview.changes[key].changed}</td>
                      <td>{preview.changes[key].unchanged}</td>
                      <td>{preview.changes[key].removedInReplace}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void apply('merge')
              }}
            >
              合并到当前空间
            </AlertDialogAction>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void apply('replace')
              }}
            >
              替换当前空间
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
