import { useEffect, useState } from 'react'
import { serverDetailApi } from '@/api/serverDetail'
import { workspaceGeneration } from '@/lib/workspaceScope'
import type {
  ServerInfo,
  ServerMetricKind,
  ServerMetricDetail,
  ServerMetricsSummary,
} from '@/api/serverDetail'

export type ServerInspectionTarget = ServerMetricKind | 'info'
export type ServerInspection = ServerMetricDetail | { kind: 'info'; info: ServerInfo }
const summaries = new Map<string, Promise<ServerMetricsSummary>>()
const inspections = new Map<string, Promise<ServerInspection>>()

/** Summary polling and the one currently inspected item belong to this SSH session. */
export function useServerMetrics(
  sessionId: string | null,
  active: boolean,
  inspected: ServerInspectionTarget | null = null,
) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  const [summary, setSummary] = useState<{
    key: string
    value: ServerMetricsSummary | null
    error: string | null
  }>({ key: '', value: null, error: null })
  const [inspection, setInspection] = useState<{
    key: string
    value: ServerInspection | null
    error: string | null
  }>({ key: '', value: null, error: null })
  const generation = workspaceGeneration()
  const summaryKey = `${generation}:${sessionId}:summary`
  const inspectionKey = `${generation}:${sessionId}:${inspected}`
  const enabled = active && visible && Boolean(sessionId)

  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])

  useEffect(() => {
    if (!enabled || !sessionId) return
    let disposed = false
    const collect = async () => {
      if (disposed || document.visibilityState === 'hidden' || generation !== workspaceGeneration()) return
      let request = summaries.get(summaryKey)
      try {
        if (!request) {
          request = serverDetailApi.getSummary(sessionId)
          summaries.set(summaryKey, request)
        }
        const value = await request
        if (!disposed && generation === workspaceGeneration())
          setSummary({ key: summaryKey, value, error: null })
      } catch (error) {
        if (!disposed && generation === workspaceGeneration())
          setSummary({
            key: summaryKey,
            value: null,
            error: error instanceof Error ? error.message : '服务器摘要暂不可用',
          })
      } finally {
        if (summaries.get(summaryKey) === request) summaries.delete(summaryKey)
      }
    }
    void collect()
    const timer = setInterval(() => void collect(), 3000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [enabled, sessionId, generation, summaryKey])

  useEffect(() => {
    if (!enabled || !sessionId || !inspected) return
    let disposed = false
    const collect = async () => {
      if (disposed || document.visibilityState === 'hidden' || generation !== workspaceGeneration()) return
      let request = inspections.get(inspectionKey)
      try {
        if (!request) {
          request =
            inspected === 'info'
              ? serverDetailApi.getInfo(sessionId).then((info): ServerInspection => ({ kind: 'info', info }))
              : serverDetailApi.getMetricDetail(sessionId, inspected)
          inspections.set(inspectionKey, request)
        }
        const value = await request
        if (!disposed && generation === workspaceGeneration())
          setInspection({ key: inspectionKey, value, error: null })
      } catch (error) {
        if (!disposed && generation === workspaceGeneration())
          setInspection({
            key: inspectionKey,
            value: null,
            error: error instanceof Error ? error.message : '服务器详情暂不可用',
          })
      } finally {
        if (inspections.get(inspectionKey) === request) inspections.delete(inspectionKey)
      }
    }
    void collect()
    const timer = setInterval(() => void collect(), 3000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [enabled, sessionId, inspected, generation, inspectionKey])

  return {
    summary: enabled && summary.key === summaryKey ? summary.value : null,
    summaryError: enabled && summary.key === summaryKey ? summary.error : null,
    inspection: enabled && inspection.key === inspectionKey ? inspection.value : null,
    inspectionError: enabled && inspection.key === inspectionKey ? inspection.error : null,
  }
}
