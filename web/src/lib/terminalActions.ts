export interface TerminalActions {
  focus: () => void
  reconnect: () => Promise<void>
  search: () => void
  insert: (content: string, execute?: boolean) => void
  safeMultiline: () => boolean
}
const terminals = new Map<string, TerminalActions>()
export function registerTerminalActions(id: string, actions: TerminalActions) {
  terminals.set(id, actions)
  return () => { if (terminals.get(id) === actions) terminals.delete(id) }
}
export function terminalActions(id: string | null) { return id ? terminals.get(id) : undefined }
