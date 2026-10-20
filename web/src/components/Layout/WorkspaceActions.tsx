import { useRef } from 'react'
import { Copy, MoreHorizontal, RefreshCw, Search, Unplug, Waypoints } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { focusActiveTerminal, runDesktopAction, type DesktopActionId } from '@/lib/desktopActions'
import { ShellIconButton } from './ShellControls'

export function WorkspaceActions({ terminal }: { terminal: boolean }) {
  const pending = useRef<DesktopActionId | null>(null)
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><ShellIconButton label="更多操作"><MoreHorizontal size={17} /></ShellIconButton></DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
      const action = pending.current
      pending.current = null
      if (!action) return
      event.preventDefault()
      runDesktopAction(action)
      requestAnimationFrame(focusActiveTerminal)
    }}>
      {terminal && <>
        <DropdownMenuItem onSelect={() => { pending.current = 'reconnect' }}><RefreshCw />重新连接</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { pending.current = 'search' }}><Search />查找终端内容</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { pending.current = 'copy-ssh' }}><Copy />复制 SSH 命令</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { pending.current = 'tunnels' }}><Waypoints />SSH 隧道管理</DropdownMenuItem>
        <DropdownMenuSeparator />
      </>}
      <DropdownMenuItem onSelect={() => { pending.current = 'close' }}><Unplug />关闭当前页面</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
