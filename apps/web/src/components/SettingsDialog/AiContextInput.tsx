import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

const presets = [256000, 512000, 1000000, 2000000]

export function AiContextInput({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  const choose = (index: number) => {
    onChange(presets[index])
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="settings-select ai-context-field">
          <Input
            ref={input}
            id="ai-context"
            className="ai-context-input"
            type="number"
            min={4096}
            max={2000000}
            value={value || ''}
            disabled={disabled}
            role="combobox"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? 'ai-context-options' : undefined}
            aria-activedescendant={open && active >= 0 ? `ai-context-option-${active}` : undefined}
            onFocus={() => {
              setActive(presets.indexOf(value))
              setOpen(true)
            }}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              onChange(Number(e.target.value))
              setActive(-1)
              setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setOpen(true)
                setActive((previous) =>
                  previous < 0
                    ? e.key === 'ArrowDown'
                      ? 0
                      : presets.length - 1
                    : (previous + (e.key === 'ArrowDown' ? 1 : -1) + presets.length) % presets.length,
                )
              } else if (e.key === 'Enter' && open) {
                e.preventDefault()
                if (active >= 0) choose(active)
                else setOpen(false)
              } else if (e.key === 'Escape' && open) {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              }
            }}
          />
          <ChevronDown size={14} aria-hidden="true" />
        </div>
      </PopoverAnchor>
      <PopoverContent
        id="ai-context-options"
        role="listbox"
        aria-label="常用上下文窗口"
        align="end"
        className="ai-context-options"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target === input.current) e.preventDefault()
        }}
      >
        {presets.map((preset, index) => (
          <button
            key={preset}
            id={`ai-context-option-${index}`}
            type="button"
            role="option"
            aria-selected={value === preset}
            className={active === index ? 'is-active' : undefined}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onPointerMove={() => setActive(index)}
            onClick={() => choose(index)}
          >
            {preset >= 1000000 ? preset / 1000000 + 'M' : preset / 1000 + 'K'}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
