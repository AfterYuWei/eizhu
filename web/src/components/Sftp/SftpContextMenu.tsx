import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  onClick?: () => void
}

interface SftpContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** Controlled shadcn context menu anchored at the captured pointer position. */
export function SftpContextMenu({ x, y, items, onClose }: SftpContextMenuProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)

  // Radix ContextMenu records its virtual anchor from the Trigger's contextmenu
  // event. The original pointer event happened before this controlled menu was
  // mounted, so replay it with the captured viewport coordinates before paint.
  useLayoutEffect(() => {
    triggerRef.current?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    }))
  }, [x, y])

  return (
    <ContextMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) onClose()
      }}
    >
      <ContextMenuTrigger asChild>
        <span
          ref={triggerRef}
          className="pointer-events-none fixed size-px"
          style={{ left: x, top: y }}
          onContextMenu={(event) => event.stopPropagation()}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[168px]" collisionPadding={8}>
        {items.map((item) =>
          item.divider ? (
            <ContextMenuSeparator key={item.id} />
          ) : (
            <ContextMenuItem
              key={item.id}
              variant={item.danger ? 'destructive' : 'default'}
              disabled={item.disabled}
              onSelect={item.onClick}
            >
              {item.icon && <span className="flex shrink-0 items-center justify-center text-muted-foreground">{item.icon}</span>}
              {item.label}
            </ContextMenuItem>
          )
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
