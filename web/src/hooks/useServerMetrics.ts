import { useEffect, useState } from 'react'
import { serverDetailApi } from '@/api/serverDetail'
import { useServerDetailStore } from '@/store/serverDetail'
import { workspaceGeneration } from '@/lib/workspaceScope'

// A hidden/visible transition cannot start a second request for the same session.
const pending = new Set<string>()

/** 通过细粒度 Tauri command 每 3 秒采集一次服务器指标。 */
export function useServerMetrics(profileId: string, active: boolean) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  const sessionId = useServerDetailStore((state) => state.details[profileId]?.sessionId ?? null)
  const status = useServerDetailStore((state) => state.details[profileId]?.status ?? 'idle')
  const updateMetrics = useServerDetailStore((state) => state.updateMetrics)
  const setWsConnected = useServerDetailStore((state) => state.setWsConnected)
  const markDisconnected = useServerDetailStore((state) => state.markDisconnected)
  const ensureConnected = useServerDetailStore((state) => state.ensureConnected)

  useEffect(() => {
    if (!active || !visible) return
    if (status === 'idle' || status === 'disconnected') {
      void ensureConnected(profileId)
      return
    }
    if (!sessionId || status !== 'connected') return

    let disposed = false
    const generation = workspaceGeneration()
    const key = `${generation}:${sessionId}`
    setWsConnected(profileId, true)

    const collect = async () => {
      if (disposed || pending.has(key) || document.visibilityState === 'hidden' || generation !== workspaceGeneration()) return
      pending.add(key)
      try {
        const metrics = await serverDetailApi.getMetrics(sessionId)
        if (!disposed && generation === workspaceGeneration() && useServerDetailStore.getState().details[profileId]?.sessionId === sessionId) updateMetrics(profileId, metrics)
      } catch (error) {
        if (!disposed && generation === workspaceGeneration() && useServerDetailStore.getState().details[profileId]?.sessionId === sessionId) {
          setWsConnected(profileId, false)
          markDisconnected(profileId, error instanceof Error ? error.message : '管理连接已断开')
        }
      } finally {
        pending.delete(key)
      }
    }

    void collect()
    const timer = setInterval(() => void collect(), 3000)
    return () => {
      disposed = true
      clearInterval(timer)
      if (generation === workspaceGeneration() && useServerDetailStore.getState().details[profileId]?.sessionId === sessionId) setWsConnected(profileId, false)
    }
  }, [active, visible, ensureConnected, markDisconnected, profileId, sessionId, setWsConnected, status, updateMetrics])
}
