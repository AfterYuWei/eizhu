import { Save,RotateCcw,X,FileText,Lock,AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isMac } from '@/hooks/useWindowControls'

interface EditorToolbarProps {
  path: string | null
  dirty: boolean
  saving: boolean
  readOnly: boolean
  loading: boolean
  conflict: boolean
  hasSession: boolean
  onSave: () => void
  onCompare?: () => void
  onSaveAs?: () => void
  onReload: () => void
  onClose?: () => void
}

/** Editor toolbar: file path, dirty/save indicator, conflict warning,
 *  reload, and close. */
export function EditorToolbar({
  path,
  dirty,
  saving,
  readOnly,
  loading,
  conflict,
  hasSession,
  onSave,
  onCompare,
  onSaveAs,
  onReload,
  onClose,
}: EditorToolbarProps) {
  const canSave = hasSession && dirty && !saving && !readOnly && !loading

  // Extract filename from path
  const filename = path ? path.split(/[\\/]/).pop() || path : '文件编辑器'
  const shortcut = isMac() ? '⌘S' : 'Ctrl+S'

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar-left">
        <FileText size={16} className="editor-toolbar-icon" aria-hidden="true" />
        <div className="editor-toolbar-file">
          <div className="editor-toolbar-filename">
            <span className="editor-toolbar-path" title={filename}>{filename}</span>
            {dirty && <span className="editor-dirty-dot" role="img" aria-label="未保存" title="未保存" />}
          </div>
          <span className="editor-toolbar-directory" title={path || 'eizhu'}>{path || 'eizhu'}</span>
        </div>
        {readOnly && (
          <span className="editor-ro-badge" title="只读">
            <Lock size={11} /> 只读
          </span>
        )}
      </div>

      <div className="editor-toolbar-right">
        {conflict && (
          <span className="editor-conflict-badge" title="文件已被其他进程修改">
            <AlertTriangle size={12} /> 已被修改
          </span>
        )}

        {onCompare && <Button variant="ghost" size="sm" className="editor-btn ghost" onClick={onCompare} disabled={loading || saving || !hasSession}>{conflict ? '比较与合并' : '比较远端'}</Button>}
        {onSaveAs && <Button variant="ghost" size="sm" className="editor-btn ghost" onClick={onSaveAs} disabled={loading || saving || !hasSession}>另存为</Button>}
        <Tooltip><TooltipTrigger asChild><Button
          type="button"
          variant="outline"
          size="icon-xs"
          className="editor-btn"
          onClick={onReload}
          disabled={loading || !hasSession}
          title="重新加载（放弃本地修改）"
          aria-label="重新加载文件"
        >
          <RotateCcw size={13} />
        </Button></TooltipTrigger><TooltipContent>重新加载文件</TooltipContent></Tooltip>

        <Button
          type="button"
          className="editor-btn primary"
          onClick={onSave}
          disabled={!canSave}
          title={readOnly ? '文件为只读' : `保存 (${shortcut})`}
        >
          <Save size={13} />
          <span>{saving ? '保存中…' : '保存'}</span>
          <kbd className="editor-save-shortcut" aria-hidden="true">{shortcut}</kbd>
        </Button>

        {onClose && <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-xs" className="editor-btn ghost" onClick={onClose} title="关闭编辑器" aria-label="关闭编辑器">
          <X size={14} />
        </Button></TooltipTrigger><TooltipContent>关闭编辑器</TooltipContent></Tooltip>}
      </div>
    </div>
  )
}
