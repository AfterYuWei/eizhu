import { create } from 'zustand'
import type { AiConversation, AiSettings } from '@eizhu/contracts'
interface AiState {
  settings: AiSettings | null
  setSettings: (settings: AiSettings) => void
  selectedByTab: Record<string, string | null>
  conversations: Record<string, AiConversation>
  select: (tabId: string, id: string | null) => void
  closeTab: (tabId: string) => void
  put: (conversation: AiConversation) => void
  progress: (id: string, message: AiConversation['messages'][number]) => void
  forget: (id: string) => void
}
export const useAiStore = create<AiState>((set) => ({
  settings: null,
  setSettings: (settings) => set({ settings }),
  selectedByTab: {},
  conversations: {},
  select: (tabId, id) => set((s) => ({ selectedByTab: { ...s.selectedByTab, [tabId]: id } })),
  closeTab: (tabId) => set((s) => {
    const { [tabId]: id, ...selectedByTab } = s.selectedByTab
    if (!id) return { selectedByTab }
    const conversations = { ...s.conversations }
    delete conversations[id]
    return { selectedByTab, conversations }
  }),
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
  forget: (id) =>
    set((s) => ({
      selectedByTab: Object.fromEntries(Object.entries(s.selectedByTab).map(([tab, current]) => [tab, current === id ? null : current])),
      conversations: Object.fromEntries(Object.entries(s.conversations).filter(([key]) => key !== id)),
    })),
}))
