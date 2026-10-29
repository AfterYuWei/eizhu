import { UserRound } from 'lucide-react'
import { useAccountStore } from '@/store/account'

export function AccountIdentity() {
  const account = useAccountStore((s) => s.status)
  const cloud = account?.loggedIn === true
  const name = cloud ? account.user.username || account.user.email.split('@')[0] || '云端用户' : '本地用户'
  return (
    <>
      <span className="shell-avatar" aria-hidden="true">
        {cloud && account.user.avatar ? (
          <img src={account.user.avatar} alt="" />
        ) : cloud ? (
          name.slice(0, 1).toUpperCase()
        ) : (
          <UserRound size={17} />
        )}
      </span>
      <span className="shell-account-name">{name}</span>
      <span className="shell-mode">{cloud ? '云端' : '本地'}</span>
    </>
  )
}
