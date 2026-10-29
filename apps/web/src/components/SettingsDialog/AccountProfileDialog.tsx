import { useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { account, normalizeCommandError, type AccountUser } from '@eizhu/contracts'
import { accountApi } from '@/api/account'
import { useAccountStore } from '@/store/account'
import { Button } from '@/components/ui/button'
import { InlineError } from '@/components/ui/inline-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

export function AccountProfileDialog({ user, onClose }: { user: AccountUser; onClose: () => void }) {
  const [username, setUsername] = useState(user.username || user.email.split('@')[0].slice(0, 50))
  const [avatar, setAvatar] = useState(user.avatar || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const lock = useRef(false)

  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(normalizeCommandError(cause).error.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function selectAvatar(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
      throw new Error('请选择不超过 5 MB 的 PNG、JPG 或 WebP 图片。')
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error('无法读取这张图片，请选择有效的 PNG、JPG 或 WebP 图片。')
    })
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 128
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法处理头像，请重试。')
      const side = Math.min(bitmap.width, bitmap.height)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 128, 128)
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        128,
        128,
      )
      const next = canvas.toDataURL('image/jpeg', 0.85)
      if (!account['account.updateProfile'].input.shape.avatar.safeParse(next).success)
        throw new Error('头像处理失败，请选择其他图片。')
      setAvatar(next)
    } finally {
      bitmap.close()
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      const input = account['account.updateProfile'].input.safeParse({ username, avatar })
      if (!input.success) throw new Error('用户名需为 1–50 个字符。')
      const updated = await accountApi.updateProfile(input.data.username, input.data.avatar)
      useAccountStore.setState((state) =>
        state.status?.loggedIn && state.status.user.id === user.id
          ? { status: { ...state.status, user: updated } }
          : {},
      )
      onClose()
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose()
      }}
    >
      <DialogContent
        className="account-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (lock.current) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (lock.current) event.preventDefault()
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="account-dialog-close"
          aria-label="关闭资料窗口"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </Button>
        <div className="account-dialog-heading">
          <DialogTitle>编辑资料</DialogTitle>
          <DialogDescription>用户名和头像会同步到你的其他设备。</DialogDescription>
        </div>
        <form className="account-dialog-form" onSubmit={submit} aria-busy={busy}>
          <div className="account-profile-avatar">
            <span className="account-avatar" aria-hidden="true">
              {avatar ? <img src={avatar} alt="" /> : (username || user.email).slice(0, 1).toUpperCase()}
            </span>
            <div>
              <div className="account-avatar-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  更换头像
                </Button>
                {avatar && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setAvatar('')}
                  >
                    移除
                  </Button>
                )}
              </div>
              <p className="account-help">PNG、JPG 或 WebP，最大 5 MB</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="选择头像"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void run(() => selectAvatar(file))
              }}
            />
          </div>
          <div className="account-form-field">
            <Label htmlFor="account-username">用户名</Label>
            <Input
              id="account-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              maxLength={50}
              required
              disabled={busy}
              autoComplete="nickname"
            />
          </div>
          <div className="account-form-field">
            <Label htmlFor="account-profile-email">登录邮箱</Label>
            <Input
              id="account-profile-email"
              value={user.email}
              readOnly
              aria-describedby="account-profile-email-help"
            />
            <p className="account-help" id="account-profile-email-help">
              登录时使用此邮箱，用户名仅用于展示。
            </p>
          </div>
          <div className="account-dialog-actions">
            <InlineError message={error} className="account-error" />
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '正在处理…' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
