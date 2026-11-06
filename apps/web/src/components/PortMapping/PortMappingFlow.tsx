import { useId, type CSSProperties } from 'react'
import { Laptop, LockKeyhole, Network, Server, Waypoints } from 'lucide-react'
import type { TunnelKind } from '@/api/tunnel'
import type { Profile } from '@/types/profile'

const address = (host: string, port: string) => `${host.includes(':') ? `[${host}]` : host || '主机'}:${port === '0' ? '自动' : port || '端口'}`
const short = (value: string, max = 28) => value.length > max ? value.slice(0, max - 1) + '…' : value

export function PortMappingFlow({ kind, bindHost, bindPort, targetHost, targetPort, profile }: { kind: TunnelKind; bindHost: string; bindPort: string; targetHost: string; targetPort: string; profile?: Profile }) {
  const id = useId().replaceAll(':', '')
  const reverse = kind === 'remote'
  const dynamic = kind === 'dynamic'
  const listener = address(bindHost, bindPort)
  const target = address(targetHost, targetPort)
  const ssh = profile ? address(profile.host, String(profile.port)) : '选择 SSH 服务器'
  const route = reverse ? '服务器监听 → SSH → 本机侧目标' : dynamic ? '本机 SOCKS5 → SSH → 客户端指定目标' : '本机监听 → SSH → 远端目标'
  const nodes = [
    { Icon: reverse ? Server : Laptop, label: reverse ? 'SSH 服务器监听' : dynamic ? '本机 SOCKS5' : '本机监听', endpoint: listener, detail: reverse ? `${profile?.name ?? 'SSH 服务器'} · ${ssh} · 监听 ${listener}` : listener },
    { Icon: reverse ? Laptop : Server, label: reverse ? '本机 · eizhu' : 'SSH 服务器', endpoint: reverse ? '接收 SSH 转发' : ssh, detail: reverse ? 'eizhu 接收服务器转发的连接' : `${profile?.name ?? 'SSH 服务器'} · ${ssh}` },
    { Icon: Network, label: dynamic ? '多个目标' : reverse ? '本机侧目标' : '远端目标', endpoint: dynamic ? '由代理客户端指定' : target, detail: dynamic ? '目标由代理客户端逐次指定，域名由 SSH 服务器解析' : target },
  ]
  return <figure className={`pm-flow is-${kind}`} data-mapping-flow={kind}>
    <figcaption><span><Waypoints size={14} />映射预览</span><small>流向示意</small></figcaption>
    <svg key={kind} className="pm-flow-canvas" viewBox={`0 0 320 ${dynamic ? 366 : 306}`} role="img" aria-label={`${route}；监听 ${listener}；${dynamic ? '目标由客户端指定' : `目标 ${target}`}；SSH ${ssh}`}>
      <defs><marker id={`pm-arrow-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L7 4L1 7" fill="none" stroke="currentColor" strokeWidth="1.3" /></marker></defs>
      <g className="pm-flow-routes">
        <path d="M30 74V132" className="pm-flow-track" markerEnd={`url(#pm-arrow-${id})`} />
        <path d="M30 176V234" className="pm-flow-track" markerEnd={`url(#pm-arrow-${id})`} />
        {dynamic && <path d="M30 278V326H270" className="pm-flow-track" />}
        {dynamic ? [110, 190, 270].map((x, index) => {
          const style: CSSProperties & { '--pm-flow-distance': string } = { '--pm-flow-distance': `${-(x + 244)}px`, animationDelay: `${index * 4.8}s` }
          return <path key={x} d={`M30 52V326H${x}`} className="pm-flow-packet" style={style} />
        })
          : <path d="M30 52V256" className="pm-flow-packet" />}
      </g>
      <LockKeyhole x="80" y="98" width="11" height="11" strokeWidth="1.4" />
      <text x="98" y="108" className="pm-flow-channel">SSH 加密通道</text>
      <text x="80" y="210" className="pm-flow-channel">{reverse ? '由本机访问目标' : dynamic ? '按客户端请求访问目标' : '由服务器访问目标'}</text>
      {nodes.map(({ Icon, label, endpoint, detail }, index) => {
        const y = 52 + index * 102
        return <g key={index} className="pm-flow-node" data-flow-step={index}>
          <rect x="10" y={y - 20} width="40" height="40" className="pm-flow-node-mask" />
          <Icon x="18" y={y - 12} width="24" height="24" strokeWidth="1.25" className="pm-flow-icon" />
          <text x="80" y={y - 8} className="pm-flow-label">{label}</text>
          <text x="80" y={y + 18} className="pm-flow-address"><title>{detail}</title>{short(endpoint)}</text>
        </g>
      })}
      {dynamic && <g className="pm-flow-targets">{[110, 190, 270].map((x, index) => <g key={x} className="pm-flow-node">
        <circle cx={x} cy="326" r="3" className="pm-flow-target-dot" />
        <text x={x} y="354" textAnchor="middle" className="pm-flow-address">目标 {index + 1}</text>
      </g>)}</g>}
    </svg>
    <p>逐段接力 · 非实时流量</p>
  </figure>
}
