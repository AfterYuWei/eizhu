import { Loading,LoadingBar } from '@/components/ui/loading'
import { useEffect,useRef,useState } from 'react'
import {
File,Folder,AlertCircle,
FilePlus,FolderPlus,RefreshCw,Pencil,Trash2,Copy,Eye,EyeOff,
FolderOpen,FileEdit,Inbox,Crosshair
} from 'lucide-react'
import { useSessionStore } from '@/store/session'
import { useSidebarDetailStore } from '@/store/sidebarDetail'
import { useServerDetailStore } from '@/store/serverDetail'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { isDesktopRuntime } from '@/lib/platform'
import { EditorDialog } from '@/components/Editor/EditorDialog'
import { SftpContextMenu,type MenuItem } from '@/components/Sftp/SftpContextMenu'
import { InputDialog,validateSftpName } from '@/components/Sftp/InputDialog'
import { DeleteConfirmDialog } from '@/components/Sftp/DeleteConfirmDialog'
import { writeClipboardText } from '@/lib/clipboard'
import type { FileTreeNode } from '@/store/serverDetail'
import type { SftpEntry } from '@/types/sftp'

interface ServerDetailProps {
  tabId: string
  profileId: string
  profileName: string
  host: string
  port: number
  username: string
  /** When false the pane is hidden (display:none) but stays mounted. */
  active: boolean
}

export function ServerDetail({
  tabId,
  profileId,
  profileName,
  host,
  port,
  username,
  active,
}: ServerDetailProps) {
  const { tabs } = useSessionStore()
  const { getDetail, saveDetail, toggleFollowShellCwd } = useSidebarDetailStore()
  const {
    getStatus, navigateToParent, listFiles, mkdir, createFile, rename, deleteSelected,
    toggleShowHidden, refresh, select, clearSelection, getSelectedNodes
  } = useServerDetailStore()
  const tab = tabs.find((t) => t.id === tabId)
  const serverDetail = getStatus(profileId)
  const bodyRef = useRef<HTMLDivElement>(null)
  const detail = getDetail(tabId)

  // Context menu state
  const [ctx, setCtx] = useState<{ x: number; y: number; entry: FileTreeNode | null } | null>(null)
  // Dialog states
  const [newFileDialog, setNewFileDialog] = useState(false)
  const [newFolderDialog, setNewFolderDialog] = useState(false)
  const [renameDialog, setRenameDialog] = useState<{ path: string; currentName: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ entries: FileTreeNode[] } | null>(null)

  // Restore scroll position on mount / when becoming visible again.
  useEffect(() => {
    const el = bodyRef.current
    if (el && active) {
      el.scrollTop = detail.scrollTop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const cwd = tab?.cwd

  // Auto-navigate the file browser when the shell CWD changes and follow is on.
  useEffect(() => {
    if (!active || !cwd || !detail.followShellCwd || serverDetail.status !== 'connected') return
    // Read the shared browser path without making manual navigation or a failed
    // listing trigger another follow request. Only the visible terminal owns it.
    const currentPath = useServerDetailStore.getState().getStatus(profileId).currentPath || '/'
    if (cwd !== currentPath) {
      listFiles(profileId, cwd)
    }
  }, [active, cwd, detail.followShellCwd, listFiles, profileId, serverDetail.status, serverDetail.sessionId])

  // Manual navigation: any directory change initiated inside the file browser
  // (double-click folder, "..", breadcrumb, context menu) turns off the
  // follow-shell-CWD toggle first, so the browser stays where the user put it
  // instead of being yanked back on the next shell cd.
  const navigateManually = (path: string) => {
    if (detail.followShellCwd) {
      saveDetail(tabId, { followShellCwd: false })
    }
    listFiles(profileId, path)
  }
  const navigateToParentManually = () => {
    if (detail.followShellCwd) {
      saveDetail(tabId, { followShellCwd: false })
    }
    navigateToParent(profileId)
  }

  const handleScroll = () => {
    const el = bodyRef.current
    if (el && active) saveDetail(tabId, { scrollTop: el.scrollTop })
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const unit = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${parseFloat((bytes / 1024 ** unit).toFixed(1))} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
  }

  // Convert FileTreeNode to SftpEntry for dialogs
  const toSftpEntry = (node: FileTreeNode): SftpEntry => ({
    name: node.name,
    path: node.path,
    is_dir: node.isDir,
    size: node.size,
    mod_time: node.modTime,
    mode: node.mode,
  })

  // Get current path for new file/folder creation
  // If a directory is selected, use that path; otherwise use currentPath
  const getCurrentPath = (): string => {
    const selectedNodes = getSelectedNodes(profileId)
    if (selectedNodes.length === 1) {
      const node = selectedNodes[0]
      return node.isDir ? node.path : (node.path.substring(0, node.path.lastIndexOf('/')) || '/')
    }
    return serverDetail.currentPath || serverDetail.homeDir || '/'
  }

  // Context menu items for file/folder
  const fileMenuItems = (node: FileTreeNode): MenuItem[] => [
    ...(node.isDir || !isDesktopRuntime() ? [{
      id: 'open',
      label: node.isDir ? '打开文件夹' : '打开',
      icon: <FolderOpen size={13} />,
      onClick: () => {
        if (node.isDir) navigateManually(node.path)
        else useServerDetailStore.getState().openEditor(profileId, node.path)
      },
    }] : []),
    ...(!node.isDir && !isDesktopRuntime() ? [{
      id: 'edit',
      label: '编辑',
      icon: <FileEdit size={13} />,
      onClick: () => useServerDetailStore.getState().openEditor(profileId, node.path),
    }] : []),
    { id: 'd1', label: '', divider: true },
    { id: 'newFile', label: '新建文件', icon: <FilePlus size={13} />, onClick: () => setNewFileDialog(true) },
    { id: 'newFolder', label: '新建文件夹', icon: <FolderPlus size={13} />, onClick: () => setNewFolderDialog(true) },
    { id: 'd2', label: '', divider: true },
    { id: 'rename', label: '重命名', icon: <Pencil size={13} />, onClick: () => setRenameDialog({ path: node.path, currentName: node.name }) },
    { id: 'copy', label: '复制路径', icon: <Copy size={13} />, onClick: () => void writeClipboardText(node.path) },
    { id: 'd3', label: '', divider: true },
    { id: 'del', label: '删除', icon: <Trash2 size={13} />, danger: true, onClick: () => setDeleteConfirm({ entries: [node] }) },
  ]

  // Context menu items for blank area
  const blankMenuItems = (): MenuItem[] => [
    { id: 'newFile', label: '新建文件', icon: <FilePlus size={13} />, onClick: () => setNewFileDialog(true) },
    { id: 'newFolder', label: '新建文件夹', icon: <FolderPlus size={13} />, onClick: () => setNewFolderDialog(true) },
    { id: 'd1', label: '', divider: true },
    { id: 'refresh', label: '刷新', icon: <RefreshCw size={13} />, onClick: () => refresh(profileId) },
  ]

  // Dialog handlers
  const handleCreateFile = async (name: string) => {
    const currentPath = getCurrentPath()
    const filePath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`
    await createFile(profileId, filePath)
  }

  const handleCreateFolder = async (name: string) => {
    const currentPath = getCurrentPath()
    const folderPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`
    await mkdir(profileId, folderPath)
  }

  const handleRename = async (newName: string) => {
    if (!renameDialog) return
    const parentPath = renameDialog.path.substring(0, renameDialog.path.lastIndexOf('/')) || '/'
    const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`
    await rename(profileId, renameDialog.path, newPath)
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    const paths = deleteConfirm.entries.map((e) => e.path)
    await deleteSelected(profileId, paths)
  }

  const renderFileRow = (node: FileTreeNode) => {
    const isSelected = serverDetail.selected.has(node.path)

    // Single click: select only
    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      select(profileId, node.path, { additive: e.metaKey || e.ctrlKey })
    }

    // Double click: open file or navigate into directory
    const handleDoubleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (node.isDir) {
        // Navigate into directory
        navigateManually(node.path)
      } else {
        // Open file in editor
        const detail = useServerDetailStore.getState().getStatus(profileId)
        if (detail.sessionId) {
          useServerDetailStore.getState().openEditor(profileId, node.path)
        }
      }
    }

    return (
      <div
        key={node.path}
        className={`sdetail-file-row ${isSelected ? 'selected' : ''}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          // Don't select on right-click, only show context menu
          setCtx({ x: e.clientX, y: e.clientY, entry: node })
        }}
        role="button"
      >
        <div className="sdetail-file-left">
          {node.isDir ? (
            <Folder size={13} className="sdetail-file-icon dir" />
          ) : (
            <File size={13} className="sdetail-file-icon file" />
          )}
          <span className="sdetail-file-name">{node.name}</span>
        </div>
        <div className="sdetail-file-right">
          <span className="sdetail-file-size">
            {node.isDir ? '' : formatBytes(node.size)}
          </span>
        </div>
      </div>
    )
  }

  // Loading state for the whole component
  const isConnecting = serverDetail.status === 'connecting'
  const isConnected = serverDetail.status === 'connected'
  const hasError = !isConnecting && serverDetail.error

  return (
    <div className="flex flex-col h-full sdetail-pane" aria-hidden={!active}>
      {/* Header — server identity */}
      <div className="sdetail-hdr">
        <div className="sdetail-hdr-info">
          <span className="sdetail-hdr-name">{profileName}</span>
          <span className="sdetail-hdr-meta">
            {username}@{host}{port !== 22 ? `:${port}` : ''}
          </span>
        </div>
      </div>

      {/* File browser header — outside the scroll area */}
      <div className="sdetail-file-hdr">
        <h3 className="sdetail-file-title">
          <Folder size={11} aria-hidden="true" />
          <span>文件管理</span>
        </h3>
        {isConnected && (
          <div className="sdetail-file-actions">
            {/* Follow shell CWD toggle */}
            {tab?.cwd && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={`sdetail-act-btn${detail.followShellCwd ? ' sdetail-act-btn-active' : ''}`}
                title={detail.followShellCwd ? '自动跟随已开启：点击关闭' : '自动跟随已关闭：点击开启'}
                onClick={() => toggleFollowShellCwd(tabId)}
              >
                <Crosshair size={12} />
              </Button>
            )}
            {serverDetail.selected.size > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="sdetail-act-btn sdetail-act-btn-danger"
                title="删除选中"
                onClick={() => {
                  const selectedNodes = getSelectedNodes(profileId)
                  if (selectedNodes.length > 0) {
                    setDeleteConfirm({ entries: selectedNodes })
                  }
                }}
              >
                <Trash2 size={12} />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="sdetail-act-btn"
              title="刷新"
              onClick={() => refresh(profileId)}
            >
              <RefreshCw size={12} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="sdetail-act-btn"
              title={serverDetail.showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
              onClick={() => toggleShowHidden(profileId)}
            >
              {serverDetail.showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </Button>
          </div>
        )}
      </div>

      {/* Current path display - clickable to edit */}
      {isConnected && (
        <PathBreadcrumb
          path={serverDetail.currentPath || '/'}
          onNavigate={navigateManually}
        />
      )}

      <div className="sdetail-load-track">
        {(isConnecting || serverDetail.loading) && <LoadingBar label={isConnecting ? '正在连接服务器文件服务' : '正在读取服务器文件列表'} />}
      </div>

      {/* File browser list — fills remaining space, scrolls independently */}
      <div
        className="sdetail-file-area"
        aria-busy={isConnecting || serverDetail.loading}
        ref={bodyRef}
        onScroll={handleScroll}
        onClick={(e) => {
          // Clear selection when clicking on empty area
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.sdetail-file-empty')) {
            clearSelection(profileId)
          }
        }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.sdetail-file-empty')) {
            e.preventDefault()
            setCtx({ x: e.clientX, y: e.clientY, entry: null })
          }
        }}
      >
        <div className="sdetail-file-list">
          {isConnecting && (
            <Loading />
          )}
          {hasError && (
            <div className="sdetail-file-error">
              <AlertCircle size={14} />
              <span>{serverDetail.error}</span>
            </div>
          )}
          {isConnected && (
            <>
              {/* Parent directory entry ".." */}
              {serverDetail.currentPath !== '/' && serverDetail.currentPath !== '' && (
                <div
                  className="sdetail-file-row"
                  style={{ cursor: 'pointer' }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    navigateToParentManually()
                  }}
                  role="button"
                >
                  <div className="sdetail-file-left">
                    <Folder size={13} className="sdetail-file-icon dir" />
                    <span className="sdetail-file-name">..</span>
                  </div>
                  <div className="sdetail-file-right">
                    <span className="sdetail-file-size" />
                  </div>
                </div>
              )}
              {serverDetail.loading && (
                <Loading />
              )}
              {!serverDetail.loading && !hasError && serverDetail.files.length === 0 && (
                <div className="sdetail-file-empty sdetail-file-loading">
                  <Inbox size={14} />
                  <span>空文件夹</span>
                </div>
              )}
              {!serverDetail.loading && serverDetail.files.map((f) => renderFileRow(f))}
            </>
          )}
        </div>
      </div>

      {!isDesktopRuntime() && <EditorDialog />}

      {/* Context Menu */}
      {ctx && (
        <SftpContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctx.entry ? fileMenuItems(ctx.entry) : blankMenuItems()}
          onClose={() => setCtx(null)}
        />
      )}

      {/* Dialogs */}
      <InputDialog
        open={newFileDialog}
        onOpenChange={setNewFileDialog}
        title="新建文件"
        label="文件名"
        placeholder="请输入文件名"
        confirmText="创建"
        onSubmit={handleCreateFile}
        validate={validateSftpName}
      />

      <InputDialog
        open={newFolderDialog}
        onOpenChange={setNewFolderDialog}
        title="新建文件夹"
        label="文件夹名称"
        placeholder="请输入文件夹名称"
        confirmText="创建"
        onSubmit={handleCreateFolder}
        validate={validateSftpName}
      />

      <InputDialog
        open={renameDialog !== null}
        onOpenChange={(open) => !open && setRenameDialog(null)}
        title="重命名"
        label="新名称"
        placeholder="请输入新名称"
        defaultValue={renameDialog?.currentName || ''}
        confirmText="确认"
        onSubmit={handleRename}
        validate={(name) => {
          const baseError = validateSftpName(name)
          if (baseError) return baseError
          if (renameDialog && name === renameDialog.currentName) return '新名称不能与原名称相同'
          return null
        }}
      />

      <DeleteConfirmDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        entries={deleteConfirm?.entries.map(toSftpEntry) || []}
        onConfirm={handleDelete}
      />
    </div>
  )
}

/** Path breadcrumb component - supports selection, copy, and manual input navigation */
function PathBreadcrumb({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(path)
  const inputRef = useRef<HTMLInputElement>(null)

  // Enter edit mode
  const handleDoubleClick = () => {
    setEditValue(path)
    setIsEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  // Submit navigation
  const handleSubmit = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== path) {
      onNavigate(trimmed)
    }
    setIsEditing(false)
  }

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <div className="sdetail-file-path editing">
        <Input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="sdetail-path-input"
          spellCheck={false}
        />
      </div>
    )
  }

  return (
    <div
      className="sdetail-file-path"
      title={`${path}\n双击编辑路径`}
      onDoubleClick={handleDoubleClick}
    >
      {path}
    </div>
  )
}
