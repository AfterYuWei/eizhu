import { useState,useEffect,useRef,type RefObject } from 'react'
import { ArrowUpRight,Search } from 'lucide-react'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { resolveServerIcon } from '@/lib/serverIcons'

export function ConnectionPicker({ tabId, isActive = true, inputRef }: { tabId: string; isActive?: boolean; inputRef?: RefObject<HTMLInputElement | null> }) {
  const profiles = useProfileStore((s) => s.profiles)
  const [query, setQuery] = useState('')
  const localInput = useRef<HTMLInputElement>(null)
  const input = inputRef ?? localInput
  useEffect(() => { if (isActive) input.current?.focus() }, [isActive, input])
  const matches = profiles.filter((p) => `${p.name} ${p.host} ${p.username}`.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="connection-picker">
      <div className="connection-picker-content">
        <div className="connection-picker-heading">
          <h2>选择服务器</h2>
          <p>连接将在此窗格中打开</p>
        </div>
        <div className="connection-picker-search">
          <Search size={14} aria-hidden="true" />
          <Input
            ref={input}
            aria-label="搜索服务器"
            placeholder="搜索名称、地址或用户名…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="connection-picker-list" aria-label="可连接的服务器">
          {matches.map((profile) => {
            const Icon = resolveServerIcon(profile.icon)
            const address = `${profile.username}@${profile.host}:${profile.port}`
            return (
              <Button
                key={profile.id}
                type="button"
                variant="ghost"
                className="connection-picker-server"
                title={`${profile.name} · ${address}`}
                onClick={() => {
                  void useSessionStore.getState().openTab(profile.id, profile.name, profile.host, profile.port, profile.username, tabId)
                }}
              >
                <span className="connection-picker-icon"><Icon size={16} /></span>
                <span className="connection-picker-info">
                  <span className="connection-picker-name">{profile.name}</span>
                  <span className="connection-picker-address">{address}</span>
                </span>
                <ArrowUpRight className="connection-picker-arrow size-3.5" />
              </Button>
            )
          })}
          {!matches.length && (
            <p className="connection-picker-empty" role="status">
              {profiles.length ? '未找到匹配的服务器，试试其他关键词。' : '暂无服务器，请先在侧栏新增服务器。'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
