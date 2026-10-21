import type { ServerInfo, ServerMetrics } from '@eizhu/contracts/models/api'
import { fail } from '@eizhu/contracts'
export const INFO_COMMAND =
  "\nprintf '===HOSTNAME===\\n'; (hostname -f 2>/dev/null || hostname)\nprintf '===OS===\\n'; (awk '/^PRETTY_NAME=/{sub(/^[^=]*=/, \"\"); gsub(/^\"|\"$/, \"\"); print; exit}' /etc/os-release 2>/dev/null || uname -s)\nprintf '===OS_ID===\\n'; awk -F= '/^ID=/{gsub(/^\"|\"$/, \"\", $2); print tolower($2); exit}' /etc/os-release 2>/dev/null\nprintf '===OS_LIKE===\\n'; awk '/^ID_LIKE=/{sub(/^[^=]*=/, \"\"); gsub(/^\"|\"$/, \"\"); print tolower($0); exit}' /etc/os-release 2>/dev/null\nprintf '===PRODUCT===\\n';\nif [ -d /usr/trim ] || [ -S /run/trim_cgi.socket ]; then echo fnos\nelif command -v pveversion >/dev/null 2>&1 || [ -d /etc/pve ]; then echo proxmox\nelif command -v midclt >/dev/null 2>&1 && [ -e /etc/version ]; then echo truenas\nelif [ -e /etc/synoinfo.conf ] || [ -e /etc.defaults/VERSION ]; then echo synology\nelif [ -e /etc/config/uLinux.conf ]; then echo qnap\nelif [ -e /etc/unraid-version ]; then echo unraid\nelif [ -e /etc/openmediavault/config.xml ] || command -v omv-confdbadm >/dev/null 2>&1; then echo openmediavault\nelif [ -e /etc/openwrt_release ] || [ -e /etc/openwrt_version ] || command -v uci >/dev/null 2>&1; then echo openwrt\nelif command -v opnsense-version >/dev/null 2>&1 || [ -e /usr/local/etc/opnsense-update.conf ]; then echo opnsense\nelif command -v pfSsh.php >/dev/null 2>&1 || [ -e /etc/inc/globals.inc ]; then echo pfsense\nelif [ -e /etc/vyos-version ] || [ -d /opt/vyatta ]; then echo vyos\nelif [ -e /etc/yunohost ]; then echo yunohost\nelif command -v casaos-cli >/dev/null 2>&1 || [ -d /etc/casaos ]; then echo casaos\nelif [ -d /home/umbrel/umbrel ] || [ -d /umbrel ]; then echo umbrel\nfi\nprintf '===KERNEL===\\n'; uname -r\nprintf '===ARCH===\\n'; uname -m\nprintf '===UPTIME===\\n'; (uptime -p 2>/dev/null || uptime)\nprintf '===LOAD===\\n'; (cat /proc/loadavg 2>/dev/null || uptime)\nprintf '===CPUS===\\n'; (nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)\nprintf '===CPUMHZ===\\n'; awk '/cpu MHz/{s+=$4;c++} END{if(c) printf \"%.2f\\n\",s/c;else print 0}' /proc/cpuinfo 2>/dev/null\n"
export const METRICS_COMMAND =
  '\nprintf \'===CPU1===\\n\'; awk \'/^cpu /{print "T",$2,$3,$4,$5,$6,$7,$8,$9}/^cpu[0-9]+ /{c=$1;sub(/^cpu/,"",c);print "C" c,$2,$3,$4,$5,$6,$7,$8,$9}\' /proc/stat\nprintf \'===NET1===\\n\'; awk \'NR>2{n=$1;gsub(/:/,"",n);print n,$2,$10}\' /proc/net/dev\nsleep 1\nprintf \'===CPU2===\\n\'; awk \'/^cpu /{print "T",$2,$3,$4,$5,$6,$7,$8,$9}/^cpu[0-9]+ /{c=$1;sub(/^cpu/,"",c);print "C" c,$2,$3,$4,$5,$6,$7,$8,$9}\' /proc/stat\nprintf \'===NET2===\\n\'; awk \'NR>2{n=$1;gsub(/:/,"",n);print n,$2,$10}\' /proc/net/dev\nprintf \'===STATIC===\\n\'\nawk \'/^MemTotal:/{mt=$2*1024}/^MemAvailable:/{ma=$2*1024} END{print "MT",mt;print "MU",mt-ma}\' /proc/meminfo\ndf -B1 -P / | awk \'NR==2{print "DU",$3;print "DT",$2}\'\nps -eo comm=,%mem=,rss= --sort=-rss | head -6 | awk \'{print "MP",$1,$2,$3*1024}\'\nawk \'/cpu MHz/{s+=$4;c++} END{if(c) printf "CM %.2f\\n",s/c;else print "CM 0"}\' /proc/cpuinfo\n'
export function sections(output: string): Record<string, string> {
  const result: Record<string, string> = {}
  let key = ''
  for (const line of output.split('\n')) {
    const match = /^===([A-Z0-9_]+)===$/.exec(line.trim())
    if (match) {
      key = match[1]
      result[key] = ''
    } else if (key) result[key] += line + '\n'
  }
  return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.trim()]))
}
export function parseInfo(output: string): ServerInfo {
  const v = sections(output),
    os = v.OS ?? '',
    identity = [v.OS_ID, v.OS_LIKE, os].join(' ').toLowerCase()
  const product = v.PRODUCT
  const products = [
    'fnos',
    'proxmox',
    'truenas',
    'synology',
    'qnap',
    'unraid',
    'openmediavault',
    'openwrt',
    'opnsense',
    'pfsense',
    'vyos',
    'yunohost',
    'casaos',
    'umbrel',
  ]
  const has = (name: string) => identity.split(/[^a-z0-9-]+/).includes(name)
  const families: Array<[string[], string]> = [
    [['openwrt', 'lede', 'immortalwrt'], 'openwrt'],
    [['opnsense'], 'opnsense'],
    [['pfsense'], 'pfsense'],
    [['routeros', 'mikrotik'], 'mikrotik'],
    [['vyos', 'vyatta'], 'vyos'],
    [['yunohost'], 'yunohost'],
    [['ubuntu'], 'ubuntu'],
    [['linuxmint'], 'linuxmint'],
    [['pop', 'pop-os'], 'popos'],
    [['elementary'], 'elementary'],
    [['deepin'], 'deepin'],
    [['raspbian'], 'raspberrypi'],
    [['kali'], 'kali'],
    [['debian'], 'debian'],
    [['rocky'], 'rocky'],
    [['almalinux'], 'almalinux'],
    [['centos'], 'centos'],
    [['rhel'], 'redhat'],
    [['fedora'], 'fedora'],
    [['alpine'], 'alpine'],
    [['manjaro'], 'manjaro'],
    [['endeavouros'], 'endeavouros'],
    [['arch', 'archlinux'], 'archlinux'],
    [['gentoo'], 'gentoo'],
    [['nixos'], 'nixos'],
    [['void', 'voidlinux'], 'voidlinux'],
    [['slackware'], 'slackware'],
    [['opensuse', 'suse', 'sles'], 'opensuse'],
    [['amzn'], 'amazonlinux'],
    [['ol'], 'oraclelinux'],
    [['photon'], 'photon'],
    [['openbsd'], 'openbsd'],
    [['netbsd'], 'netbsd'],
    [['freebsd'], 'freebsd'],
    [['darwin', 'macos'], 'macos'],
  ]
  const kernel = (v.KERNEL ?? '').toLowerCase()
  const detected =
    product && products.includes(product)
      ? product
      : (families.find(([names]) => names.some(has))?.[1] ??
        ['openbsd', 'netbsd', 'freebsd', 'darwin'].find((s) => kernel.includes(s)) ??
        'linux')
  return {
    hostname: v.HOSTNAME ?? '',
    os,
    icon: `os-${detected === 'darwin' ? 'macos' : detected}`,
    kernel: v.KERNEL ?? '',
    arch: v.ARCH ?? '',
    uptime: v.UPTIME ?? '',
    load_avg: (v.LOAD ?? '').split(/\s+/).slice(0, 3).join(' / '),
    load_avg_detail: v.LOAD ?? '',
    cpus: Number(v.CPUS) || 1,
    cpu_mhz: Number(v.CPUMHZ) || 0,
  }
}
export function parseMetrics(output: string): ServerMetrics {
  const v = sections(output)
  if (!v.CPU1 || !v.CPU2 || !v.STATIC) fail('METRICS_UNSUPPORTED', '此服务器未提供可采集的 /proc 指标')
  const rows = (s: string) =>
    new Map(
      s.split('\n').map((l) => {
        const [key, ...values] = l.trim().split(/\s+/)
        return [key, values.map(Number)] as const
      }),
    )
  const before = rows(v.CPU1),
    after = rows(v.CPU2)
  const percentage = (key: string) => {
    const b = before.get(key),
      a = after.get(key)
    if (!a || !b) return 0
    const total = a.reduce((s, n, i) => s + Math.max(0, n - (b[i] ?? 0)), 0),
      idle = a[3] + a[4] - (b[3] + b[4])
    return total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : 0
  }
  const m: ServerMetrics = {
    cpu: percentage('T'),
    cpu_detail: [...after.keys()]
      .filter((k) => /^C\d+$/.test(k))
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .map(percentage),
    mem_used: 0,
    mem_total: 0,
    mem_percent: 0,
    mem_detail: [],
    disk_used: 0,
    disk_total: 0,
    disk_percent: 0,
    cpu_mhz: 0,
    net_rx: 0,
    net_tx: 0,
    net_detail: [],
  }
  const nb = rows(v.NET1 ?? ''),
    na = rows(v.NET2 ?? '')
  for (const [name, a] of na) {
    if (!name || name === 'lo' || name.startsWith('br-')) continue
    const b = nb.get(name) ?? a,
      rx = Math.max(0, a[0] - b[0]),
      tx = Math.max(0, a[1] - b[1])
    m.net_detail.push({ name, rx, tx })
    m.net_rx += rx
    m.net_tx += tx
  }
  for (const line of v.STATIC.split('\n')) {
    const [k, a, b, c] = line.trim().split(/\s+/)
    const n = Number(a) || 0
    if (k === 'MT') m.mem_total = n
    if (k === 'MU') m.mem_used = n
    if (k === 'DU') m.disk_used = n
    if (k === 'DT') m.disk_total = n
    if (k === 'CM') m.cpu_mhz = n
    if (k === 'MP') m.mem_detail.push({ name: a, percent: Number(b) || 0, rss: Number(c) || 0 })
  }
  m.mem_percent = m.mem_total ? (m.mem_used / m.mem_total) * 100 : 0
  m.disk_percent = m.disk_total ? (m.disk_used / m.disk_total) * 100 : 0
  return m
}
