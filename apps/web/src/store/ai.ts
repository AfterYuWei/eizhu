import { create } from 'zustand'
import type { AiConversation } from '@eizhu/contracts'
import { bridge } from '@/lib/bridge'
import { workspaceGeneration } from '@/lib/workspaceScope'

interface AiState {
  tabs: Record<string, string>
  conversations: Record<string, AiConversation>
  put: (conversation: AiConversation) => void
  progress: (id: string, message: AiConversation['messages'][number]) => void
  forget: (profileId: string, conversationId?: string) => void
  open: (tabId: string, sessionId: string, historyId?: string, fresh?: boolean) => Promise<void>
}
const opening = new Map<string, Promise<void>>()
/** Conversation bodies stay in memory; all durable storage belongs to the database Worker. */
export const useAiStore = create<AiState>((set, get) => ({
  tabs: {},
  conversations: {},
  put: (conversation) =>
    set((s) => ({ conversations: { ...s.conversations, [conversation.id]: conversation } })),
  progress: (id, message) =>
    set((s) => {
      const c = s.conversations[id]
      if (!c) return s
      return {
        conversations: {
          ...s.conversations,
          [id]: { ...c, messages: c.messages.map((m) => (m.id === message.id ? message : m)) },
        },
      }
    }),
  forget: (profileId, conversationId) =>
    set((s) => {
      const conversations = Object.fromEntries(
        Object.entries(s.conversations).filter(
          ([id, c]) => c.profileId !== profileId || (conversationId && id !== conversationId),
        ),
      )
      return {
        conversations,
        tabs: Object.fromEntries(Object.entries(s.tabs).filter(([, id]) => Object.hasOwn(conversations, id))),
      }
    }),
  open: (tabId, sessionId, historyId, fresh = false) => {
    const generation = workspaceGeneration(),
      key = `${generation}:${tabId}`
    const existing = opening.get(key)
    if (existing) return existing
    const task = (async () => {
      const currentId = get().tabs[tabId],
        current = currentId ? get().conversations[currentId] : undefined
      const conversation = await bridge().ai.open({
        sessionId,
        conversationId: fresh ? undefined : (historyId ?? current?.id),
      })
      if (generation !== workspaceGeneration()) return
      set((s) => ({
        tabs: { ...s.tabs, [tabId]: conversation.id },
        conversations: { ...s.conversations, [conversation.id]: conversation },
      }))
    })().finally(() => opening.delete(key))
    opening.set(key, task)
    return task
  },
}))
