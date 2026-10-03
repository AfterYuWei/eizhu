import type { ServerMetrics } from '@/api/serverDetail'
export type MetricSample = Pick<ServerMetrics, 'timestamp' | 'cpu' | 'mem_percent' | 'disk_percent' | 'net_rx' | 'net_tx'>
export const METRIC_SAMPLE_LIMIT = 120
export function appendMetricSample(samples: MetricSample[], metrics: ServerMetrics): MetricSample[] {
  if (!Number.isFinite(metrics.timestamp) || metrics.timestamp <= 0 || (samples.at(-1)?.timestamp ?? 0) >= metrics.timestamp) return samples
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
  const percent = (value: number) => Math.min(100, finite(value))
  return [...samples.slice(-(METRIC_SAMPLE_LIMIT - 1)), { timestamp: metrics.timestamp, cpu: percent(metrics.cpu), mem_percent: percent(metrics.mem_percent), disk_percent: percent(metrics.disk_percent), net_rx: finite(metrics.net_rx), net_tx: finite(metrics.net_tx) }]
}
/** Leave a visible gap when sampling was suspended; use actual sample timestamps. */
export function metricPath(samples: MetricSample[], key: Exclude<keyof MetricSample, 'timestamp'>, maximum: number): string {
  if (samples.length < 2) return ''
  const start = samples[0].timestamp, duration = Math.max(1, samples.at(-1)!.timestamp - start)
  return samples.map((sample, index) => `${index === 0 || sample.timestamp - samples[index - 1].timestamp > 6000 ? 'M' : 'L'}${((sample.timestamp - start) / duration * 240).toFixed(2)},${(46 - Math.min(1, sample[key] / Math.max(1, maximum)) * 42).toFixed(2)}`).join(' ')
}
