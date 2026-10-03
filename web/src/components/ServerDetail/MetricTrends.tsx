import { metricPath, type MetricSample } from '@/lib/metricSamples'
export function MetricTrends({ samples }: { samples: MetricSample[] }) {
  if (samples.length < 2) return <p className="px-3 py-1 text-xs text-muted-foreground">趋势等待下一次采样</p>
  const maximum = Math.max(1, ...samples.flatMap((sample) => [sample.net_rx, sample.net_tx]))
  const seconds = Math.round((samples.at(-1)!.timestamp - samples[0].timestamp) / 1000)
  const lines = (keys: ('cpu' | 'mem_percent' | 'disk_percent' | 'net_rx' | 'net_tx')[], max: number) => keys.map((key) => <path key={key} className={`metric-trend-${key}`} d={metricPath(samples, key, max)} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)
  return <div className="metric-trends px-3 py-1 text-xs text-muted-foreground">
    <p>最近 {seconds < 60 ? `${seconds} 秒` : `${(seconds / 60).toFixed(1)} 分钟`} · {samples.length} 个样本</p>
    <div className="flex gap-3"><span className="metric-trend-cpu">CPU</span><span className="metric-trend-mem_percent">内存</span><span className="metric-trend-disk_percent">磁盘</span><span>0–100%</span></div>
    <svg role="img" aria-label="CPU、内存与磁盘使用率趋势" viewBox="0 0 240 50" className="h-12 w-full">{lines(['cpu', 'mem_percent', 'disk_percent'], 100)}</svg>
    <div className="flex gap-3"><span className="metric-trend-net_rx">↓ 接收</span><span className="metric-trend-net_tx">↑ 发送</span><span>上限 {(maximum / 1024).toFixed(1)} KiB/s</span></div>
    <svg role="img" aria-label="网络接收与发送速率趋势" viewBox="0 0 240 50" className="h-12 w-full">{lines(['net_rx', 'net_tx'], maximum)}</svg>
  </div>
}
