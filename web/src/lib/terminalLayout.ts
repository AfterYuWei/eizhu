export type SplitAxis = 'horizontal' | 'vertical'
export type SplitTree = { type: 'leaf'; tabId: string } | { type: 'split'; id: string; axis: SplitAxis; ratio: number; first: SplitTree; second: SplitTree }
export interface PaneRect { tabId: string; x: number; y: number; width: number; height: number }
export interface SplitHandle { id: string; axis: SplitAxis; ratio: number; x: number; y: number; width: number; height: number }
export function leaves(tree: SplitTree | null): string[] {
  return !tree ? [] : tree.type === 'leaf' ? [tree.tabId] : [...leaves(tree.first), ...leaves(tree.second)]
}
export function replaceLeaf(tree: SplitTree, id: string, replacement: SplitTree): SplitTree {
  return tree.type === 'leaf' ? (tree.tabId === id ? replacement : tree)
    : { ...tree, first: replaceLeaf(tree.first, id, replacement), second: replaceLeaf(tree.second, id, replacement) }
}
export function pruneTree(tree: SplitTree | null, allowed: Set<string>): SplitTree | null {
  if (!tree) return null
  if (tree.type === 'leaf') return allowed.has(tree.tabId) ? tree : null
  const first = pruneTree(tree.first, allowed), second = pruneTree(tree.second, allowed)
  return first && second ? (first === tree.first && second === tree.second ? tree : { ...tree, first, second }) : first ?? second
}
export function setRatio(tree: SplitTree, id: string, ratio: number): SplitTree {
  if (tree.type === 'leaf') return tree
  return { ...tree, ratio: tree.id === id ? Math.max(0.15, Math.min(0.85, ratio)) : tree.ratio, first: setRatio(tree.first, id, ratio), second: setRatio(tree.second, id, ratio) }
}
export function geometry(tree: SplitTree | null): { panes: PaneRect[]; handles: SplitHandle[] } {
  const panes: PaneRect[] = [], handles: SplitHandle[] = []
  const visit = (node: SplitTree, rect: Omit<PaneRect, 'tabId'>) => {
    if (node.type === 'leaf') { panes.push({ ...rect, tabId: node.tabId }); return }
    handles.push({ ...rect, id: node.id, axis: node.axis, ratio: node.ratio })
    const { x, y, width, height } = rect
    if (node.axis === 'horizontal') {
      visit(node.first, { x, y, width: width * node.ratio, height })
      visit(node.second, { x: x + width * node.ratio, y, width: width * (1 - node.ratio), height })
    } else {
      visit(node.first, { x, y, width, height: height * node.ratio })
      visit(node.second, { x, y: y + height * node.ratio, width, height: height * (1 - node.ratio) })
    }
  }
  if (tree) visit(tree, { x: 0, y: 0, width: 100, height: 100 })
  return { panes, handles }
}
/** Treat persisted data as untrusted; no duplicate panes, unbounded nesting or invalid ratios. */
export function parseSplitTree(value: unknown, allowed: Set<string>): SplitTree | null {
  const used = new Set<string>(), splits = new Set<string>()
  const parse = (input: unknown, depth: number): SplitTree | null => {
    if (!input || typeof input !== 'object' || depth > 3) return null
    const node = input as Record<string, unknown>
    if (node.type === 'leaf' && typeof node.tabId === 'string' && allowed.has(node.tabId) && !used.has(node.tabId) && used.size < 4) {
      used.add(node.tabId); return { type: 'leaf', tabId: node.tabId }
    }
    if (node.type !== 'split' || typeof node.id !== 'string' || splits.has(node.id) || !['horizontal', 'vertical'].includes(String(node.axis)) || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio)) return null
    splits.add(node.id)
    const first = parse(node.first, depth + 1), second = parse(node.second, depth + 1)
    return first && second ? { type: 'split', id: node.id, axis: node.axis as SplitAxis, ratio: Math.max(0.15, Math.min(0.85, node.ratio)), first, second } : first ?? second
  }
  return parse(value, 0)
}
