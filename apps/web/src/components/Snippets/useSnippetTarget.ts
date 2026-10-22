import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/store/session'
import { snippetTargetError, type SnippetTarget } from '@/lib/snippetInsertion'

/** A disconnected/replaced target stays invalid for this invocation, even if it reconnects. */
export function useSnippetTarget(target: SnippetTarget | null) {
  const [error, setError] = useState(() => snippetTargetError(target))
  const invalid = useRef(error)
  useEffect(() => {
    const check = () => {
      const issue = invalid.current ?? snippetTargetError(target)
      invalid.current = issue
      setError(issue)
    }
    check()
    return useSessionStore.subscribe(check)
  }, [target])
  const validate = () => invalid.current ?? snippetTargetError(target)
  return { error, validate }
}
