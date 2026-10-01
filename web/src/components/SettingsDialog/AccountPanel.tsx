import { useEditorStore } from '@/store/editor'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useState, type FormEvent } from 'react'
import { Cloud, Loader2, LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccountStore } from '@/store/account'

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function AccountPanel() {
  const { status, loading, error, login, register, logout, refresh } = useAccountStore()
  const [reauth, setReauth] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState('')
  const [switchAction, setSwitchAction] = useState<'login' | 'register' | 'logout' | null>(null)
  const dirtyTabs = useEditorStore((s) => s.tabs.filter((tab) => tab.content !== tab.originalContent))
  const finishSwitch = async (save: boolean) => {
    if (!switchAction) return
    if (save) { for (const tab of dirtyTabs) { if (!await useEditorStore.getState().saveFile(tab.id)) return } }
    const action = switchAction; setSwitchAction(null)
    try { if (action === 'logout') await logout(); else if (action === 'login') await login(email, password); else await register(email, password); setPassword(''); setConfirm(''); setReauth(false) }
    catch { /* store exposes the error */ }
  }
  const switchDialog = <AlertDialog open={switchAction !== null} onOpenChange={(open) => { if (!open) setSwitchAction(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>切换数据空间</AlertDialogTitle><AlertDialogDescription>切换将关闭 SSH 连接并取消 SFTP 传输。待同步操作保留在原空间。{dirtyTabs.length > 0 ? `有 ${dirtyTabs.length} 个文件尚未保存，可先保存或放弃修改。` : '原空间的数据和备份配置将独立保留。'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel>{dirtyTabs.length > 0 && <AlertDialogAction onClick={(event) => { event.preventDefault(); void finishSwitch(true) }}>保存文件后切换</AlertDialogAction>}<AlertDialogAction onClick={(event) => { event.preventDefault(); void finishSwitch(false) }}>{dirtyTabs.length > 0 ? '放弃修改并切换' : '确认切换'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

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
    setSwitchAction(mode)
  }

  if (status?.loggedIn && status.user && !reauth) {
    const used = status.user.storageUsed
    const quota = status.user.storageQuota
    const percent = Math.min(100, used / Math.max(1, quota) * 100)
    return <div className="account-panel">{switchDialog}
      <div className="sync-hero account-hero">
        <div className="sync-hero-left"><span className="sync-hero-icon ok"><UserRound size={22} /></span><div className="sync-hero-body"><div className="sync-hero-status"><span className="sync-hero-dot ok" />已登录</div><div className="sync-hero-meta">{status.user.email}</div></div></div>
        <div className="sync-hero-actions"><Button variant="outline" size="sm" disabled={loading} onClick={() => { setEmail(status.user?.email ?? ''); setMode('login'); setReauth(true) }}>重新登录／切换账号</Button><Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />刷新</Button><Button variant="outline" size="sm" disabled={loading} onClick={() => setSwitchAction('logout')}><LogOut size={13} />退出登录</Button></div>
      </div>
      <div className="backup-card account-card">
        <div className="settings-subsection-title"><Cloud size={13} /><span>账号云同步</span></div>
        <p className="settings-field-desc">解锁并完成首次接入后，数据修改自动实时同步。</p>
        <div className="account-usage"><div><span>已使用 {formatSize(used)}</span><span>共 {formatSize(quota)}</span></div><i><em style={{ width: `${percent}%` }} /></i></div>
        <div className="backup-warning"><ShieldCheck size={13} /><span>同步密码与账号密码相互独立。首次同步前请前往「云同步」解锁同步数据并预览首次接入。</span></div>
      </div>
      {error && <div className="account-error">{error}</div>}
    </div>
  }

  return <form className="account-panel" onSubmit={submit}>{switchDialog}
    {reauth && <Button variant="outline" type="button" onClick={() => setReauth(false)}>返回账号</Button>}
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
