import { useState,useEffect,useMemo,useRef,useId,type RefObject } from 'react'
import { ArrowUpRight,ChevronDown,Search } from 'lucide-react'
import { useProfileStore } from '@/store/profile'
import { useSessionStore } from '@/store/session'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { resolveServerIcon } from '@/lib/serverIcons'
import { resolveGroupIcon } from '@/lib/groupIcons'
import type { Group } from '@/types/group'
import type { Profile } from '@/types/profile'

interface ConnectionGroup {
  id: string
  name: string
  icon?: string
  path: string
  servers: Profile[]
  children: ConnectionGroup[]
  count: number
  total: number
}

export function ConnectionPicker({ tabId, isActive = true, inputRef }: { tabId: string; isActive?: boolean; inputRef?: RefObject<HTMLInputElement | null> }) {
  const profiles = useProfileStore((s) => s.profiles)
  const groups = useProfileStore((s) => s.groups)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const pickerId = useId()
  const localInput = useRef<HTMLInputElement>(null)
  const input = inputRef ?? localInput
  useEffect(() => { if (isActive && !document.activeElement?.closest('[role="tablist"]')) input.current?.focus() }, [isActive, input])
  const sections = useMemo(() => {
    const search = query.trim().toLowerCase()
    const grouped = new Map(groups.map((group) => [group.id, [] as Profile[]]))
    const children = new Map<string, Group[]>()
    const loose: Profile[] = []
    for (const profile of profiles) {
      const list = grouped.get(profile.group_id ?? '')
      if (list) list.push(profile)
      else loose.push(profile)
    }
    for (const group of groups) {
      if (!group.parent_id || !grouped.has(group.parent_id)) continue
      const list = children.get(group.parent_id) ?? []
      list.push(group)
      children.set(group.parent_id, list)
    }
    const matches = (profile: Profile, path: string) =>
      `${path} ${profile.name} ${profile.host} ${profile.username}`.toLowerCase().includes(search)
    const visited = new Set<string>()
    const build = (group: Group, ancestors: string[]): ConnectionGroup | null => {
      if (visited.has(group.id)) return null
      visited.add(group.id)
      const names = [...ancestors, group.name]
      const path = names.join(' / ')
      const descendants = (children.get(group.id) ?? []).map((child) => build(child, names)).filter((child): child is ConnectionGroup => child !== null)
      const allServers = grouped.get(group.id) ?? []
      const servers = allServers.filter((profile) => matches(profile, path))
      return {
        id: group.id, name: group.name, icon: group.icon, path, servers,
        children: descendants.filter((child) => child.count > 0),
        count: servers.length + descendants.reduce((sum, child) => sum + child.count, 0),
        total: allServers.length + descendants.reduce((sum, child) => sum + child.total, 0),
      }
    }
    const roots: ConnectionGroup[] = []
    const addRoot = (group: Group) => {
      const section = build(group, [])
      if (section && section.count > 0) roots.push(section)
    }
    groups.filter((group) => !group.parent_id || !grouped.has(group.parent_id)).forEach(addRoot)
    // Keep every server reachable even if an imported group hierarchy has a cycle.
    groups.filter((group) => !visited.has(group.id)).forEach(addRoot)
    const looseMatches = loose.filter((profile) => matches(profile, '未分组'))
    if (looseMatches.length) roots.push({ id: '__connection-ungrouped__', name: '未分组', path: '未分组', servers: looseMatches, children: [], count: looseMatches.length, total: loose.length })
    return roots
  }, [profiles, groups, query])

  const renderServer = (profile: Profile, path: string) => {
    const Icon = resolveServerIcon(profile.icon)
    const host = profile.host.includes(':') ? `[${profile.host}]` : profile.host
    const address = `${profile.username}@${host}:${profile.port}`
    return <Button
      key={profile.id}
      type="button"
      variant="ghost"
      className="connection-picker-server"
      title={`${profile.name} · ${address} · ${path}`}
      aria-label={`连接 ${profile.name} · ${address} · ${path}`}
      onClick={() => {
        void useSessionStore.getState().openTab(profile.id, profile.name, profile.host, profile.port, profile.username, tabId)
      }}
    >
      <span className="connection-picker-icon"><Icon size={16} /></span>
      <span className="connection-picker-info">
        <span className="connection-picker-name">{profile.name}</span>
        <span className="connection-picker-address">{address}</span>
      </span>
      <ArrowUpRight className="connection-picker-arrow size-4" aria-hidden="true" />
    </Button>
  }
  const renderGroup = (section: ConnectionGroup, nested = false) => {
    const Icon = resolveGroupIcon(section.icon)
    const folded = Boolean(collapsed[section.id])
    const contentId = `${pickerId}-group-${section.id}`
    const Heading = nested ? 'h4' : 'h3'
    return <section key={section.id} className={`connection-picker-group${nested ? ' is-nested' : ''}`} aria-label={section.path}>
      <Heading className="connection-picker-group-title">
        <Button type="button" variant="ghost" className="connection-picker-group-toggle"
          aria-expanded={!folded} aria-controls={contentId}
          aria-label={`${folded ? '展开' : '收起'}分组 ${section.path}，${section.count} 台服务器`}
          title={section.path}
          onClick={() => setCollapsed((current) => ({ ...current, [section.id]: !current[section.id] }))}>
          <ChevronDown size={14} className={folded ? 'is-collapsed' : ''} aria-hidden="true" />
          <Icon size={16} aria-hidden="true" />
          <span className="connection-picker-group-name">{section.name}</span>
          <span className="connection-picker-count">{query.trim() ? `${section.count} / ${section.total}` : section.total}</span>
        </Button>
      </Heading>
      <div id={contentId} className="connection-picker-group-body" hidden={folded}>
        {section.servers.length > 0 && <div className="connection-picker-grid">{section.servers.map((profile) => renderServer(profile, section.path))}</div>}
        {section.children.map((child) => renderGroup(child, true))}
      </div>
    </section>
  }

  return (
    <div className="connection-picker">
      <div className="connection-picker-content">
        <header className="connection-picker-toolbar">
          <div className="connection-picker-heading">
            <h2>新建连接</h2>
            <p>按分组选择服务器，开始 SSH 会话。</p>
          </div>
          <div className="connection-picker-search">
            <Search size={16} aria-hidden="true" />
            <Input
              ref={input}
              aria-label="搜索服务器或分组"
              placeholder="搜索分组、名称或地址…"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setCollapsed({}) }}
            />
          </div>
        </header>
        <div className="connection-picker-list" aria-label="按分组选择服务器">
          {sections.map((section) => renderGroup(section))}
          {!sections.length && <p className="connection-picker-empty" role="status">
            {profiles.length ? '未找到匹配的服务器或分组，试试其他关键词。' : '暂无服务器，请先在侧栏新增服务器。'}
          </p>}
        </div>
      </div>
    </div>
  )
}
