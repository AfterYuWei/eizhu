import { useEffect,useState } from 'react'
import { toast } from 'sonner'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { useHistoryStore } from '@/store/history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select'

export function HistoryPanel() {
  const profiles = useProfileStore((s) => s.profiles)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const { settings, entries, privateTabs, configure, load, loadSettings, remove, setPrivate } = useHistoryStore()
  const [profileId, setProfileId] = useState('')
  const [query, setQuery] = useState('')
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
    <>
      <section className="settings-section" aria-labelledby="history-settings-title">
        <h2 id="history-settings-title" className="settings-section-title">本地命令历史</h2>
        <div className="settings-card">
          <div className="settings-field">
            <div className="settings-field-info">
              <Label htmlFor="history-enabled" className="settings-field-label">自动记录</Label>
              <p className="settings-field-desc">按账号和服务器加密保存在本机，不参与同步或云备份。仅记录能核对正常回显的单行输入，记录不表示执行成功；行首空格不记录。</p>
            </div>
            <Switch id="history-enabled" disabled={busy} checked={settings.enabled} onCheckedChange={(enabled) => void run(() => configure({ ...settings, enabled }))} />
          </div>
          {activeTabId && <div className="settings-field">
            <div className="settings-field-info">
              <Label htmlFor="history-private" className="settings-field-label">当前会话隐私模式</Label>
              <p className="settings-field-desc">暂停记录当前会话中的命令</p>
            </div>
            <Switch id="history-private" checked={!!privateTabs[activeTabId]} onCheckedChange={(enabled) => setPrivate(activeTabId, enabled)} />
          </div>}
          <div className="settings-field">
            <div className="settings-field-info">
              <Label htmlFor="history-limit" className="settings-field-label">每台服务器最多条数</Label>
              <p className="settings-field-desc">自动清理超出数量的旧记录，最多 5000 条</p>
            </div>
            <Input id="history-limit" className="settings-number-input" type="number" min={1} max={5000} defaultValue={settings.maxEntries} key={`limit-${settings.maxEntries}`} disabled={busy}
              onBlur={(e) => { const n = Number(e.target.value); if (n !== settings.maxEntries) void run(() => configure({ ...settings, maxEntries: n })) }} />
          </div>
          <div className="settings-field">
            <div className="settings-field-info">
              <Label htmlFor="history-days" className="settings-field-label">保留天数</Label>
              <p className="settings-field-desc">自动清理过期记录，最多保留 3650 天</p>
            </div>
            <Input id="history-days" className="settings-number-input" type="number" min={1} max={3650} defaultValue={settings.retentionDays} key={`days-${settings.retentionDays}`} disabled={busy}
              onBlur={(e) => { const n = Number(e.target.value); if (n !== settings.retentionDays) void run(() => configure({ ...settings, retentionDays: n })) }} />
          </div>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="history-query-title">
        <h2 id="history-query-title" className="settings-section-title">历史查询</h2>
        <div className="settings-card">
          <div className="settings-field">
            <div className="settings-field-info">
              <Label htmlFor="history-profile" className="settings-field-label">服务器</Label>
              <p className="settings-field-desc">查看所选服务器在本机保存的命令历史</p>
            </div>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="history-profile" className="settings-select"><SelectValue placeholder="选择服务器，查看历史" /></SelectTrigger>
              <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="settings-field">
            <div className="settings-field-info">
              <Label htmlFor="history-query" className="settings-field-label">查找历史</Label>
              <p className="settings-field-desc">按命令内容或工作目录筛选记录</p>
            </div>
            <Input id="history-query" className="settings-history-search" aria-label="查找历史" placeholder="查找命令或工作目录" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="settings-history-list">
            {matches.map((entry) => <div key={entry.id} className="settings-history-entry">
              <div><code>{entry.command}</code><p className="settings-field-desc">{entry.cwd} · {entry.count} 次 · {new Date(entry.lastAt).toLocaleString()}</p></div>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => remove(profileId, entry.id))}>删除</Button>
            </div>)}
            {matches.length === 0 && <p className="settings-empty">{profileId ? '暂无匹配历史' : '选择服务器后查看本地命令历史'}</p>}
          </div>
          <div className="settings-card-footer">
            <Button variant="outline" size="sm" disabled={!profileId || busy} onClick={() => void run(() => remove(profileId))}>清空所选服务器</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => remove())}>清空当前空间历史</Button>
          </div>
        </div>
      </section>
    </>
  )
}
