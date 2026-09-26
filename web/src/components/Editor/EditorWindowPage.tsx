import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Toaster } from '@/components/ui/sonner'
import { useWindowControls } from '@/hooks/useWindowControls'
import { useResolvedTheme } from '@/store/settings'
import { type EditorSessionType, useActiveTab, useEditorStore } from '@/store/editor'
import { CodeEditor } from './CodeEditor'
import { EditorToolbar } from './EditorToolbar'
import { EditorStatusBar } from './EditorStatusBar'
import { EditorTabs } from './EditorTabs'

interface EditorOpenRequest {
  sessionId: string
  sessionType: EditorSessionType
  path: string
}

type PendingClose = { kind: 'window' } | { kind: 'tab'; tabId: string }

const SKELETON_WIDTHS = [52, 74, 43, 81, 61, 36, 69, 48, 86, 57, 72, 39, 64, 78, 45, 83, 55, 68]

function isDirty(tab: { content: string; originalContent: string }): boolean {
  return tab.content !== tab.originalContent
}

/** Standalone desktop editor webview with its own multi-file tab strip. */
export function EditorWindowPage() {
  const tabs = useEditorStore((state) => state.tabs)
  const activeTabId = useEditorStore((state) => state.activeTabId)
  const activeTab = useActiveTab()
  const openFile = useEditorStore((state) => state.openFile)
  const closeTab = useEditorStore((state) => state.closeTab)
  const closeAll = useEditorStore((state) => state.closeAll)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const setContent = useEditorStore((state) => state.setContent)
  const saveFile = useEditorStore((state) => state.saveFile)
  const reloadFile = useEditorStore((state) => state.reloadFile)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [closingBusy, setClosingBusy] = useState(false)
  const allowCloseRef = useRef(false)
  const theme = useResolvedTheme()
  const { desktop, mac, showControls, maximized, minimize, toggleMaximize } = useWindowControls()

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listen<EditorOpenRequest>('eizhu-editor-open-file', ({ payload }) => {
      void openFile(payload.sessionId, payload.sessionType, payload.path)
    }).then((stopListening) => {
      if (disposed) {
        stopListening()
        return
      }
      unlisten = stopListening
      return getCurrentWindow().label === 'editor' ? invoke('editor_window_ready') : undefined
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Editor window initialization failed:', message)
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [openFile])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void getCurrentWindow().onCloseRequested((event) => {
      if (allowCloseRef.current) return
      const hasDirtyTabs = useEditorStore.getState().tabs.some(isDirty)
      if (hasDirtyTabs) {
        event.preventDefault()
        setPendingClose({ kind: 'window' })
      }
    }).then((stopListening) => {
      if (disposed) stopListening()
      else unlisten = stopListening
    }).catch((error: unknown) => {
      console.error('Editor close guard initialization failed:', error)
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const closeWindow = useCallback(async () => {
    allowCloseRef.current = true
    try {
      await getCurrentWindow().close()
    } catch (error) {
      allowCloseRef.current = false
      const message = error instanceof Error ? error.message : String(error)
      toast.error('无法关闭编辑器窗口', { description: message })
    }
  }, [])

  const closeFileTab = useCallback(async (tabId: string) => {
    closeTab(tabId)
    if (useEditorStore.getState().tabs.length === 0) {
      await closeWindow()
    }
  }, [closeTab, closeWindow])

  const requestCloseTab = (tabId: string) => {
    const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId)
    if (!tab) return
    if (isDirty(tab)) {
      setPendingClose({ kind: 'tab', tabId })
      return
    }
    void closeFileTab(tabId)
  }

  const requestCloseWindow = () => {
    const hasDirtyTabs = useEditorStore.getState().tabs.some(isDirty)
    if (hasDirtyTabs) {
      setPendingClose({ kind: 'window' })
      return
    }
    void closeWindow()
  }

  const discardPendingClose = () => {
    const request = pendingClose
    setPendingClose(null)
    if (!request) return
    if (request.kind === 'tab') {
      void closeFileTab(request.tabId)
    } else {
      closeAll()
      void closeWindow()
    }
  }

  const saveAndClose = async () => {
    const request = pendingClose
    if (!request || closingBusy) return
    setClosingBusy(true)
    try {
      const ids = request.kind === 'tab'
        ? [request.tabId]
        : useEditorStore.getState().tabs.filter(isDirty).map((tab) => tab.id)

      for (const tabId of ids) {
        if (!await saveFile(tabId)) return
      }

      const currentTabs = useEditorStore.getState().tabs
      if (request.kind === 'tab') {
        const tab = currentTabs.find((item) => item.id === request.tabId)
        if (tab && isDirty(tab)) return
      } else if (currentTabs.some(isDirty)) {
        return
      }

      setPendingClose(null)
      if (request.kind === 'tab') {
        await closeFileTab(request.tabId)
      } else {
        closeAll()
        await closeWindow()
      }
    } finally {
      setClosingBusy(false)
    }
  }

  const tabItems = tabs.map((tab) => ({
    id: tab.id,
    filename: tab.filename,
    dirty: isDirty(tab),
    active: tab.id === activeTabId,
  }))
  const activeDirty = activeTab ? isDirty(activeTab) : false

  return (
    <div className="editor-window" role="application" aria-label="文件编辑器">
      <header
        className={`eizhu-header titlebar editor-window-header ${desktop ? 'is-desktop' : ''} ${mac ? 'is-mac' : ''}`}
        data-tauri-drag-region={desktop || undefined}
      >
        <div className="editor-window-drag-region" data-tauri-drag-region={desktop || undefined}>
          <span>eizhu · 文件编辑器</span>
        </div>
        {showControls && (
          <div className="titlebar-controls">
            <Button type="button" variant="ghost" className="tb-btn tb-min" title="最小化" aria-label="最小化" onClick={minimize}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" /></svg>
            </Button>
            <Button type="button" variant="ghost" className="tb-btn tb-max" title={maximized ? '还原' : '最大化'} aria-label={maximized ? '还原' : '最大化'} onClick={toggleMaximize}>
              {maximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="0.5" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="0.8" /><path d="M1 2v7h7" fill="none" stroke="currentColor" strokeWidth="0.8" /></svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
              )}
            </Button>
            <Button type="button" variant="ghost" className="tb-btn tb-close" title="关闭" aria-label="关闭编辑器窗口" onClick={requestCloseWindow}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" /></svg>
            </Button>
          </div>
        )}
      </header>

      <div className="editor-window-content">
        {activeTab ? (
          <>
            <EditorTabs tabs={tabItems} onSelect={setActiveTab} onClose={requestCloseTab} />
            <EditorToolbar
              path={activeTab.path}
              dirty={activeDirty}
              saving={activeTab.saving}
              readOnly={activeTab.readOnly}
              loading={activeTab.loading}
              conflict={activeTab.conflict}
              hasSession={!!activeTab.sessionId}
              onSave={() => void saveFile(activeTab.id)}
              onReload={() => void reloadFile(activeTab.id)}
              onClose={requestCloseWindow}
            />
            <div className="editor-body">
              {activeTab.loading ? (
                <div className="editor-loading">
                  <div className="editor-skeleton">
                    {SKELETON_WIDTHS.map((width, index) => (
                      <div key={index} className="editor-skel-line">
                        <Skeleton className="editor-skel-gutter" />
                        <Skeleton className="editor-skel-code" style={{ width: `${width}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <CodeEditor
                  content={activeTab.content}
                  language={activeTab.language}
                  readOnly={activeTab.readOnly}
                  loading={activeTab.loading}
                  onChange={(value) => setContent(activeTab.id, value)}
                  onSave={() => void saveFile(activeTab.id)}
                />
              )}
            </div>
            <EditorStatusBar
              language={activeTab.language}
              lineEnding={activeTab.lineEnding}
              contentLength={activeTab.content.length}
              dirty={activeDirty}
              error={activeTab.error}
            />
          </>
        ) : (
          <div className="editor-window-empty">
            <FileText size={22} />
            <span>在主窗口中双击文件，即可在此打开</span>
          </div>
        )}
      </div>

      <AlertDialog open={pendingClose !== null} onOpenChange={(open) => !open && !closingBusy && setPendingClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingClose?.kind === 'tab' ? '关闭前保存文件？' : '关闭前保存修改？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingClose?.kind === 'tab'
                ? '当前文件有未保存的修改。保存后关闭、放弃修改，或继续编辑。'
                : '一个或多个文件有未保存的修改。保存所有文件后关闭，或放弃修改。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closingBusy}>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              className="border bg-background text-foreground hover:bg-accent"
              disabled={closingBusy}
              onClick={(event) => {
                event.preventDefault()
                discardPendingClose()
              }}
            >
              放弃修改
            </AlertDialogAction>
            <Button type="button" disabled={closingBusy} onClick={() => void saveAndClose()}>
              {closingBusy ? '保存中…' : '保存并关闭'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster theme={theme} />
    </div>
  )
}
