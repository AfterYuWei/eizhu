import { expect, it } from 'vitest'
import type { ServerMetrics } from '@/api/serverDetail'
import { appendMetricSample, metricPath, type MetricSample } from './metricSamples'
const metrics = (timestamp: number) => ({ timestamp, cpu: 25, mem_percent: 40, disk_percent: 50, net_rx: 1024, net_tx: 2048 } as ServerMetrics)
it('仅保留最近 120 个紧凑样本，丢弃重复、过期和无效时间戳', () => {
  let samples: MetricSample[] = []
  for (let index = 1; index <= 130; index++) samples = appendMetricSample(samples, metrics(index * 3000))
  expect(samples).toHaveLength(120); expect(samples[0].timestamp).toBe(33000)
  for (const timestamp of [390000, 3000, NaN, Infinity, 0]) expect(appendMetricSample(samples, metrics(timestamp))).toBe(samples)
  expect(Object.keys(samples[0])).toHaveLength(6)
})
it('非法数值不产生 NaN 图形，暂停期间保留采样间隙', () => {
  let samples = appendMetricSample([], { ...metrics(3000), cpu: NaN, net_rx: Infinity, mem_percent: 200, disk_percent: -20 })
  expect(samples[0]).toMatchObject({ cpu: 0, net_rx: 0, mem_percent: 100, disk_percent: 0 })
  samples = appendMetricSample(samples, metrics(6000)); samples = appendMetricSample(samples, metrics(30000))
  const path = metricPath(samples, 'cpu', 100)
  expect(path.match(/M/g)).toHaveLength(2); expect(path).not.toContain('NaN')
  expect(metricPath([], 'cpu', 100)).toBe('')
})
