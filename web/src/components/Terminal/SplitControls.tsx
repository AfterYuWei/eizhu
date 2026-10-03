import { useState, type RefObject } from 'react'
import { useTerminalLayoutStore } from '@/store/terminalLayout'
import { type SplitHandle } from '@/lib/terminalLayout'
import { Button } from '@/components/ui/button'
import { runDesktopAction } from '@/lib/desktopActions'
import { Columns2, Rows2, Maximize2, Minimize2, PanelsTopLeft, ArrowRight } from 'lucide-react'
export function SplitToolbar() {
  const maximized = useTerminalLayoutStore((state) => Boolean(state.maximizedId))
  return <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border bg-background px-2">
    <Button variant="ghost" size="icon-xs" title="向右分屏 · Ctrl/Cmd+Shift+H" onClick={() => runDesktopAction('split-right')}><Columns2 size={13} /></Button>
    <Button variant="ghost" size="icon-xs" title="向下分屏 · Ctrl/Cmd+Shift+J" onClick={() => runDesktopAction('split-down')}><Rows2 size={13} /></Button>
    <Button variant="ghost" size="icon-xs" title="下一个窗格 · Ctrl/Cmd+Shift+N" onClick={() => runDesktopAction('focus-next')}><ArrowRight size={13} /></Button>
    <Button variant="ghost" size="icon-xs" title="最大化或还原 · Ctrl/Cmd+Shift+M" onClick={() => runDesktopAction('maximize-pane')}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</Button>
    <Button variant="ghost" size="icon-xs" title="合并并保留其他连接 · Ctrl/Cmd+Shift+G" onClick={() => runDesktopAction('merge-panes')}><PanelsTopLeft size={13} /></Button>
  </div>
}
export function SplitResizeHandle({ handle, host }: { handle: SplitHandle; host: RefObject<HTMLDivElement | null> }) {
  const [dragging, setDragging] = useState(false)
  const horizontal = handle.axis === 'horizontal'
  const resize = useTerminalLayoutStore((state) => state.resize)
  return <div role="separator" tabIndex={0} aria-label="调整窗格比例" aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(handle.ratio * 100)}
    className={`absolute z-20 touch-none bg-border hover:bg-ring focus-visible:bg-ring ${horizontal ? 'cursor-col-resize' : 'cursor-row-resize'}`}
    style={horizontal ? { left: `calc(${handle.x + handle.width * handle.ratio}% - 2px)`, top: `${handle.y}%`, height: `${handle.height}%`, width: 4 } : { top: `calc(${handle.y + handle.height * handle.ratio}% - 2px)`, left: `${handle.x}%`, width: `${handle.width}%`, height: 4 }}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true) }}
    onPointerMove={(event) => {
      if (!dragging || !host.current) return
      const rect = host.current.getBoundingClientRect()
      const offset = horizontal ? (event.clientX - rect.left) / rect.width * 100 - handle.x : (event.clientY - rect.top) / rect.height * 100 - handle.y
      resize(handle.id, offset / (horizontal ? handle.width : handle.height))
    }}
    onPointerUp={(event) => { setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId) }}
    onLostPointerCapture={() => setDragging(false)}
    onKeyDown={(event) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); resize(handle.id, handle.ratio + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 0.05 : -0.05))
      }
    }} />
}
