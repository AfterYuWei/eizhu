export interface DirtyEditorTab { id: string; content: string; originalContent: string }
export type EditorCloseRequest = { kind: 'application' | 'window' } | { kind: 'workspace'; requestId: string } | { kind: 'tab'; tabId: string }
export function isEditorDirty(tab: DirtyEditorTab) { return tab.content !== tab.originalContent }
export function dirtyEditorTabs(request: EditorCloseRequest, tabs: DirtyEditorTab[]) {
  return tabs.filter((tab) => (request.kind !== 'tab' || tab.id === request.tabId) && isEditorDirty(tab))
}
export async function saveBeforeEditorClose(request: EditorCloseRequest, tabs: () => DirtyEditorTab[], save: (id: string) => Promise<boolean>) {
  const ids = dirtyEditorTabs(request, tabs()).map((t) => t.id)
  for (const id of ids) if (!await save(id)) return false
  return dirtyEditorTabs(request, tabs()).length === 0
}
