import type { ServerInfo } from '@eizhu/contracts/models/api'
import { fail, serverMetricsSummarySchema, serverMetricDetailSchema } from '@eizhu/contracts'
import type { ServerMetricKind, ServerMetricDetail, ServerMetricsSummary } from '@eizhu/contracts'
export const INFO_COMMAND =
  "\nprintf '===HOSTNAME===\\n'; (hostname -f 2>/dev/null || hostname)\nprintf '===OS===\\n'; (awk '/^PRETTY_NAME=/{sub(/^[^=]*=/, \"\"); gsub(/^\"|\"$/, \"\"); print; exit}' /etc/os-release 2>/dev/null || uname -s)\nprintf '===OS_ID===\\n'; awk -F= '/^ID=/{gsub(/^\"|\"$/, \"\", $2); print tolower($2); exit}' /etc/os-release 2>/dev/null\nprintf '===OS_LIKE===\\n'; awk '/^ID_LIKE=/{sub(/^[^=]*=/, \"\"); gsub(/^\"|\"$/, \"\"); print tolower($0); exit}' /etc/os-release 2>/dev/null\nprintf '===PRODUCT===\\n';\nif [ -d /usr/trim ] || [ -S /run/trim_cgi.socket ]; then echo fnos\nelif command -v pveversion >/dev/null 2>&1 || [ -d /etc/pve ]; then echo proxmox\nelif command -v midclt >/dev/null 2>&1 && [ -e /etc/version ]; then echo truenas\nelif [ -e /etc/synoinfo.conf ] || [ -e /etc.defaults/VERSION ]; then echo synology\nelif [ -e /etc/config/uLinux.conf ]; then echo qnap\nelif [ -e /etc/unraid-version ]; then echo unraid\nelif [ -e /etc/openmediavault/config.xml ] || command -v omv-confdbadm >/dev/null 2>&1; then echo openmediavault\nelif [ -e /etc/openwrt_release ] || [ -e /etc/openwrt_version ] || command -v uci >/dev/null 2>&1; then echo openwrt\nelif command -v opnsense-version >/dev/null 2>&1 || [ -e /usr/local/etc/opnsense-update.conf ]; then echo opnsense\nelif command -v pfSsh.php >/dev/null 2>&1 || [ -e /etc/inc/globals.inc ]; then echo pfsense\nelif [ -e /etc/vyos-version ] || [ -d /opt/vyatta ]; then echo vyos\nelif [ -e /etc/yunohost ]; then echo yunohost\nelif command -v casaos-cli >/dev/null 2>&1 || [ -d /etc/casaos ]; then echo casaos\nelif [ -d /home/umbrel/umbrel ] || [ -d /umbrel ]; then echo umbrel\nfi\nprintf '===KERNEL===\\n'; uname -r\nprintf '===ARCH===\\n'; uname -m\nprintf '===UPTIME===\\n'; (uptime -p 2>/dev/null || uptime)\nprintf '===LOAD===\\n'; (cat /proc/loadavg 2>/dev/null || uptime)\nprintf '===CPUS===\\n'; (nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)\nprintf '===CPUMHZ===\\n'; awk '/cpu MHz/{s+=$4;c++} END{if(c) printf \"%.2f\\n\",s/c;else print 0}' /proc/cpuinfo 2>/dev/null\n"
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

const CPU_TOTAL = `awk '/^cpu /{print "T",$2,$3,$4,$5,$6,$7,$8,$9}' /proc/stat`
const CPU_CORES = `awk '/^cpu /{print "T",$2,$3,$4,$5,$6,$7,$8,$9}/^cpu[0-9]+ /{c=$1;sub(/^cpu/,"",c);print "C" c,$2,$3,$4,$5,$6,$7,$8,$9}' /proc/stat`
const NETWORK = `awk 'NR>2{n=$1;gsub(/:/,"",n);print n,$2,$10}' /proc/net/dev`
const MEMORY = `awk '/^MemTotal:/{mt=$2*1024}/^MemAvailable:/{ma=$2*1024;found=1} END{if(!found) exit 1;print "MT",mt;print "MU",mt-ma}' /proc/meminfo`
const ROOT_DISK = `df -B1 -P / | awk 'NR==2{print "DU",$3;print "DT",$2}'`
const FREQUENCY = `awk '/cpu MHz/{s+=$4;c++} END{if(c) printf "CM %.2f\\n",s/c;else print "CM 0"}' /proc/cpuinfo`

// The background sample never enumerates processes, per-core values or volumes.
export const SUMMARY_COMMAND = `set -e
printf '===TIME1===\\n'; cut -d ' ' -f 1 /proc/uptime
printf '===CPU1===\\n'; ${CPU_TOTAL}
printf '===NET1===\\n'; ${NETWORK}
sleep 1
printf '===CPU2===\\n'; ${CPU_TOTAL}
printf '===NET2===\\n'; ${NETWORK}
printf '===TIME2===\\n'; cut -d ' ' -f 1 /proc/uptime
printf '===STATIC===\\n'; ${MEMORY}
${ROOT_DISK}
`
export const METRIC_COMMANDS: Record<ServerMetricKind, string> = {
  cpu: `set -e
printf '===CPU1===\\n'; ${CPU_CORES}
sleep 1
printf '===CPU2===\\n'; ${CPU_CORES}
printf '===STATIC===\\n'; ${FREQUENCY}
`,
  memory: `set -e
printf '===STATIC===\\n'; ${MEMORY}
processes=$(ps -eo rss=,%mem=,comm= --sort=-rss)
printf '===PROCESSES===\\n'
printf '%s\\n' "$processes" | head -6 | awk '{rss=$1*1024;percent=$2;$1=$2="";sub(/^[[:space:]]+/,"");printf "MP\\t%.4f\\t%.0f\\t%s\\n",percent,rss,$0}'
`,
  disk: `set -e
printf '===STATIC===\\n'; ${ROOT_DISK}
printf '===VOLUMES===\\n'
df -B1 -P -x tmpfs -x devtmpfs | awk 'NR>1'
`,
  network: `set -e
printf '===TIME1===\\n'; cut -d ' ' -f 1 /proc/uptime
printf '===NET1===\\n'; ${NETWORK}
sleep 1
printf '===NET2===\\n'; ${NETWORK}
printf '===TIME2===\\n'; cut -d ' ' -f 1 /proc/uptime
`,
}
function numericRows(value: string): Map<string, number[]> {
  return new Map(
    value
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, ...raw] = line.trim().split(/\s+/)
        const values = raw.map(Number)
        if (!values.length || values.some((number) => !Number.isFinite(number) || number < 0))
          fail('METRICS_UNSUPPORTED', '服务器指标格式不可识别')
        return [key, values]
      }),
  )
}
function cpuUsage(v: Record<string, string>, cores: boolean) {
  if (!v.CPU1 || !v.CPU2) fail('METRICS_UNSUPPORTED', '此服务器未提供可采集的 /proc CPU 指标')
  const before = numericRows(v.CPU1),
    after = numericRows(v.CPU2)
  const usage = (key: string) => {
    const a = after.get(key),
      b = before.get(key)
    if (!a || !b || a.length !== 8 || b.length !== 8) fail('METRICS_UNSUPPORTED', '服务器 CPU 采样不完整')
    const total = a.reduce((sum, number, index) => sum + Math.max(0, number - b[index]), 0)
    const idle = a[3] + a[4] - b[3] - b[4]
    return total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : 0
  }
  return {
    cpu: usage('T'),
    cpu_detail: cores
      ? [...after.keys()]
          .filter((key) => /^C\d+$/.test(key))
          .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
          .map(usage)
      : [],
  }
}
function networkRates(v: Record<string, string>) {
  const elapsed = Number(v.TIME2) - Number(v.TIME1)
  if (
    !Object.hasOwn(v, 'NET1') ||
    !Object.hasOwn(v, 'NET2') ||
    !v.TIME1 ||
    !v.TIME2 ||
    !Number.isFinite(elapsed) ||
    elapsed <= 0
  )
    fail('METRICS_UNSUPPORTED', '服务器网络采样不完整')
  const before = numericRows(v.NET1),
    after = numericRows(v.NET2)
  const net_detail = []
  let net_rx = 0,
    net_tx = 0
  for (const [name, a] of after) {
    if (name === 'lo' || name.startsWith('br-')) continue
    const b = before.get(name) ?? a
    if (a.length !== 2 || b.length !== 2) fail('METRICS_UNSUPPORTED', '服务器网络采样格式不可识别')
    const rx = Math.max(0, a[0] - b[0]) / elapsed,
      tx = Math.max(0, a[1] - b[1]) / elapsed
    net_detail.push({ name, rx, tx })
    net_rx += rx
    net_tx += tx
  }
  return { net_rx, net_tx, net_detail }
}
function capacity(v: Record<string, string>, kind: 'memory' | 'disk') {
  const values = numericRows(v.STATIC ?? '')
  const used = values.get(kind === 'memory' ? 'MU' : 'DU')?.[0]
  const total = values.get(kind === 'memory' ? 'MT' : 'DT')?.[0]
  if (used === undefined || total === undefined || total <= 0 || used > total)
    fail('METRICS_UNSUPPORTED', '服务器容量指标不可用')
  return { used, total, percent: (used / total) * 100 }
}
export function parseSummary(output: string): ServerMetricsSummary {
  const v = sections(output),
    cpu = cpuUsage(v, false),
    memory = capacity(v, 'memory'),
    disk = capacity(v, 'disk'),
    network = networkRates(v)
  return serverMetricsSummarySchema.parse({
    cpu: cpu.cpu,
    mem_percent: memory.percent,
    disk_percent: disk.percent,
    net_rx: network.net_rx,
    net_tx: network.net_tx,
  })
}
export function parseMetricDetail(kind: ServerMetricKind, output: string): ServerMetricDetail {
  const v = sections(output)
  switch (kind) {
    case 'cpu': {
      const cpu = cpuUsage(v, true)
      if (!cpu.cpu_detail.length) fail('METRICS_UNSUPPORTED', '服务器未提供分核指标')
      return serverMetricDetailSchema.parse({
        kind,
        ...cpu,
        cpu_mhz: numericRows(v.STATIC ?? '').get('CM')?.[0] ?? 0,
      })
    }
    case 'memory': {
      const memory = capacity(v, kind)
      if (!Object.hasOwn(v, 'PROCESSES')) fail('METRICS_UNSUPPORTED', '服务器未提供进程内存指标')
      const mem_detail = v.PROCESSES.split('\n')
        .filter(Boolean)
        .map((line) => {
          const [tag, percent, rss, ...name] = line.split('\t')
          if (tag !== 'MP') fail('METRICS_UNSUPPORTED', '服务器进程内存指标不可识别')
          return { name: name.join('\t'), percent: Number(percent), rss: Number(rss) }
        })
      return serverMetricDetailSchema.parse({
        kind,
        mem_used: memory.used,
        mem_total: memory.total,
        mem_percent: memory.percent,
        mem_detail,
      })
    }
    case 'disk': {
      const disk = capacity(v, kind)
      if (!v.VOLUMES) fail('METRICS_UNSUPPORTED', '服务器未提供挂载点容量指标')
      const volumes = v.VOLUMES.split('\n')
        .filter(Boolean)
        .map((line) => {
          const [filesystem, total, used, , , ...path] = line.trim().split(/\s+/)
          return {
            filesystem,
            path: path.join(' '),
            used: Number(used),
            total: Number(total),
            percent: Number(total) > 0 ? (Number(used) / Number(total)) * 100 : 0,
          }
        })
      return serverMetricDetailSchema.parse({
        kind,
        disk_used: disk.used,
        disk_total: disk.total,
        disk_percent: disk.percent,
        volumes,
      })
    }
    case 'network':
      return serverMetricDetailSchema.parse({ kind, ...networkRates(v) })
  }
}
