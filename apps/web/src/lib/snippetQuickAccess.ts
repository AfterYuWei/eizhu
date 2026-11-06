import type { Snippet } from '@/types/snippet'
import { workspaceGeneration } from './workspaceScope'

let generation: number | undefined
let recentIds: string[] = []

export function resetSnippetQuickAccess() {
  generation = workspaceGeneration()
  recentIds = []
}

export function recentSnippetIds(): string[] {
  if (generation !== workspaceGeneration()) resetSnippetQuickAccess()
  return [...recentIds]
}

export function recordSnippetUse(id: string) {
  recentSnippetIds()
  recentIds = [id, ...recentIds.filter((recent) => recent !== id)].slice(0, 20)
}

export function findQuickSnippets(snippets: Snippet[], query: string, recent: string[]): Snippet[] {
  const needle = query.trim().toLowerCase()
  const recentOrder = new Map(recent.map((id, index) => [id, index]))
  return snippets.filter((snippet) => [snippet.name, snippet.description, ...snippet.tags, snippet.content]
    .some((text) => text.toLowerCase().includes(needle)))
    .sort((a, b) => {
      if (needle) {
        const nameMatch = Number(b.name.toLowerCase().includes(needle)) - Number(a.name.toLowerCase().includes(needle))
        if (nameMatch) return nameMatch
      }
      return (recentOrder.get(a.id) ?? recent.length) - (recentOrder.get(b.id) ?? recent.length)
        || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.id.localeCompare(b.id)
    })
}

/** Keep an Enter held during insertion from executing after focus returns to xterm. */
export function suppressHeldSnippetEnter() {
  const cleanup = () => {
    document.removeEventListener('keydown', keydown, true)
    document.removeEventListener('keyup', keyup, true)
    window.removeEventListener('blur', cleanup)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    if (!event.repeat) { cleanup(); return }
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const keyup = (event: KeyboardEvent) => { if (event.key === 'Enter') cleanup() }
  document.addEventListener('keydown', keydown, true)
  document.addEventListener('keyup', keyup, true)
  window.addEventListener('blur', cleanup, { once: true })
}
