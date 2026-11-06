import { create } from 'zustand'
export type AccountDialogMode = 'login' | 'register' | 'recover' | 'change'
export const useAccountDialogStore = create<{
  mode: AccountDialogMode | null
  email: string
  open: (mode?: AccountDialogMode, email?: string) => void
  close: () => void
}>((set) => ({
  mode: null,
  email: '',
  open: (mode = 'login', email = '') => set({ mode, email }),
  close: () => set({ mode: null, email: '' }),
}))
