import { ArchivePanel } from './ArchivePanel'
import { LocalRestorePanel } from './LocalRestorePanel'
import { useState } from 'react'
import { Download, Upload, AlertTriangle, FileJson, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { toast } from 'sonner'
import {
  exportBackup,
  pickBackupFile,
  previewBackup,
  importBackup,
  releaseBackupSource,
  type BackupPreview,
  type BackupSource,
  type CredentialMode,
  type ImportStrategy,
} from '@/api/backup'
import { useProfileStore } from '@/store/profile'
import { useVaultStore } from '@/store/vault'

const modeOptions = [
  { value: 'encrypted', label: '密码加密导出（推荐）' },
  { value: 'none', label: '不含凭据' },
  { value: 'plain', label: '明文导出（风险自负）' },
]

const strategyOptions = [
  { value: 'skip', label: '跳过已存在的记录（默认）' },
  { value: 'overwrite', label: '覆盖已存在的记录' },
  { value: 'regenerate', label: '全部作为新记录导入（重新生成 ID）' },
]

export function BackupPanel() {
  // ── Export state ──
  const [mode, setMode] = useState<CredentialMode>('encrypted')
  const [exportPwd, setExportPwd] = useState('')
  const [exportPwd2, setExportPwd2] = useState('')
  const [exporting, setExporting] = useState(false)

  // ── Import state ──
  const [file, setFile] = useState<BackupSource | null>(null)
  const [importPwd, setImportPwd] = useState('')
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [strategy, setStrategy] = useState<ImportStrategy>('skip')
  const [busy, setBusy] = useState(false)
  const [plainExportPending, setPlainExportPending] = useState(false)

  const resetImport = () => {
    if (file) void releaseBackupSource(file).catch(() => undefined)
    setFile(null)
    setImportPwd('')
    setPreview(null)
    setNeedsPassword(false)
    setStrategy('skip')
  }

  const runExport = async () => {
    setExporting(true)
    try {
      const saved = await exportBackup(mode, mode === 'encrypted' ? exportPwd : undefined)
      if (!saved) return
      toast.success('备份文件已保存')
      setExportPwd('')
      setExportPwd2('')
    } catch (err) {
      toast.error('导出失败', { description: errMessage(err) })
    } finally {
      setExporting(false)
    }
  }

  // ── Export ──
  const handleExport = async () => {
    if (mode === 'encrypted') {
      if (exportPwd.length < 6) {
        toast.warning('导出密码至少 6 位')
        return
      }
      if (exportPwd !== exportPwd2) {
        toast.warning('两次输入的密码不一致')
        return
      }
    }
    if (mode === 'plain') {
      setPlainExportPending(true)
      return
    }
    await runExport()
  }

  // ── Import ──
  const doPreview = async (src: BackupSource, pwd: string) => {
    setBusy(true)
    try {
      const p = await previewBackup(src, pwd || undefined)
      setPreview(p)
      setNeedsPassword(false)
    } catch (err) {
      const code = (err as { error?: { code?: string } })?.error?.code
      if (code === 'PASSWORD_REQUIRED' || code === 'INVALID_PASSWORD') {
        setNeedsPassword(true)
        if (code === 'INVALID_PASSWORD') toast.error('密码错误或文件已损坏')
      } else {
        toast.error('备份文件解析失败', { description: errMessage(err) })
        resetImport()
      }
    } finally {
      setBusy(false)
    }
  }

  const handleFilePick = (src: BackupSource | null) => {
    if (!src) return
    if (file && file.path !== src.path) void releaseBackupSource(file).catch(() => undefined)
    setFile(src)
    setPreview(null)
    setNeedsPassword(false)
    setImportPwd('')
    void doPreview(src, '')
  }

  const openPicker = () => {
    void (async () => {
      try {
        handleFilePick(await pickBackupFile())
      } catch (err) {
        toast.error('选择备份文件失败', { description: errMessage(err) })
      }
    })()
  }

  const handleImport = async () => {
    if (!file) return
    setBusy(true)
    try {
      const result = await importBackup(file, strategy, importPwd || undefined)
      const { imported, skipped } = result
      console.debug('backup import committed', {
        strategy,
        imported,
        skipped,
        snapshot: result.snapshot
          ? {
              groups: result.snapshot.groups.length,
              profiles: result.snapshot.profiles.length,
              vault: result.snapshot.vault.length,
            }
          : null,
        snapshot_error: result.snapshot_error,
      })
      resetImport()

      if (result.snapshot) {
        useProfileStore.getState().applySnapshot(result.snapshot.profiles, result.snapshot.groups)
        useVaultStore.getState().applySnapshot(result.snapshot.vault)
      } else {
        try {
          await Promise.all([useProfileStore.getState().refreshAll(), useVaultStore.getState().fetchList()])
        } catch (refreshErr) {
          // 导入事务已经提交，不能把刷新失败误报成“导入失败”，否则用户再次
          // 导入只会看到全部冲突。明确告知数据已保存，并建议重启后重试加载。
          toast.warning('数据已导入，但列表刷新失败', {
            description: `${result.snapshot_error ? `${result.snapshot_error}；` : ''}${errMessage(refreshErr)}。请重新启动应用加载已导入的数据。`,
          })
          return
        }
      }

      toast.success('导入完成', {
        description: `新增/更新：分组 ${imported.groups}、凭据 ${imported.vault}、服务器 ${imported.profiles}、片段 ${imported.snippets}；跳过：${skipped.groups + skipped.vault + skipped.profiles + skipped.snippets} 条`,
      })
    } catch (err) {
      toast.error('导入失败', { description: errMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const hasConflicts = preview
    ? preview.conflicts.groups +
        preview.conflicts.vault +
        preview.conflicts.profiles +
        preview.conflicts.snippets >
      0
    : false

  return (
    <Tabs defaultValue="backup" className="settings-section backup-page">
      <TabsList className="settings-subtabs backup-tabs" variant="line" aria-label="数据备份功能">
        <TabsTrigger value="backup">备份设置</TabsTrigger>
        <TabsTrigger value="restore">版本恢复</TabsTrigger>
        <TabsTrigger value="files">文件导入与导出</TabsTrigger>
      </TabsList>

      <ArchivePanel />
      <TabsContent value="files" className="backup-tab-content">
        <div className="backup-file-grid">
          {/* ── 导出 ── */}
          <section className="backup-card backup-file-card" aria-labelledby="backup-export-title">
            <div className="backup-section-heading">
              <span className="backup-section-icon">
                <Download size={18} />
              </span>
              <div>
                <h2 id="backup-export-title">导出备份文件</h2>
                <p className="backup-description">将分组、服务器、凭据、命令片段导出为 .eizhubackup 文件</p>
              </div>
            </div>
            <div className="backup-row">
              <Label htmlFor="backup-export-mode" className="backup-row-label">
                凭据处理
              </Label>
              <Select value={mode} onValueChange={(value) => setMode(value as CredentialMode)}>
                <SelectTrigger id="backup-export-mode" className="settings-select">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {modeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mode === 'encrypted' && (
              <>
                <div className="backup-row">
                  <Label htmlFor="backup-export-password" className="backup-row-label">
                    导出密码
                  </Label>
                  <Input
                    id="backup-export-password"
                    type="password"
                    value={exportPwd}
                    onChange={(e) => setExportPwd(e.target.value)}
                    placeholder="至少 6 位，导入时需要"
                  />
                </div>
                <div className="backup-row">
                  <Label htmlFor="backup-export-confirm" className="backup-row-label">
                    确认密码
                  </Label>
                  <Input
                    id="backup-export-confirm"
                    type="password"
                    value={exportPwd2}
                    onChange={(e) => setExportPwd2(e.target.value)}
                    placeholder="再次输入"
                  />
                </div>
              </>
            )}
            {mode === 'plain' && (
              <div className="backup-warning">
                <AlertTriangle size={13} />
                <span>备份文件将包含明文密码与私钥，请妥善保管</span>
              </div>
            )}
            <Button onClick={handleExport} disabled={exporting} className="backup-action">
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              导出备份
            </Button>
          </section>

          <AlertDialog open={plainExportPending} onOpenChange={setPlainExportPending}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>明文导出凭据？</AlertDialogTitle>
                <AlertDialogDescription>
                  备份文件将以明文保存所有密码和私钥，任何拿到文件的人都能直接使用。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => void runExport()}
                >
                  继续导出
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* ── 导入 ── */}
          <section className="backup-card backup-file-card" aria-labelledby="backup-import-title">
            <div className="backup-section-heading">
              <span className="backup-section-icon">
                <Upload size={18} />
              </span>
              <div>
                <h2 id="backup-import-title">从备份文件导入</h2>
                <p className="backup-description">
                  从 .eizhubackup 或旧版 .xcbackup 文件恢复数据，导入只新增或更新，不会删除现有数据
                </p>
              </div>
            </div>
            {!file ? (
              <div className="backup-file-picker">
                <FileJson size={28} aria-hidden="true" />
                <p>选择一个备份文件开始恢复</p>
                <Button variant="outline" onClick={openPicker}>
                  <FileJson size={14} />
                  选择备份文件
                </Button>
                <span className="backup-description">支持 .eizhubackup / .xcbackup</span>
              </div>
            ) : (
              <>
                <div className="backup-row">
                  <Label className="backup-row-label">文件</Label>
                  <span className="backup-filename" title={file.name}>
                    {file.name}
                  </span>
                  <Button variant="outline" size="sm" onClick={resetImport}>
                    重选
                  </Button>
                </div>

                {busy && !preview && (
                  <div className="backup-row">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="settings-field-desc">解析中…</span>
                  </div>
                )}

                {needsPassword && (
                  <div className="backup-row">
                    <Label htmlFor="backup-import-password" className="backup-row-label">
                      导出密码
                    </Label>
                    <Input
                      id="backup-import-password"
                      type="password"
                      value={importPwd}
                      onChange={(e) => setImportPwd(e.target.value)}
                      placeholder="输入导出时设置的密码"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && importPwd) void doPreview(file, importPwd)
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() => void doPreview(file, importPwd)}
                      disabled={!importPwd || busy}
                    >
                      解锁
                    </Button>
                  </div>
                )}

                {preview && (
                  <>
                    <div className="backup-stats">
                      <span>分组 {preview.stats.groups}</span>
                      <span>凭据 {preview.stats.vault}</span>
                      <span>服务器 {preview.stats.profiles}</span>
                      <span>片段 {preview.stats.snippets}</span>
                    </div>
                    {hasConflicts && (
                      <div className="backup-warning">
                        <AlertTriangle size={13} />
                        <span>
                          与现有数据冲突：分组 {preview.conflicts.groups}、凭据 {preview.conflicts.vault}
                          、服务器 {preview.conflicts.profiles}、片段 {preview.conflicts.snippets}
                        </span>
                      </div>
                    )}
                    <div className="backup-row">
                      <Label htmlFor="backup-import-strategy" className="backup-row-label">
                        合并策略
                      </Label>
                      <Select
                        value={strategy}
                        onValueChange={(value) => setStrategy(value as ImportStrategy)}
                      >
                        <SelectTrigger id="backup-import-strategy" className="settings-select">
                          <SelectValue placeholder="请选择" />
                        </SelectTrigger>
                        <SelectContent>
                          {strategyOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleImport} disabled={busy} className="backup-action">
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      开始导入
                    </Button>
                  </>
                )}
              </>
            )}
            <LocalRestorePanel source={file} password={importPwd} onRestored={resetImport} />
          </section>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function errMessage(err: unknown): string {
  const e = err as { error?: { message?: string } }
  return e?.error?.message ?? (err instanceof Error ? err.message : String(err))
}
