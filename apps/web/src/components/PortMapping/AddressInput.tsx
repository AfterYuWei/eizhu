import { useRef, type ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

/** 常用目标可选，自定义 IP/域名仍直接输入；监听范围由独立的监听地址字段控制。 */
export function AddressInput({ value, onValueChange, selectLabel, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: string; onValueChange: (value: string) => void; selectLabel: string }) {
  const input = useRef<HTMLInputElement>(null)
  const selected = useRef(false)
  const addresses = [...new Set(['127.0.0.1', '::1', 'localhost', value.trim()].filter(Boolean))]
  return <div className="pm-address-input">
    <Input {...props} ref={input} value={value} onChange={(event) => onValueChange(event.target.value)} />
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="pm-address-trigger" disabled={props.disabled} aria-label={selectLabel}><ChevronDown size={14} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent className="pm-address-options" align="end" onCloseAutoFocus={(event) => { if (selected.current) { event.preventDefault(); selected.current = false; input.current?.focus() } }}>
        {addresses.map((address) => <DropdownMenuItem key={address} onSelect={() => { selected.current = true; onValueChange(address) }}>{address}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
}
