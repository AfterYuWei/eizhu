import { useId, useRef, useState } from 'react'
import { FolderInput, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { PendingDirectoryDrop, SftpStore } from '@/store/sftp'
import { useSftpStore } from './storeContext'

export function DirectoryTransferDialog() {
  const pending = useSftpStore((state) => state.pendingDirectoryDrop)
  const resolve = useSftpStore((state) => state.resolveDirectoryDrop)
  if (!pending) return null

  return <DirectoryTransferConfirmation pending={pending} resolve={resolve} />
}

function DirectoryTransferConfirmation({
  pending,
  resolve,
}: {
  pending: PendingDirectoryDrop
  resolve: SftpStore['resolveDirectoryDrop']
}) {
  const [archive, setArchive] = useState(false)
  const archiveId = useId()
  const archiveDescriptionId = useId()
  const submitButton = useRef<HTMLButtonElement>(null)
  const count = pending.drag.entries.filter((entry) => entry.is_dir).length
  const files = pending.drag.entries.length - count
  const selection =
    pending.drag.entries.length === 1
      ? pending.drag.entries[0].name
      : `${pending.drag.entries[0].name} 等 ${pending.drag.entries.length} 项`
  return (
    <Dialog open onOpenChange={(open) => !open && resolve(null)}>
      <DialogContent
        showCloseButton={false}
        className="sftp-dialog sftp-dir-mode"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          submitButton.current?.focus()
        }}
      >
        <form
          className="sftp-dir-mode-form"
          onSubmit={(event) => {
            event.preventDefault()
            void resolve(archive ? 'archive' : 'preserve')
          }}
        >
          <div className="sftp-dir-mode-header">
            <FolderInput size={18} aria-hidden="true" />
            <DialogTitle>传输文件夹</DialogTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="sftp-dir-mode-close"
                  onClick={() => resolve(null)}
                  aria-label="关闭"
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>关闭</TooltipContent>
            </Tooltip>
          </div>
          <div className="sftp-dir-mode-body">
            <DialogDescription>
              已选择 {count} 个文件夹{files > 0 ? `和 ${files} 个文件` : ''}，
              {archive ? '文件夹将以压缩包传输' : '将保留目录结构'}。
            </DialogDescription>
            <div className="sftp-dir-mode-target">
              <span className="sftp-dir-mode-label">内容</span>
              <span className="sftp-dir-mode-selection">{selection}</span>
              <span className="sftp-dir-mode-label">目标</span>
              <span className="sftp-dir-mode-server" title={pending.target.serverName}>
                {pending.target.serverName}
              </span>
              <div className="sftp-dir-mode-path" role="region" aria-label="目标目录" tabIndex={0}>
                {pending.target.destDir}
              </div>
            </div>
            <div className="sftp-dir-mode-options">
              <Checkbox
                id={archiveId}
                checked={archive}
                onCheckedChange={(checked) => setArchive(checked === true)}
                aria-describedby={archiveDescriptionId}
              />
              <div className="sftp-dir-mode-option-copy">
                <Label htmlFor={archiveId}>压缩为 .tar.gz 后传输</Label>
                <p id={archiveDescriptionId} className="sftp-dir-mode-option-description">
                  每个文件夹生成一个压缩包，目标端不会自动解压。{files > 0 && '普通文件仍按原样传输。'}
                </p>
              </div>
            </div>
          </div>
          <div className="sftp-dir-mode-footer">
            <Button type="button" variant="outline" onClick={() => resolve(null)}>
              取消
            </Button>
            <Button ref={submitButton} type="submit">
              开始传输
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
