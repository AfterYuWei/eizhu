import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Eye, EyeOff, X } from 'lucide-react'
import { masterPasswordSchema, normalizeCommandError } from '@eizhu/contracts'
import { accountApi } from '@/api/account'
import { useAccountStore } from '@/store/account'
import { useAccountDialogStore, type AccountDialogMode } from '@/store/accountDialog'
import { useSyncStore } from '@/store/sync'
import { Button } from '@/components/ui/button'
import { InlineError } from '@/components/ui/inline-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'

export function AccountDialog() {
  const { mode, email, close } = useAccountDialogStore()
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      {mode && <AccountForm key={`${mode}:${email}`} mode={mode} initialEmail={email} onClose={close} />}
    </Dialog>
  )
}
function AccountForm({
  mode,
  initialEmail,
  onClose,
}: {
  mode: AccountDialogMode
  initialEmail: string
  onClose: () => void
}) {
  const [step, setStep] = useState<'email' | 'code' | 'password'>(
    mode === 'login' || mode === 'change' ? 'password' : 'email',
  )
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [current, setCurrent] = useState('')
  const [code, setCode] = useState(''),
    [ticket, setTicket] = useState(''),
    [challengeId, setChallengeId] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [showPassword, setShowPassword] = useState(false)
  const [nextSend, setNextSend] = useState(0),
    [now, setNow] = useState(() => Date.now())
  const [credentialUpdated, setCredentialUpdated] = useState(false)
  const returnFocus = useRef(document.activeElement)
  const lock = useRef(false),
    form = useRef<HTMLFormElement>(null)
  const wait = Math.max(0, Math.ceil((nextSend - now) / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [step])
  const choose = (next: AccountDialogMode) => useAccountDialogStore.getState().open(next, email)
  const back = () => {
    setError('')
    setPassword('')
    setConfirm('')
    setCurrent('')
    setShowPassword(false)
    if (mode === 'register' && step === 'password') {
      setStep('code')
      setCode('')
    } else if (step === 'code') {
      setStep('email')
      setCode('')
      setTicket('')
    } else choose('login')
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      const value = normalizeCommandError(cause)
      setError(
        value.error.message +
          (value.error.code === 'ACCOUNT_UNAVAILABLE' && (mode === 'change' || mode === 'recover')
            ? ' 若请求已经提交，请尝试用新主密码登录。'
            : ''),
      )
      if (value.error.code === 'INVALID_EMAIL_CODE' && mode === 'register' && step === 'password') {
        setTicket('')
        setCode('')
        setStep('code')
      }
      const retry = Number(
        value.details && typeof value.details === 'object' && 'retryAfterSeconds' in value.details
          ? value.details.retryAfterSeconds
          : 60,
      )
      if (value.error.code === 'RATE_LIMITED') {
        setNow(Date.now())
        setNextSend(Date.now() + (Number.isFinite(retry) ? retry : 60) * 1000)
      }
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function send() {
    if (Date.now() < nextSend) return
    if (mode === 'register') {
      const result = await accountApi.requestRegistrationCode(email.trim())
      setChallengeId(result.challengeId)
      setNextSend(Date.now() + result.retryAfterSeconds * 1000)
    } else {
      if (!(await accountApi.recoveryAvailable(email.trim())))
        throw new Error('请在仍可解锁数据的设备上恢复主密码。所有设备都无法解锁时，云端数据无法恢复。')
      const result = await accountApi.requestPasswordReset(email.trim())
      setNextSend(Date.now() + result.retryAfterSeconds * 1000)
    }
    setNow(Date.now())
    setCode('')
    setStep('code')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      if (step === 'email') {
        await send()
        return
      }
      if (step === 'code' && mode === 'register') {
        if (ticket) {
          setStep('password')
          return
        }
        const result = await accountApi.verifyRegistrationCode(email.trim(), challengeId, code)
        setTicket(result.ticket)
        setCode('')
        setStep('password')
        return
      }
      if (mode !== 'login' && password !== confirm) throw new Error('两次输入的主密码不一致')
      if (mode !== 'login' && !masterPasswordSchema.safeParse(password).success)
        throw new Error('主密码需为 8–128 位，包含大写字母、小写字母、数字和符号。')
      if (mode === 'register') await useAccountStore.getState().register(email.trim(), password, ticket)
      else if (mode === 'change') {
        if (!credentialUpdated) {
          await accountApi.changePassword(current, password)
          setCredentialUpdated(true)
        }
        await useAccountStore.getState().login(email.trim(), password)
      } else if (mode === 'recover') {
        if (!credentialUpdated) {
          await accountApi.resetPassword(email.trim(), code, password)
          setCredentialUpdated(true)
        }
        await useAccountStore.getState().login(email.trim(), password)
      } else await useAccountStore.getState().login(email.trim(), password)
      await useSyncStore.getState().refresh()
      setPassword('')
      setConfirm('')
      setCurrent('')
      setTicket('')
      onClose()
    })
  }
  const title =
    mode === 'login'
      ? '登录 eizhu'
      : mode === 'register'
        ? step === 'email'
          ? '创建账号'
          : step === 'code'
            ? '验证邮箱'
            : '设置主密码'
        : mode === 'change'
          ? '修改主密码'
          : '恢复主密码'
  const description =
    mode === 'login'
      ? '登录后自动解锁你的加密数据。'
      : mode === 'register'
        ? step === 'password'
          ? '一个主密码，用于登录和解锁云同步。'
          : '先验证邮箱，再创建你的加密账号。'
        : mode === 'change'
          ? '重新保护数据密钥，已同步的条目会保留。'
          : '仅能在仍可解锁数据的设备上恢复。'
  const newPassword =
    mode === 'change' ||
    (mode === 'register' && step === 'password') ||
    (mode === 'recover' && step === 'code')
  return (
    <DialogContent
      className="account-dialog"
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        const target = returnFocus.current
        if (target instanceof HTMLElement && target.isConnected && !target.closest('[inert]')) target.focus()
        else
          (
            document.querySelector<HTMLElement>('.settings-page [role="tab"][data-state="active"]') ??
            document.querySelector<HTMLElement>('.shell-account')
          )?.focus()
      }}
      showCloseButton={false}
      onEscapeKeyDown={(event) => {
        if (lock.current) event.preventDefault()
      }}
      onPointerDownOutside={(event) => {
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
        aria-label="关闭账号窗口"
        disabled={busy}
        onClick={onClose}
      >
        <X size={16} />
      </Button>
      <div className="account-dialog-heading">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </div>
      <form ref={form} className="account-dialog-form" onSubmit={submit} aria-busy={busy}>
        <div key={`${mode}:${step}`} className="account-dialog-step">
          {mode === 'login' || step === 'email' ? (
            <div className="account-form-field">
              <Label htmlFor="account-email">邮箱</Label>
              <Input
                id="account-email"
                type="email"
                autoComplete="username"
                placeholder="输入账号邮箱"
                value={email}
                maxLength={255}
                required
                disabled={busy}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setTicket('')
                  setChallengeId('')
                }}
              />
            </div>
          ) : (
            <div className="account-email-summary">
              <span>{email}</span>
              {mode === 'register' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setStep('email')
                    setTicket('')
                    setCode('')
                    setPassword('')
                    setConfirm('')
                  }}
                >
                  更换邮箱
                </Button>
              )}
            </div>
          )}
          {step === 'code' && ticket && (
            <p className="account-help" role="status">
              邮箱已验证，可以继续设置主密码。
            </p>
          )}
          {step === 'code' && !ticket && (
            <div className="account-form-field">
              <Label htmlFor="account-code">邮箱验证码</Label>
              <div className="account-code-row">
                <Input
                  id="account-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || wait > 0}
                  onClick={() => void run(send)}
                >
                  {wait > 0 ? `${wait} 秒后重发` : '重新发送'}
                </Button>
              </div>
              <p className="account-help" role="status">
                验证码已请求发送，请查收邮件；10 分钟内有效。
              </p>
            </div>
          )}
          {mode === 'change' && (
            <div className="account-form-field">
              <Label htmlFor="account-current">当前主密码</Label>
              <Input
                id="account-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </div>
          )}
          {(mode === 'login' || newPassword) && (
            <div className="account-form-field">
              <Label htmlFor="account-password">{newPassword ? '新主密码' : '主密码'}</Label>
              <div className="account-password-row">
                <Input
                  id="account-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={newPassword ? 'new-password' : 'current-password'}
                  minLength={newPassword ? 8 : 1}
                  maxLength={newPassword ? 128 : 1024}
                  aria-describedby={newPassword ? 'account-password-help' : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={showPassword ? '隐藏主密码' : '显示主密码'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
              </div>
              {newPassword && (
                <p className="account-help" id="account-password-help">
                  8–128 位，包含大写字母、小写字母、数字和符号。邮箱不能单独恢复加密数据。
                </p>
              )}
            </div>
          )}
          {newPassword && (
            <div className="account-form-field">
              <Label htmlFor="account-confirm">确认主密码</Label>
              <Input
                id="account-confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                disabled={busy}
              />
            </div>
          )}
          {mode === 'recover' && step === 'email' && (
            <p className="account-recovery-note">
              退出账号会清除本机解锁资料。若所有设备都无法解锁，我们无法恢复云端数据。
            </p>
          )}
        </div>
        <div className={mode === 'change' ? 'account-dialog-actions' : 'account-submit-row'}>
          <InlineError message={error} className="account-error" />
          {mode === 'change' && (
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              取消
            </Button>
          )}
          <Button
            type="submit"
            className={mode === 'change' ? undefined : 'account-primary'}
            disabled={busy || (step === 'email' && wait > 0)}
          >
            {busy
              ? '正在提交…'
              : step === 'email'
                ? wait > 0
                  ? `${wait} 秒后可发送`
                  : '发送验证码'
                : step === 'code' && mode === 'register'
                  ? ticket
                    ? '继续设置主密码'
                    : '验证邮箱'
                  : mode === 'register'
                    ? '创建账号并登录'
                    : mode === 'change'
                      ? '保存并重新登录'
                      : mode === 'recover'
                        ? '恢复并登录'
                        : '登录'}
          </Button>
        </div>
        {mode !== 'change' && (
          <div className="account-dialog-footer">
            {mode === 'login' ? (
              <>
                <Button type="button" variant="link" disabled={busy} onClick={() => choose('register')}>
                  创建账号
                </Button>
                <Button type="button" variant="link" disabled={busy} onClick={() => choose('recover')}>
                  忘记主密码？
                </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" disabled={busy} onClick={back}>
                <ArrowLeft size={14} />
                {step === 'code' || (mode === 'register' && step === 'password') ? '返回上一步' : '返回登录'}
              </Button>
            )}
          </div>
        )}
      </form>
    </DialogContent>
  )
}
