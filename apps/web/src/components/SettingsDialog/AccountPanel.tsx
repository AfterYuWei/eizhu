import { UserRound } from 'lucide-react'

export function AccountPanel() {
  return (
    <section className="settings-section" aria-label="账号设置">
      <div className="settings-section-title">
        <UserRound size={14} aria-hidden="true" />
        <span>账号设置</span>
      </div>
      <div className="settings-card">
        <div role="status" className="settings-field">
          <div className="settings-field-info">
            <span className="settings-field-label">官方账号</span>
            <p className="settings-field-desc">官方账号服务部署完成后再接入</p>
          </div>
          <span className="settings-status">正在开发中</span>
        </div>
      </div>
    </section>
  )
}
