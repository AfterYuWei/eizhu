import { useState, type FormEvent } from 'react'
import { Cloud, Loader2, LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAccountStore } from '@/store/account'

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function AccountPanel() {
  const { status, loading, error, login, register, logout, refresh, setSyncEnabled } = useAccountStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')
    if (mode === 'register' && password !== confirm) {
      setLocalError('两次输入的密码不一致')
      return
    }
    if (password.length < 8) {
      setLocalError('密码至少需要 8 位')
      return
    }
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password)
      setPassword(''); setConfirm('')
    } catch { /* store exposes the translated error */ }
  }

  if (status?.loggedIn && status.user) {
    const used = status.user.storageUsed
    const quota = status.user.storageQuota
    const percent = Math.min(100, used / Math.max(1, quota) * 100)
    return <div className="account-panel">
      <div className="sync-hero account-hero">
        <div className="sync-hero-left"><span className="sync-hero-icon ok"><UserRound size={22} /></span><div className="sync-hero-body"><div className="sync-hero-status"><span className="sync-hero-dot ok" />已登录</div><div className="sync-hero-meta">{status.user.email}</div></div></div>
        <div className="sync-hero-actions"><Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />刷新</Button><Button variant="outline" size="sm" disabled={loading} onClick={() => void logout()}><LogOut size={13} />退出登录</Button></div>
      </div>
      <div className="backup-card account-card">
        <div className="settings-subsection-title"><Cloud size={13} /><span>账号云同步</span></div>
        <div className="settings-field"><div className="settings-field-info"><Label className="settings-field-label">启用账号同步</Label><span className="settings-field-desc">自动使用当前账号的加密云存储</span></div><Switch checked={status.syncEnabled} disabled={loading} onCheckedChange={(enabled) => void setSyncEnabled(enabled)} /></div>
        <div className="account-usage"><div><span>已使用 {formatSize(used)}</span><span>共 {formatSize(quota)}</span></div><i><em style={{ width: `${percent}%` }} /></i></div>
        <div className="backup-warning"><ShieldCheck size={13} /><span>同步密码与账号密码相互独立。首次同步前请前往「云同步」设置同步密码并查看版本历史。</span></div>
      </div>
      {error && <div className="account-error">{error}</div>}
    </div>
  }

  return <form className="account-panel" onSubmit={submit}>
    <div className="account-welcome"><span><UserRound size={24} /></span><div><h3>{mode === 'login' ? '登录 eizhu 账号' : '注册 eizhu 账号'}</h3><p>登录后可使用按账号隔离的端到端加密同步。</p></div></div>
    <div className="backup-card account-form-card">
      <div className="account-form-field"><Label htmlFor="account-email">邮箱</Label><Input id="account-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
      <div className="account-form-field"><Label htmlFor="account-password">密码</Label><Input id="account-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
      {mode === 'register' && <div className="account-form-field"><Label htmlFor="account-confirm">确认密码</Label><Input id="account-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>}
      {(localError || error) && <div className="account-error">{localError || error}</div>}
      <Button type="submit" disabled={loading}>{loading ? <Loader2 size={14} className="animate-spin" /> : <UserRound size={14} />}{mode === 'login' ? '登录' : '创建账号'}</Button>
      <button type="button" className="account-mode-link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setLocalError('') }}>{mode === 'login' ? '没有账号？注册新账号' : '已有账号？返回登录'}</button>
    </div>
  </form>
}
