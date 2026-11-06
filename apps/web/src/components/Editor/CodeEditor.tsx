import { Loading } from '@/components/ui/loading'
import { useRef,useCallback,useLayoutEffect } from 'react'
import '@/lib/monaco'
import { type monaco, type EditorReady } from '@/lib/monaco'
import { applyEditorTheme } from '@/lib/editorTheme'
import MonacoEditor from '@monaco-editor/react'
import { useResolvedTheme } from '@/store/settings'

interface CodeEditorProps {
  content: string
  language: string
  readOnly: boolean
  loading: boolean
  onChange: (value: string) => void
  onSave: () => void
}

/** Monaco editor wrapper for file editing.
 *
 *  Uses @monaco-editor/react with bundled local Monaco and workers.
 *  Ctrl/Cmd+S → onSave(); intercepts browser default. */
export function CodeEditor({
  content,
  language,
  readOnly,
  loading,
  onChange,
  onSave,
}: CodeEditorProps) {
  const onSaveRef = useRef(onSave)
  useLayoutEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const resolvedTheme = useResolvedTheme()
  const monacoRef = useRef<typeof monaco | null>(null)
  const beforeMount = useCallback((api: typeof monaco) => {
    monacoRef.current = api
    applyEditorTheme(api, resolvedTheme)
  }, [resolvedTheme])

  useLayoutEffect(() => {
    const syncTheme = () => {
      if (monacoRef.current) applyEditorTheme(monacoRef.current, resolvedTheme)
    }
    syncTheme()
    // Cross-window settings hydration also updates root tokens after the store.
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => observer.disconnect()
  }, [resolvedTheme])

  const handleMount: EditorReady = useCallback((inst, monaco) => {
    // @monaco-editor/react owns the model change subscription and suppresses
    // callbacks for controlled value updates. A second subscription here sees
    // tab switches as edits and captures the first tab's onChange callback.
    inst.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current()
    })
  }, [])

  return (
    <MonacoEditor
      height="100%"
      language={language}
      theme={resolvedTheme === 'dark' ? 'eizhu-dark' : 'eizhu-light'}
      value={content}
      onChange={(value: string | undefined) => onChange(value ?? '')}
      beforeMount={beforeMount}
      onMount={handleMount}
      loading={
        <Loading />
      }
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
        minimap: { enabled: content.length > 100_000 },
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: content.length > 500_000 ? 'on' : 'off',
        readOnly: readOnly || loading,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        automaticLayout: true,
      }}
    />
  )
}
