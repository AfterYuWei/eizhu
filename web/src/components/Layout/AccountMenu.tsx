import { CloudSync, Info, Monitor, Moon, Palette, Settings, Sun, UserRound } from 'lucide-react'
import { useAccountStore } from '@/store/account'
import { useSettingsStore } from '@/store/settings'
import { useSyncStore } from '@/store/sync'
import { SYNC_STATUS_LABELS } from '@/types/sync'
import type { SettingsTab } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AccountMenu({ onSettings }: { onSettings: (tab: SettingsTab) => void }) {
  const account = useAccountStore((s) => s.status)
  const sync = useSyncStore((s) => s.status)
  const { theme, setTheme } = useSettingsStore()
  const cloud = account?.loggedIn === true
  const name = cloud ? account.user?.email.split('@')[0] || '云端用户' : '本地用户'
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" className="shell-account" aria-label={`${name} · ${cloud ? '云端' : '本地'}，打开账号菜单`}>
        <span className="shell-avatar" aria-hidden="true">{cloud ? name.slice(0, 1).toUpperCase() : <UserRound size={17} />}</span>
        <span className="shell-account-name">{name}</span>
        <span className="shell-mode">{cloud ? '云端' : '本地'}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={8} className="shell-account-menu w-64">
      <DropdownMenuItem onSelect={() => onSettings('appearance')}><Settings />设置</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Palette />主题</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
            <DropdownMenuRadioItem value="light"><Sun size={15} />浅色</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark"><Moon size={15} />深色</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system"><Monitor size={15} />跟随系统</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onSettings('sync')}><CloudSync />云同步
        {cloud && sync && <span className="ml-auto text-xs text-muted-foreground">{sync.conflictCount ? `${sync.conflictCount} 个冲突` : SYNC_STATUS_LABELS[sync.status] ?? sync.status}</span>}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onSettings('account')}><UserRound />账号<span className="ml-auto text-xs text-muted-foreground">开发中</span></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onSettings('about')}><Info />关于 eizhu</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
