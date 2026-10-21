import { UserRound } from 'lucide-react'

export function AccountPanel() {
  return (
    <section className="settings-section" aria-label="账号设置">
      <div className="settings-section-title">
        <UserRound size={14} aria-hidden="true" />
        <span>账号设置</span>
      </div>
      <div role="status" className="flex min-h-60 flex-col items-center justify-center gap-3 text-muted-foreground">
        <UserRound size={28} className="opacity-60" aria-hidden="true" />
        <p className="text-sm">正在开发中</p>
        <p className="text-xs">官方账号服务部署完成后再接入</p>
      </div>
    </section>
  )
}
