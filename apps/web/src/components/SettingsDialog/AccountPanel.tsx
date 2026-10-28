import { UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccountStore } from '@/store/account'
import { useAccountDialogStore } from '@/store/accountDialog'
import { runDesktopAction } from '@/lib/desktopActions'

export function AccountPanel() {
  const { status, loading, error, logout, refresh } = useAccountStore()
  const open = useAccountDialogStore((s) => s.open)
  return (
    <section className="settings-section settings-stack" aria-label="账号设置">
      <div className="settings-section-title">
        <UserRound size={14} />
        <span>账号设置</span>
      </div>
      <div className="settings-card">
        <div className="settings-field">
          <div className="settings-field-info">
            <span className="settings-field-label">
              {status?.loggedIn ? status.user.email : '登录你的账号'}
            </span>
            <p className="settings-field-desc">
              {status?.loggedIn
                ? status.sessionState === 'reauth_required'
                  ? '登录已失效，账号空间和本地修改仍保留。'
                  : '邮箱已验证，登录时已解锁加密数据。'
                : '在多台设备间安全同步服务器、凭据、分组和命令片段。'}
            </p>
          </div>
          <span className="settings-status">
            {status?.loggedIn
              ? status.sessionState === 'reauth_required'
                ? '需要登录'
                : '已登录'
              : '未登录'}
          </span>
        </div>
        <div className="settings-card-footer">
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
                    : void refresh().catch(() => undefined)
                }
              >
                {status.sessionState === 'reauth_required' ? '重新登录' : '刷新账号'}
              </Button>
              <Button size="sm" variant="secondary" disabled={loading} onClick={() => open('login')}>
                切换账号
              </Button>
              <Button size="sm" variant="secondary" disabled={loading} onClick={() => void logout()}>
                退出账号
              </Button>
            </>
          )}
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
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">云端存储</span>
              <p className="settings-field-desc">
                {(status.user.storageUsed / 1048576).toFixed(1)} /{' '}
                {(status.user.storageQuota / 1048576).toFixed(1)} MiB
              </p>
            </div>
          </div>
        </div>
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
