import { runDesktopAction } from '@/lib/desktopActions'
import { UserRound } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSyncStore } from '@/store/sync'
import { useAccountStore } from '@/store/account'
import { AccountEmailForm } from './AccountEmailForm'

export function AccountPanel() {
  const syncInitialized = useSyncStore(state=>state.status?.initialized)
  const { status, loading, error, login, register, logout, refresh } = useAccountStore()
  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'verify' | null>(null)
  const [email, setEmail] = useState(status?.user?.email ?? '')
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState('')
  const lock = useRef(false)
  const loggedIn = status?.loggedIn === true
  const selected = mode ?? (loggedIn ? null : 'login')
  const choose = (next: typeof mode) => {
    setMode(next)
    setPassword('')
    setConfirm('')
    setFormError('')
    useAccountStore.setState({ error: null })
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current) return
    setFormError('')
    if (selected === 'register' && password !== confirm) {
      setFormError('两次输入的密码不一致')
      return
    }
    if (selected === 'register' && new TextEncoder().encode(password).byteLength > 72) {
      setFormError('登录密码不能超过 72 个 UTF-8 字节')
      return
    }
    lock.current = true
    try {
      await (selected === 'register' ? register(email.trim(), password) : login(email.trim(), password))
      setPassword('')
      setConfirm('')
      setMode(null)
    } catch {
      /* The store exposes the normalized service error. */
    } finally {
      lock.current = false
    }
  }
  return (
    <section className="settings-section settings-stack" aria-label="账号设置">
      <div className="settings-section-title">
        <UserRound size={14} aria-hidden="true" />
        <span>账号设置</span>
      </div>
      {loggedIn && selected === null && (
        <div className="settings-card">
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">{status.user.email}</span>
              <p className="settings-field-desc">
                {status.sessionState === 'reauth_required'
                  ? '登录已失效，账号空间和本地修改仍保留，请重新登录。'
                  : '已进入独立账号空间，离线时仍可使用本地数据。'}
              </p>
            </div>
            <span className="settings-status">
              {status.sessionState === 'reauth_required' ? '需要登录' : '已登录'}
            </span>
          </div>
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">邮箱验证</span>
              <p className="settings-field-desc">
                {status.user.emailVerified
                  ? '邮箱已验证'
                  : status.user.verificationRequired
                    ? '使用账号同步前需要验证邮箱'
                    : '账号当前无需强制验证'}
              </p>
            </div>
            {!status.user.emailVerified && status.sessionState === 'authenticated' && (
              <Button size="sm" variant="outline" disabled={loading} onClick={() => choose('verify')}>
                验证邮箱
              </Button>
            )}
          </div>
          <div className="settings-field">
            <div className="settings-field-info">
              <span className="settings-field-label">账号存储用量</span>
              <p className="settings-field-desc">
                {formatBytes(status.user.storageUsed)} / {formatBytes(status.user.storageQuota)}
              </p>
            </div>
          </div>
          <div className="settings-card-footer">
            {status.sessionState === 'reauth_required' ? (
              <Button
                size="sm"
                disabled={loading}
                onClick={() => {
                  setEmail(status.user.email)
                  choose('login')
                }}
              >
                重新登录
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => {
                  void refresh().catch(() => undefined)
                }}
              >
                刷新账号
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={loading} onClick={() => choose('login')}>
              切换账号
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => {
                void logout()
              }}
            >
              退出账号
            </Button>
          </div>
        </div>
      )}
      {(selected === 'login' || selected === 'register') && (
        <form className="settings-card account-form-card" onSubmit={submit}>
          <div className="backup-row">
            <Button
              type="button"
              size="sm"
              variant={selected === 'login' ? 'default' : 'ghost'}
              disabled={loading}
              onClick={() => choose('login')}
            >
              登录
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selected === 'register' ? 'default' : 'ghost'}
              disabled={loading}
              onClick={() => choose('register')}
            >
              注册
            </Button>
          </div>
          <div className="account-form-field">
            <Label htmlFor="account-email">邮箱</Label>
            <Input
              id="account-email"
              type="email"
              autoComplete="username"
              maxLength={255}
              required
              value={email}
              disabled={loading}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="account-form-field">
            <Label htmlFor="account-password">登录密码</Label>
            <Input
              id="account-password"
              type="password"
              autoComplete={selected === 'register' ? 'new-password' : 'current-password'}
              minLength={selected === 'register' ? 8 : 1}
              maxLength={128}
              required
              value={password}
              disabled={loading}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {selected === 'register' && (
            <div className="account-form-field">
              <Label htmlFor="account-confirm">确认登录密码</Label>
              <Input
                id="account-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                disabled={loading}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
          )}
          {formError && (
            <p role="alert" className="account-error">
              {formError}
            </p>
          )}
          <Button type="submit" disabled={loading}>
            {loading ? '正在提交…' : selected === 'register' ? '注册并登录' : '登录账号'}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => choose('reset')}>
            找回登录密码
          </Button>
          {loggedIn && (
            <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => choose(null)}>
              返回账号
            </Button>
          )}
        </form>
      )}
      {selected === 'verify' && (
        <AccountEmailForm
          purpose="verify"
          email={status?.user?.email}
          onComplete={() => {
            choose(null)
          }}
          onCancel={() => choose(null)}
        />
      )}
      {selected === 'reset' && (
        <AccountEmailForm
          purpose="reset"
          email={email}
          onComplete={() => {
            choose('login')
          }}
          onCancel={() => choose(loggedIn ? null : 'login')}
        />
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <div className="settings-card">
        <div className="settings-field" role="status">
          <div className="settings-field-info">
            <span className="settings-field-label">账号条目同步</span>
            <p className="settings-field-desc">
              首次接入会预览离线与云端数据，确认前不上传本地条目。完整版本与第三方备份独立使用。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={()=>runDesktopAction('sync-settings')}>{loggedIn && !syncInitialized ? '开始同步接入' : '同步设置'}</Button>
        </div>
      </div>
    </section>
  )
}
function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${bytes} B`
}
