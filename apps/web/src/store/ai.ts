import { create } from 'zustand'
import type { AiConversation } from '@eizhu/contracts'
interface AiState {
  selectedId: string | null
  conversations: Record<string, AiConversation>
  select: (id: string | null) => void
  put: (conversation: AiConversation) => void
  progress: (id: string, message: AiConversation['messages'][number]) => void
  forget: (id: string) => void
}
export const useAiStore = create<AiState>((set) => ({
  selectedId: null,
  conversations: {},
  select: (selectedId) => set({ selectedId }),
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
      selectedId: s.selectedId === id ? null : s.selectedId,
      conversations: Object.fromEntries(Object.entries(s.conversations).filter(([key]) => key !== id)),
    })),
}))
