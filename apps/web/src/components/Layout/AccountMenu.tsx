import { CloudSync,Info,Monitor,Moon,Palette,Settings,Sun,UserRound } from 'lucide-react'
import { useAccountStore } from '@/store/account'
import { useSettingsStore } from '@/store/settings'
import { useSyncStore } from '@/store/sync'
import { SYNC_STATUS_LABELS } from '@/types/sync'
import { DEFAULT_DESKTOP_SIDEBAR_WIDTH,DESKTOP_SIDEBAR_INSET } from '@/lib/desktopSidebar'
import { useRef } from 'react'
import { useAccountDialogStore } from '@/store/accountDialog'
import { AccountIdentity } from './AccountIdentity'
import type { SettingsTab } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import {
DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuRadioGroup,
DropdownMenuRadioItem,DropdownMenuSeparator,DropdownMenuSub,DropdownMenuSubContent,
DropdownMenuSubTrigger,DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AccountMenu({ onSettings }: { onSettings: (tab: SettingsTab) => void }) {
  const openingSettings = useRef(false)
  const account = useAccountStore((s) => s.status)
  const sync = useSyncStore((s) => s.status)
  const { theme, setTheme } = useSettingsStore()
  const cloud = account?.loggedIn === true
  const name = cloud ? account.user.username || account.user.email.split('@')[0] || '云端用户' : '本地用户'
  const openSettings = (tab: SettingsTab) => { openingSettings.current = true; if (tab === 'account' && (!account?.loggedIn || account.sessionState === 'reauth_required')) useAccountDialogStore.getState().open('login', account?.user?.email); else onSettings(tab) }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" className="shell-account" aria-label={`${name} · ${cloud ? '云端' : '本地'}，打开账号菜单`}>
        <AccountIdentity />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-sidebar-popover side="top" align="start" sideOffset={8} className="shell-account-menu" style={{ width: DEFAULT_DESKTOP_SIDEBAR_WIDTH - 2 * DESKTOP_SIDEBAR_INSET }} onCloseAutoFocus={(event) => {
      if (openingSettings.current) { event.preventDefault(); openingSettings.current = false }
    }}>
      <DropdownMenuItem onSelect={() => openSettings('appearance')}><Settings />设置</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Palette />主题</DropdownMenuSubTrigger>
        <DropdownMenuSubContent data-sidebar-popover className="shell-account-submenu">
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
            <DropdownMenuRadioItem value="light"><Sun size={15} />浅色</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark"><Moon size={15} />深色</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system"><Monitor size={15} />跟随系统</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => openSettings('sync')}><CloudSync />云同步
        {cloud && sync && <span className="ml-auto text-xs text-muted-foreground">{sync.conflictCount ? `${sync.conflictCount} 个冲突` : SYNC_STATUS_LABELS[sync.status] ?? sync.status}</span>}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openSettings('account')}><UserRound />账号<span className="ml-auto text-xs text-muted-foreground">{account?.loggedIn ? account.sessionState === 'reauth_required' ? '需登录' : '已登录' : '未登录'}</span></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => openSettings('about')}><Info />关于 eizhu</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
