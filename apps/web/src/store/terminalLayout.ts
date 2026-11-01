import { create } from 'zustand';
import { useSessionStore } from './session';
import { terminalActions } from '@/lib/terminalActions';
import { leaves,replaceLeaf,pruneTree,setRatio,type SplitTree,type SplitAxis } from '@/lib/terminalLayout';
interface LayoutState {
    tree: SplitTree | null;
    focusedId: string | null;
    maximizedId: string | null;
    split: (axis: SplitAxis) => void;
    focusNext: (direction: number) => void;
    maximize: () => void;
    merge: () => void;
    resize: (id: string, ratio: number) => void;
}
let mutating = false;
// Terminal tabs and splits belong to this run only; never restore saved server references.
export const useTerminalLayoutStore = create<LayoutState>((set, get) => ({
    tree: null, focusedId: null, maximizedId: null,
    split: (axis) => {
        syncTerminalLayout();
        const { tree, focusedId } = get();
        const active = useSessionStore.getState().tabs.find((tab) => tab.id === focusedId);
        if (!tree || !active)
            throw new Error('请先选择一个终端标签');
        if (leaves(tree).length >= 4)
            throw new Error('每个布局最多四个窗格');
        mutating = true;
        const newId = useSessionStore.getState().openDraftTab();
        mutating = false;
        set({ tree: replaceLeaf(tree, active.id, { type: 'split', id: crypto.randomUUID(), axis, ratio: 0.5, first: { type: 'leaf', tabId: active.id }, second: { type: 'leaf', tabId: newId } }), focusedId: newId, maximizedId: null });
    },
    focusNext: (direction) => {
        const { tree, focusedId } = get(), ids = leaves(tree);
        if (!ids.length)
            return;
        const id = ids[(ids.indexOf(focusedId ?? '') + direction + ids.length) % ids.length];
        set({ focusedId: id, ...(get().maximizedId ? { maximizedId: id } : {}) });
        useSessionStore.getState().setActiveTab(id);
        terminalActions(id)?.focus();
    },
    maximize: () => set({ maximizedId: get().maximizedId ? null : get().focusedId }),
    merge: () => { const id = get().focusedId; if (id)
        set({ tree: { type: 'leaf', tabId: id }, maximizedId: null }); },
    resize: (id, ratio) => { const tree = get().tree; if (tree && Number.isFinite(ratio))
        set({ tree: setRatio(tree, id, ratio) }); },
}));
function syncTerminalLayout() {
    if (mutating)
        return;
    const sessions = useSessionStore.getState(), layout = useTerminalLayoutStore.getState();
    const active = sessions.tabs.find((tab) => tab.id === sessions.activeTabId);
    const allowed = new Set(sessions.tabs.map((tab) => tab.id));
    let tree = pruneTree(layout.tree, allowed);
    if (active && !leaves(tree).includes(active.id)) {
        tree = tree && layout.focusedId && leaves(tree).includes(layout.focusedId)
            ? replaceLeaf(tree, layout.focusedId, { type: 'leaf', tabId: active.id }) : { type: 'leaf', tabId: active.id };
    }
    const focusedId = active?.id ?? (allowed.has(layout.focusedId ?? '') ? layout.focusedId : leaves(tree)[0] ?? null);
    if (tree !== layout.tree || focusedId !== layout.focusedId)
        useTerminalLayoutStore.setState({ tree, focusedId, maximizedId: layout.maximizedId && active ? active.id : null });
}
useSessionStore.subscribe((state, previous) => { if (state.tabs !== previous.tabs || state.activeTabId !== previous.activeTabId) {
    syncTerminalLayout();
} });
export function resetTerminalLayout() {
    useTerminalLayoutStore.setState(useTerminalLayoutStore.getInitialState(), true);
}
