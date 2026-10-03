import { useState, useEffect, useRef } from 'react'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function ConnectionPicker({ tabId, isActive = true }: { tabId: string; isActive?: boolean }) {
  const profiles = useProfileStore((s) => s.profiles)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (isActive) input.current?.focus() }, [isActive])
  const matches = profiles.filter((p) => `${p.name} ${p.host} ${p.username}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="absolute inset-0 z-10 flex flex-col gap-3 overflow-auto bg-background p-6">
    <h2 className="font-medium">选择服务器连接</h2>
    <Input ref={input} aria-label="搜索服务器" placeholder="搜索名称、地址或用户名…" value={query} onChange={(e) => setQuery(e.target.value)} />
    {matches.map((p) => <Button key={p.id} variant="outline" className="justify-start" onClick={() => {
      void useSessionStore.getState().openTab(p.id, p.name, p.host, p.port, p.username, tabId)
    }}>{p.name} · {p.username}@{p.host}:{p.port}</Button>)}
    {!matches.length && <p className="text-sm text-muted-foreground">暂无匹配服务器，请先在侧栏新增服务器。</p>}
  </div>
}
