import { useRef, useState, type PointerEvent, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, Columns2, Maximize2, Minimize2, PanelsTopLeft, Rows2, X } from 'lucide-react'
import { useTerminalLayoutStore } from '@/store/terminalLayout'
import { useSessionStore } from '@/store/session'
import { leaves, type SplitHandle } from '@/lib/terminalLayout'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { focusActiveTerminal, runDesktopAction, type DesktopActionId } from '@/lib/desktopActions'
import { cn } from '@/lib/utils'
import { getPlatformCapabilities } from '@/lib/platform'

/** Layout actions belong to the application header, outside the terminal canvas. */
export function TerminalSplitMenu() {
  const { tree, maximizedId } = useTerminalLayoutStore()
  const { tabs, activeTabId } = useSessionStore()
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const count = leaves(tree).length
  const split = count > 1
  const pendingAction = useRef<DesktopActionId | null>(null)
  const shortcut = (key: string) => getPlatformCapabilities().platform === 'macos' ? `⇧⌘${key}` : `Ctrl+Shift+${key}`

  if (activeTab?.kind !== 'terminal') return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn('hdr-icon-btn', split && 'active')}
          title="终端分屏"
          aria-label={split ? `终端分屏，当前 ${count} 个窗格` : '终端分屏'}
        >
          <Columns2 size={14} />
          <span className="hdr-icon-btn-label">分屏{split && ` ${count}`}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72"
        onCloseAutoFocus={(event) => {
          const action = pendingAction.current
          pendingAction.current = null
          if (!action) return
          event.preventDefault()
          runDesktopAction(action)
          requestAnimationFrame(focusActiveTerminal)
        }}
      >
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground" title={activeTab.profileName}>
          当前窗格 · {activeTab.profileName}
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={count >= 4} onSelect={() => { pendingAction.current = 'split-right' }}>
          <Columns2 />向右分屏<DropdownMenuShortcut>{shortcut('H')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={count >= 4} onSelect={() => { pendingAction.current = 'split-down' }}>
          <Rows2 />向下分屏<DropdownMenuShortcut>{shortcut('J')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {count >= 4 && <p className="px-2 py-1 text-xs text-muted-foreground">最多支持 4 个窗格</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!split} onSelect={() => { pendingAction.current = 'focus-previous' }}>
          <ArrowLeft />上一个窗格<DropdownMenuShortcut>{shortcut('P')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!split} onSelect={() => { pendingAction.current = 'focus-next' }}>
          <ArrowRight />下一个窗格<DropdownMenuShortcut>{shortcut('N')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!split} onSelect={() => { pendingAction.current = 'maximize-pane' }}>
          {maximizedId ? <Minimize2 /> : <Maximize2 />}
          {maximizedId ? '还原分屏' : '最大化当前窗格'}
          <DropdownMenuShortcut>{shortcut('M')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!split} onSelect={() => { pendingAction.current = 'merge-panes' }}>
          <PanelsTopLeft />合并窗格，保留连接<DropdownMenuShortcut>{shortcut('G')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { pendingAction.current = 'close' }}>
          <X />关闭当前窗格<DropdownMenuShortcut>{shortcut('W')}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SplitResizeHandle({ handle, host }: { handle: SplitHandle; host: RefObject<HTMLDivElement | null> }) {
  const [dragging, setDragging] = useState(false)
  const grabOffset = useRef(0)
  const horizontal = handle.axis === 'horizontal'
  const resize = useTerminalLayoutStore((state) => state.resize)
  const pointerRatio = (event: PointerEvent<HTMLDivElement>) => {
    const rect = host.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return handle.ratio
    const offset = horizontal
      ? (event.clientX - rect.left) / rect.width * 100 - handle.x
      : (event.clientY - rect.top) / rect.height * 100 - handle.y
    return offset / (horizontal ? handle.width : handle.height)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="调整窗格比例"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(handle.ratio * 100)}
      title="拖动调整窗格大小，双击均分"
      className={cn('term-split-handle', horizontal ? 'is-horizontal' : 'is-vertical', dragging && 'is-dragging')}
      style={horizontal
        ? { left: `calc(${handle.x + handle.width * handle.ratio}% - 5px)`, top: `${handle.y}%`, height: `${handle.height}%`, width: 10 }
        : { top: `calc(${handle.y + handle.height * handle.ratio}% - 5px)`, left: `${handle.x}%`, width: `${handle.width}%`, height: 10 }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        grabOffset.current = pointerRatio(event) - handle.ratio
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (dragging) resize(handle.id, pointerRatio(event) - grabOffset.current)
      }}
      onPointerUp={(event) => {
        setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => setDragging(false)}
      onLostPointerCapture={() => setDragging(false)}
      onDoubleClick={() => resize(handle.id, 0.5)}
      onKeyDown={(event) => {
        const keys = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
        if (!keys.includes(event.key)) return
        event.preventDefault()
        resize(handle.id, handle.ratio + (event.key === keys[1] ? 0.05 : -0.05))
      }}
    />
  )
}
