import { useCallback, useEffect, useReducer } from 'react'

interface Visibility {
  split: boolean
  collapsed: boolean
  beforeSplit: boolean
  manuallyChanged: boolean
}

function reducer(state: Visibility, action: { type: 'split'; active: boolean } | { type: 'toggle' } | { type: 'collapse' } | { type: 'expand' }): Visibility {
  if (action.type === 'toggle') return { ...state, collapsed: !state.collapsed, manuallyChanged: state.split || state.manuallyChanged }
  if (action.type === 'collapse') return { ...state, collapsed: true, manuallyChanged: state.split || state.manuallyChanged }
  if (action.type === 'expand') return { ...state, collapsed: false, manuallyChanged: state.split || state.manuallyChanged }
  if (action.active === state.split) return state
  if (action.active) return { split: true, beforeSplit: state.collapsed, collapsed: true, manuallyChanged: false }
  return { ...state, split: false, collapsed: state.manuallyChanged ? state.collapsed : state.beforeSplit, manuallyChanged: false }
}

export function useSplitSidebar(split: boolean) {
  const [state, dispatch] = useReducer(reducer, { split, collapsed: split, beforeSplit: false, manuallyChanged: false })
  useEffect(() => { dispatch({ type: 'split', active: split }) }, [split])
  const toggle = useCallback(() => dispatch({ type: 'toggle' }), [])
  const collapse = useCallback(() => dispatch({ type: 'collapse' }), [])
  const expand = useCallback(() => dispatch({ type: 'expand' }), [])
  return {
    collapsed: split && !state.split ? true : state.collapsed,
    toggle,
    collapse,
    expand,
  }
}
