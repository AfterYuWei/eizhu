import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { useHistoryStore } from '@/store/history'
import { localStateApi } from '@/api/localState'
import { readLegacyHistory, removeLegacyHistory } from '@/lib/commandHistory'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function HistoryPanel() {
  const profiles = useProfileStore((s) => s.profiles)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const { settings, entries, privateTabs, configure, load, loadSettings, remove, setPrivate } = useHistoryStore()
  const [profileId, setProfileId] = useState('')
  const [query, setQuery] = useState('')
  const [legacy, setLegacy] = useState(readLegacyHistory)
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try { await work() } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void loadSettings().catch((e) => toast.error(String(e))) }, [loadSettings])
  useEffect(() => { if (profileId) void load(profileId).catch((e) => toast.error(String(e))) }, [profileId, load])
  const matches = (entries[profileId] ?? []).filter((e) => `${e.command} ${e.cwd}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="settings-section">
      <div className="settings-divider" />
      <div className="settings-section-title">本地命令历史</div>
      <p className="text-xs text-muted-foreground">按账号和服务器加密保存在本机，不参与同步或云备份。仅记录能核对正常回显的单行输入，记录不表示执行成功；行首空格不记录。</p>
      <div className="settings-field">
        <Label>自动记录</Label><Switch disabled={busy} checked={settings.enabled} onCheckedChange={(enabled) => void run(() => configure({ ...settings, enabled }))} />
      </div>
      {activeTabId && <div className="settings-field">
        <Label>当前会话隐私模式</Label><Switch checked={!!privateTabs[activeTabId]} onCheckedChange={(enabled) => setPrivate(activeTabId, enabled)} />
      </div>}
      <div className="settings-field">
        <Label htmlFor="history-limit">每台服务器最多条数</Label>
        <Input id="history-limit" className="w-24" type="number" min={1} max={5000} defaultValue={settings.maxEntries} key={`limit-${settings.maxEntries}`} disabled={busy}
          onBlur={(e) => { const n = Number(e.target.value); if (n !== settings.maxEntries) void run(() => configure({ ...settings, maxEntries: n })) }} />
      </div>
      <div className="settings-field">
        <Label htmlFor="history-days">保留天数</Label>
        <Input id="history-days" className="w-24" type="number" min={1} max={3650} defaultValue={settings.retentionDays} key={`days-${settings.retentionDays}`} disabled={busy}
          onBlur={(e) => { const n = Number(e.target.value); if (n !== settings.retentionDays) void run(() => configure({ ...settings, retentionDays: n })) }} />
      </div>
      <Select value={profileId} onValueChange={setProfileId}><SelectTrigger><SelectValue placeholder="选择服务器，查看或导入历史" /></SelectTrigger><SelectContent>
        {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent></Select>
      {legacy.length > 0 && <div className="space-y-2 rounded-lg border p-3 text-xs">
        <p>发现 {legacy.length} 条旧历史，尚未归属账号和服务器。请确认上方服务器及当前数据空间后导入。</p>
        <Button size="sm" disabled={!profileId || busy} onClick={() => void run(async () => {
          const generation = workspaceGeneration()
          const count = await localStateApi.import(profileId, legacy)
          if (generation !== workspaceGeneration()) return
          removeLegacyHistory(); setLegacy([]); await load(profileId)
          toast.success(`已导入 ${count} 条历史；重复或过期记录已过滤`)
        })}>导入所选服务器</Button>
      </div>}
      <Input aria-label="查找历史" placeholder="查找命令或工作目录" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="max-h-60 space-y-2 overflow-auto">
        {matches.map((entry) => <div key={entry.id} className="flex items-start gap-2 rounded-lg border p-2">
          <div className="min-w-0 flex-1"><code className="break-all text-xs">{entry.command}</code><p className="text-xs text-muted-foreground">{entry.cwd} · {entry.count} 次 · {new Date(entry.lastAt).toLocaleString()}</p></div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => remove(profileId, entry.id))}>删除</Button>
        </div>)}
        {profileId && matches.length === 0 && <p className="text-xs text-muted-foreground">暂无匹配历史</p>}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!profileId || busy} onClick={() => void run(() => remove(profileId))}>清空所选服务器</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => remove())}>清空当前空间历史</Button>
      </div>
    </div>
  )
}
