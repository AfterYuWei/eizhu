import { useRef, useState, type FormEvent } from 'react'
import { accountApi } from '@/api/account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AccountEmailForm({ purpose, email: initialEmail = '', onComplete, onCancel }: {
  purpose: 'verify' | 'reset'
  email?: string
  onComplete: () => Promise<void> | void
  onCancel?: () => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nextSendAt, setNextSendAt] = useState(0)
  const verify = purpose === 'verify'
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action() }
    catch (cause) {
      const value = cause as { error?: { message?: string } }
      setError(value?.error?.message || (cause instanceof Error ? cause.message : '账号操作失败'))
    } finally { lock.current = false; setBusy(false) }
  }
  const send = () => void run(async () => {
    if (!email.trim() || Date.now() < nextSendAt) { setError('请输入邮箱，或等待 60 秒后重新发送'); return }
    if (verify) await accountApi.sendVerificationEmail()
    else await accountApi.requestPasswordReset(email.trim())
    setNextSendAt(Date.now() + 60_000)
    setMessage(verify ? '验证码已请求发送，请查收邮件；60 秒后可重新发送。' : '如果邮箱对应可用账号，将收到验证码；60 秒后可重新发送。')
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      if (!verify && password !== confirm) { setError('两次输入的密码不一致'); return }
      if (verify) await accountApi.verifyEmail(code)
      else await accountApi.resetPassword(email.trim(), code, password)
      setCode(''); setPassword(''); setConfirm('')
      await onComplete()
    })
  }
  return <form className="backup-card account-form-card" onSubmit={submit}>
    <h3>{verify ? '验证邮箱' : '找回登录密码'}</h3>
    <p className="settings-field-desc">{verify ? '验证后可使用云同步和官方备份。' : '仅重置账号登录密码，无法恢复同步密码、备份密码或解密云端数据。'}</p>
    <div className="account-form-field"><Label htmlFor={`email-${purpose}`}>邮箱</Label><Input id={`email-${purpose}`} type="email" value={email} readOnly={verify} onChange={(e) => setEmail(e.target.value)} required /></div>
    <Button type="button" variant="outline" disabled={busy} onClick={send}>发送验证码</Button>
    <div className="account-form-field"><Label htmlFor={`code-${purpose}`}>验证码</Label><Input id={`code-${purpose}`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></div>
    {!verify && <>
      <div className="account-form-field"><Label htmlFor="reset-password">新登录密码</Label><Input id="reset-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      <div className="account-form-field"><Label htmlFor="reset-confirm">确认新密码</Label><Input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
    </>}
    {message && <p role="status" className="settings-field-desc">{message}</p>}
    {error && <div role="alert" className="account-error">{error}</div>}
    <Button type="submit" disabled={busy}>{busy ? '正在提交…' : verify ? '验证邮箱' : '重置登录密码'}</Button>
    {onCancel && <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>返回登录</Button>}
  </form>
}
