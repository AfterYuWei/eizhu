import { useState } from 'react'
import { HoverCard } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { resolveServerIcon } from '@/lib/serverIcons'
import { useServerMetrics } from '@/hooks/useServerMetrics'
import type { ServerInspection, ServerInspectionTarget } from '@/hooks/useServerMetrics'
import type { SessionTab } from '@/store/session'

const items = [
  { kind: 'cpu', label: 'CPU', Icon: resolveServerIcon('cpu') },
  { kind: 'memory', label: '内存', Icon: resolveServerIcon('memory') },
  { kind: 'disk', label: '硬盘', Icon: resolveServerIcon('harddrive') },
  { kind: 'network', label: '网络', Icon: resolveServerIcon('network') },
  { kind: 'info', label: '服务器信息', Icon: resolveServerIcon('server') },
] as const

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']
  const unit = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))))
  return `${Number((bytes / 1024 ** unit).toFixed(1))} ${units[unit]}`
}

function ByteValue({ bytes, direction }: { bytes: number; direction?: '↓' | '↑' }) {
  const [value, unit] = formatBytes(bytes).split(' ')
  return (
    <span className={`server-status-bytes${direction ? ' is-rate' : ''}`}>
      <span className="server-status-number">
        {direction && <span className="server-status-direction">{direction} </span>}
        {value}
      </span>
      <span className="server-status-unit">
        {' '}
        {unit}
        {direction ? '/s' : ''}
      </span>
    </span>
  )
}

function ServerStatusDetails({ data, tab }: { data: ServerInspection; tab: SessionTab }) {
  switch (data.kind) {
    case 'cpu':
      return (
        <>
          <div className="server-status-detail-value">
            总使用率 <span className="server-status-percent">{data.cpu.toFixed(1)}%</span>
          </div>
          <div className="server-status-caption server-status-cpu-meta">
            <span className="server-status-count">{data.cpu_detail.length}</span>
            <span> 核 · </span>
            <span className="server-status-number">
              {data.cpu_mhz ? (data.cpu_mhz / 1000).toFixed(2) : '—'}
            </span>
            <span> GHz</span>
          </div>
          <dl className="server-status-cores">
            {data.cpu_detail.map((value, index) => (
              <div key={index}>
                <dt>Core {index}</dt>
                <dd className="server-status-percent">{value.toFixed(1)}%</dd>
              </div>
            ))}
          </dl>
        </>
      )
    case 'memory':
      return (
        <>
          <div className="server-status-detail-value">
            内存使用率 <span className="server-status-percent">{data.mem_percent.toFixed(1)}%</span>
          </div>
          <div className="server-status-caption server-status-capacity">
            <ByteValue bytes={data.mem_used} />
            <span> / </span>
            <ByteValue bytes={data.mem_total} />
          </div>
          <div className="server-status-section-label">占用较高的进程</div>
          {data.mem_detail.length ? (
            <dl className="server-status-list">
              {data.mem_detail.map((process, index) => (
                <div key={index}>
                  <dt>{process.name}</dt>
                  <dd>
                    <span className="server-status-percent">{process.percent.toFixed(1)}%</span>
                    <span> · </span>
                    <ByteValue bytes={process.rss} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="server-status-caption">暂无进程数据</p>
          )}
        </>
      )
    case 'disk':
      return (
        <>
          <div className="server-status-detail-value">
            根目录使用率 <span className="server-status-percent">{data.disk_percent.toFixed(1)}%</span>
          </div>
          <div className="server-status-caption server-status-capacity">
            <ByteValue bytes={data.disk_used} />
            <span> / </span>
            <ByteValue bytes={data.disk_total} />
          </div>
          <div className="server-status-section-label">挂载点</div>
          <dl className="server-status-list">
            {data.volumes.map((volume, index) => (
              <div key={index}>
                <dt>
                  {volume.path}
                  <span className="server-status-caption">{volume.filesystem}</span>
                </dt>
                <dd>
                  <span className="server-status-percent">{volume.percent.toFixed(1)}%</span>
                  <span className="server-status-caption server-status-capacity">
                    <ByteValue bytes={volume.used} />
                    <span> / </span>
                    <ByteValue bytes={volume.total} />
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )
    case 'network':
      return (
        <>
          <div className="server-status-detail-value">
            接收 / 发送{' '}
            <span className="server-status-rates">
              <ByteValue bytes={data.net_rx} direction="↓" /> <ByteValue bytes={data.net_tx} direction="↑" />
            </span>
          </div>
          <div className="server-status-section-label">网卡速率</div>
          {data.net_detail.length ? (
            <dl className="server-status-list">
              {data.net_detail.map((nic) => (
                <div key={nic.name}>
                  <dt>{nic.name}</dt>
                  <dd>
                    <span className="server-status-rates">
                      <ByteValue bytes={nic.rx} direction="↓" /> <ByteValue bytes={nic.tx} direction="↑" />
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="server-status-caption">暂无外部网卡</p>
          )}
        </>
      )
    case 'info': {
      const info = data.info
      const rows = [
        { label: '主机名', value: info.hostname },
        { label: '连接', value: `${tab.username || 'root'}@${tab.host || '未知'}:${tab.port || 22}` },
        { label: '系统', value: info.os },
        { label: '内核', value: info.kernel },
        { label: '架构', value: info.arch },
        { label: '运行时间', value: info.uptime },
        {
          label: '平均负载',
          value: info.load_avg && (
            <span className="server-status-load">
              {info.load_avg.split(' / ').map((value, index) => (
                <span key={index}>{value}</span>
              ))}
            </span>
          ),
        },
        { label: '负载详情', value: info.load_avg_detail },
      ]
      return (
        <dl className="server-status-info">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value || '—'}</dd>
            </div>
          ))}
        </dl>
      )
    }
  }
}

export function ServerStatusBar({ tab }: { tab: SessionTab }) {
  const [inspected, setInspected] = useState<ServerInspectionTarget | null>(null)
  const { summary, summaryError, inspection, inspectionError } = useServerMetrics(
    tab.sessionId,
    tab.status === 'connected',
    inspected,
  )
  const status =
    tab.status === 'connected'
      ? null
      : tab.status === 'connecting'
        ? '连接中…'
        : tab.status === 'reconnecting'
          ? '重连中…'
          : tab.status === 'error'
            ? '连接失败'
            : '已断开'
  const values = {
    cpu: summary ? `${Math.round(summary.cpu)}%` : '—',
    memory: summary ? `${Math.round(summary.mem_percent)}%` : '—',
    disk: summary ? `${Math.round(summary.disk_percent)}%` : '—',
    network: summary ? `↓ ${formatBytes(summary.net_rx)}/s ↑ ${formatBytes(summary.net_tx)}/s` : '—',
    info: '',
  }
  return (
    <footer className="server-status-bar" aria-label={`${tab.profileName} 服务器状态`}>
      {items.map(({ kind, label, Icon }) => (
        <HoverCard.Root
          key={kind}
          open={inspected === kind}
          openDelay={300}
          closeDelay={120}
          onOpenChange={(open) =>
            setInspected((current) => (open ? kind : current === kind ? null : current))
          }
        >
          <HoverCard.Trigger asChild>
            <Button
              variant="ghost"
              className={`server-status-item${kind === 'info' ? ' server-status-info-trigger' : ''}`}
              data-metric={kind}
              aria-label={`${label}${values[kind] ? ` ${values[kind]}` : ''}`}
              aria-expanded={inspected === kind}
            >
              <Icon size={12} strokeWidth={1.5} aria-hidden="true" />
              <span>{label}</span>
              {kind === 'network' ? (
                <span className="server-status-rates">
                  {summary ? (
                    <>
                      <ByteValue bytes={summary.net_rx} direction="↓" />{' '}
                      <ByteValue bytes={summary.net_tx} direction="↑" />
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              ) : (
                values[kind] && <span className="server-status-value">{values[kind]}</span>
              )}
            </Button>
          </HoverCard.Trigger>
          <HoverCard.Portal>
            <HoverCard.Content
              data-slot="hover-card-content"
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={16}
              className="server-status-hover"
              role="region"
              aria-label={kind === 'info' ? label : `${label}详情`}
            >
              <div className="server-status-heading">
                <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>{label}</span>
                <span className="server-status-host">{tab.profileName}</span>
              </div>
              {inspection?.kind === kind ? (
                <ServerStatusDetails data={inspection} tab={tab} />
              ) : (
                <p className="server-status-message" role="status">
                  {status || inspectionError || (kind !== 'info' && summaryError) || '正在读取…'}
                </p>
              )}
            </HoverCard.Content>
          </HoverCard.Portal>
        </HoverCard.Root>
      ))}
      <span className="server-status-encoding">UTF-8</span>
    </footer>
  )
}
