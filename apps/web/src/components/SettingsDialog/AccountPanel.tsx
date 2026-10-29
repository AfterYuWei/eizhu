import { useRef, useState } from 'react'
import { Ellipsis, LogOut, Repeat2, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccountStore } from '@/store/account'
import { useAccountDialogStore } from '@/store/accountDialog'
import { AccountProfileDialog } from './AccountProfileDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { runDesktopAction } from '@/lib/desktopActions'

export function AccountPanel() {
  const { status, loading, error, logout } = useAccountStore()
  const [editing, setEditing] = useState(false)
  const openingDialog = useRef(false)
  const open = useAccountDialogStore((s) => s.open)
  return (
    <section className="settings-section settings-stack" aria-label="账号设置">
      <div className="settings-section-title">
        <UserRound size={14} />
        <span>账号设置</span>
      </div>
      <div className="settings-card">
        <div className="settings-field account-summary">
          {status?.loggedIn && (
            <span className="account-avatar" aria-hidden="true">
              {status.user.avatar ? (
                <img src={status.user.avatar} alt="" />
              ) : (
                (status.user.username || status.user.email).slice(0, 1).toUpperCase()
              )}
            </span>
          )}
          <div className="settings-field-info">
            <span className="settings-field-label">
              {status?.loggedIn ? status.user.username || status.user.email : '登录你的账号'}
            </span>
            <p className="settings-field-desc">
              {status?.loggedIn
                ? status.sessionState === 'reauth_required'
                  ? '登录已失效，账号空间和本地修改仍保留。'
                  : status.user.username
                    ? status.user.email
                    : '使用邮箱登录，自动解锁加密数据。'
                : '在多台设备间安全同步服务器、凭据、分组和命令片段。'}
            </p>
          </div>
          <div className="account-summary-actions">
            {!status?.loggedIn ? (
              <>
                <Button size="sm" onClick={() => open('login')}>
                  登录
                </Button>
                <Button size="sm" variant="secondary" onClick={() => open('register')}>
                  创建账号
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={loading}
                  onClick={() =>
                    status.sessionState === 'reauth_required'
                      ? open('login', status.user.email)
                      : setEditing(true)
                  }
                >
                  {status.sessionState === 'reauth_required' ? '重新登录' : '编辑资料'}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" disabled={loading} aria-label="更多账号操作">
                      <Ellipsis size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onCloseAutoFocus={(event) => {
                      if (openingDialog.current) {
                        event.preventDefault()
                        openingDialog.current = false
                      }
                    }}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        openingDialog.current = true
                        open('login')
                      }}
                    >
                      <Repeat2 />
                      切换账号
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                      <LogOut />
                      退出账号
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </div>
      {status?.loggedIn && (
        <div className="settings-card">
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">账号安全</span>
              <p className="settings-field-desc">
                主密码用于登录与解锁。忘记时只能在仍可解锁的设备上恢复，退出账号会清除本机解锁资料。
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={loading || status.sessionState !== 'authenticated'}
              onClick={() => open('change', status.user.email)}
            >
              修改主密码
            </Button>
          </div>
        </div>
      )}
      {editing && status?.loggedIn && status.sessionState === 'authenticated' && (
        <AccountProfileDialog user={status.user} onClose={() => setEditing(false)} />
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <div className="settings-card">
        <div className="settings-field">
          <div className="settings-field-info">
            <span className="settings-field-label">账号条目同步</span>
            <p className="settings-field-desc">首次接入会预览离线与云端数据，确认前不上传本地条目。</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => runDesktopAction('sync-settings')}>
            同步设置
          </Button>
        </div>
      </div>
    </section>
  )
}
