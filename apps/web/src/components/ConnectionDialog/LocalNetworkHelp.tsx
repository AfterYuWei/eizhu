import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineError } from '@/components/ui/inline-error'
import { bridge } from '@/lib/bridge'
import { getPlatformCapabilities } from '@/lib/platform'
import { cn } from '@/lib/utils'

export function LocalNetworkHelp({ errorCode, className }: { errorCode?: string; className?: string }) {
  const [openFailed, setOpenFailed] = useState(false)
  if (errorCode !== 'LOCAL_NETWORK_UNREACHABLE') return null

  const { platform, localNetworkPrivacy } = getPlatformCapabilities()
  let description: string
  if (localNetworkPrivacy) {
    description =
      '如果系统弹出授权提示，请点按「允许」。也可以在「系统设置 → 隐私与安全 → 本地网络」中允许 eizhu，然后重新连接。'
  } else if (platform === 'windows') {
    description =
      '在「开始」菜单搜索 wf.msc，检查 Windows Defender 防火墙的「出站规则」是否阻止 eizhu 连接目标地址和端口。'
  } else if (platform === 'linux' || platform === 'macos') {
    description = '检查本机防火墙或网络管理策略是否允许访问目标地址和端口。'
  } else {
    return null
  }

  return (
    <div className={cn('space-y-2 text-xs text-muted-foreground', className)}>
      <p>{description}</p>
      {localNetworkPrivacy && (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            setOpenFailed(false)
            try {
              await bridge().system.openLocalNetworkSettings()
            } catch {
              setOpenFailed(true)
            }
          }}
        >
          打开系统设置
        </Button>
      )}
      {openFailed && <InlineError message="无法打开系统设置，请按上方路径手动打开。" />}
    </div>
  )
}
