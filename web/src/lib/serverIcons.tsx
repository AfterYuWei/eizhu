import {
  Server,
  Terminal,
  Database,
  Cloud,
  HardDrive,
  Cpu,
  Globe,
  Box,
  Network,
  Shield,
  Container,
  Router,
  MemoryStick,
  Layers,
  Gauge,
  ServerCog,
  type LucideProps,
} from 'lucide-react'
import { createElement, forwardRef, type ComponentType } from 'react'
import {
  siAlmalinux,
  siAlpinelinux,
  siArchlinux,
  siCentos,
  siDebian,
  siFedora,
  siFreebsd,
  siKalilinux,
  siLinux,
  siLinuxmint,
  siManjaro,
  siOpenmediavault,
  siOpensuse,
  siOpenwrt,
  siProxmox,
  siQnap,
  siRaspberrypi,
  siRedhat,
  siRockylinux,
  siSynology,
  siTruenas,
  siUbuntu,
  siUmbrel,
  siUnraid,
  type SimpleIcon,
} from 'simple-icons'

import amazonLinuxIcon from '@/assets/server-icons/amazon-linux.png'
import casaOsIcon from '@/assets/server-icons/casaos.svg'
import fnOsLogo from '@/assets/server-icons/fnos.png'
import oracleLinuxIcon from '@/assets/server-icons/oracle-linux.png'
import { DEFAULT_SERVER_ICON } from '@/lib/serverIconKeys'

type ServerIconComponent = ComponentType<LucideProps>

function simpleIcon(icon: SimpleIcon): ServerIconComponent {
  const Component = forwardRef<SVGSVGElement, LucideProps>(({ size = 24, color = 'currentColor', ...props }, ref) => (
    <svg
      {...props}
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={icon.path} />
    </svg>
  ))
  Component.displayName = `${icon.title}ServerIcon`
  return Component
}

function officialImageIcon(
  displayName: string,
  source: string,
  viewBox: string,
  imageWidth: number,
  imageHeight: number
): ServerIconComponent {
  const Component = forwardRef<SVGSVGElement, LucideProps>(({ size = 24, ...props }, ref) => (
    <svg
      {...props}
      ref={ref}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <image href={source} width={imageWidth} height={imageHeight} />
    </svg>
  ))
  Component.displayName = `${displayName}ServerIcon`
  return Component
}

const FnOsIcon = officialImageIcon('FnOS', fnOsLogo, '0 0 175 175', 373, 175)
const CasaOsIcon = officialImageIcon('CasaOS', casaOsIcon, '0 0 267 267', 267, 267)
const AmazonLinuxIcon = officialImageIcon('AmazonLinux', amazonLinuxIcon, '0 0 256 256', 256, 256)
const OracleLinuxIcon = officialImageIcon('OracleLinux', oracleLinuxIcon, '0 0 96 96', 96, 96)

/**
 * Built-in semantic and product icons. Each entry maps a stable string key
 * stored on the profile to a theme-aware icon component.
 */
export interface ServerIconDef {
  key: string
  label: string
  Icon: ServerIconComponent
}

export const SERVER_ICONS: ServerIconDef[] = [
  { key: 'server', label: '服务器', Icon: Server },
  { key: 'os-fnos', label: '飞牛 fnOS', Icon: FnOsIcon },
  { key: 'os-proxmox', label: 'Proxmox VE', Icon: simpleIcon(siProxmox) },
  { key: 'os-truenas', label: 'TrueNAS', Icon: simpleIcon(siTruenas) },
  { key: 'os-synology', label: 'Synology DSM', Icon: simpleIcon(siSynology) },
  { key: 'os-qnap', label: 'QNAP QTS', Icon: simpleIcon(siQnap) },
  { key: 'os-unraid', label: 'Unraid', Icon: simpleIcon(siUnraid) },
  { key: 'os-openmediavault', label: 'OpenMediaVault', Icon: simpleIcon(siOpenmediavault) },
  { key: 'os-openwrt', label: 'OpenWrt', Icon: simpleIcon(siOpenwrt) },
  { key: 'os-casaos', label: 'CasaOS', Icon: CasaOsIcon },
  { key: 'os-umbrel', label: 'Umbrel', Icon: simpleIcon(siUmbrel) },
  { key: 'os-ubuntu', label: 'Ubuntu', Icon: simpleIcon(siUbuntu) },
  { key: 'os-debian', label: 'Debian', Icon: simpleIcon(siDebian) },
  { key: 'os-linuxmint', label: 'Linux Mint', Icon: simpleIcon(siLinuxmint) },
  { key: 'os-raspberrypi', label: 'Raspberry Pi OS', Icon: simpleIcon(siRaspberrypi) },
  { key: 'os-kali', label: 'Kali Linux', Icon: simpleIcon(siKalilinux) },
  { key: 'os-rocky', label: 'Rocky Linux', Icon: simpleIcon(siRockylinux) },
  { key: 'os-almalinux', label: 'AlmaLinux', Icon: simpleIcon(siAlmalinux) },
  { key: 'os-centos', label: 'CentOS', Icon: simpleIcon(siCentos) },
  { key: 'os-redhat', label: 'Red Hat', Icon: simpleIcon(siRedhat) },
  { key: 'os-fedora', label: 'Fedora', Icon: simpleIcon(siFedora) },
  { key: 'os-alpine', label: 'Alpine Linux', Icon: simpleIcon(siAlpinelinux) },
  { key: 'os-manjaro', label: 'Manjaro', Icon: simpleIcon(siManjaro) },
  { key: 'os-archlinux', label: 'Arch Linux', Icon: simpleIcon(siArchlinux) },
  { key: 'os-opensuse', label: 'openSUSE', Icon: simpleIcon(siOpensuse) },
  { key: 'os-amazonlinux', label: 'Amazon Linux', Icon: AmazonLinuxIcon },
  { key: 'os-oraclelinux', label: 'Oracle Linux', Icon: OracleLinuxIcon },
  { key: 'os-freebsd', label: 'FreeBSD', Icon: simpleIcon(siFreebsd) },
  { key: 'os-linux', label: 'Linux', Icon: simpleIcon(siLinux) },
  { key: 'terminal', label: '终端', Icon: Terminal },
  { key: 'database', label: '数据库', Icon: Database },
  { key: 'cloud', label: '云主机', Icon: Cloud },
  { key: 'harddrive', label: '存储', Icon: HardDrive },
  { key: 'cpu', label: '计算', Icon: Cpu },
  { key: 'globe', label: '网络站点', Icon: Globe },
  { key: 'box', label: '容器', Icon: Box },
  { key: 'container', label: '集群', Icon: Container },
  { key: 'network', label: '网络', Icon: Network },
  { key: 'router', label: '路由', Icon: Router },
  { key: 'shield', label: '安全', Icon: Shield },
  { key: 'memory', label: '内存', Icon: MemoryStick },
  { key: 'layers', label: '分层', Icon: Layers },
  { key: 'gauge', label: '监控', Icon: Gauge },
  { key: 'server-cog', label: '运维', Icon: ServerCog },
]

/** Product/OS icons are managed by connection detection, not manual selection. */
export const SELECTABLE_SERVER_ICONS = SERVER_ICONS.filter(({ key }) => !key.startsWith('os-'))

const ICON_MAP: Record<string, ServerIconComponent> = Object.fromEntries(
  SERVER_ICONS.map((d) => [d.key, d.Icon])
)

/**
 * Resolve a profile's icon key to a Lucide component, falling back to the
 * default server icon for unknown / empty keys.
 */
export function resolveServerIcon(key?: string): ServerIconComponent {
  if (key && ICON_MAP[key]) return ICON_MAP[key]
  return ICON_MAP[DEFAULT_SERVER_ICON]
}

export function ServerIcon({ iconKey, ...props }: LucideProps & { iconKey?: string }) {
  return createElement(resolveServerIcon(iconKey), props)
}
