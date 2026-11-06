import { useEffect, useState, useMemo } from 'react'
import { listen } from '@/lib/bridge'
import { tunnelApi } from '@/api/tunnel'
import { sessionApi } from '@/api/session'
import { workspaceGeneration } from '@/lib/workspaceScope'
import { AuthPromptDialog } from './AuthPromptDialog'
import { ConnectionDialog } from '@/components/ConnectionDialog'
import type { AuthenticationRequestPayload } from '@/types/sessionMessage'
/** Always mounted: a pending connection can prompt after its management dialog is closed. */
export function TunnelPrompts() {
  const [prompts, setPrompts] = useState<{ id: string; type: string; request: AuthenticationRequestPayload & { fingerprint?: string; known_fingerprint?: string } }[]>([])
  const prompt = prompts[0] ?? null
  const [error, setError] = useState('')
  useEffect(() => {
    const generation = workspaceGeneration(); let disposed = false
    const listener = listen('eizhu-session-message', ({ payload: event }) => {
      if (disposed || generation !== workspaceGeneration() || (event.workspaceGeneration !== undefined && event.workspaceGeneration !== generation)) return
      if (event.type === 'tunnel_auth_closed') setPrompts((current) => current.filter((pending) => pending.request.request_id !== event.payload.request_id))
      if (event.type === 'tunnel_auth_request' || event.type === 'tunnel_host_key_request') setPrompts((current) => current.some((pending) => pending.request.request_id === event.payload.request_id) ? current : [...current, { id: event.session_id, type: event.type, request: event.payload }])
      if (event.type === 'tunnel_status' && ['stopped', 'failed'].includes(event.payload.status)) setPrompts((current) => current.filter((pending) => pending.id !== event.session_id))
    })
    return () => { disposed = true; void listener.then((stop) => stop()) }
  }, [])
  const authRequest = useMemo(() => prompt?.type === 'tunnel_auth_request' ? { ...prompt.request, instructions: [prompt.request.instructions, error].filter(Boolean).join('\n') } : undefined, [prompt, error])
  const respond = async (responses: string[]) => { if (!prompt) return; try { await sessionApi.respondAuth(prompt.request.request_id, responses); setPrompts((current) => current.filter((pending) => pending.request.request_id !== prompt.request.request_id)); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  const stop = () => { if (prompt) void tunnelApi.stop(prompt.id).then(() => setPrompts((current) => current.filter((pending) => pending.id !== prompt.id))).catch((cause) => setError(String(cause))) }
  return <>
    <AuthPromptDialog request={authRequest} onSubmit={(responses) => void respond(responses)} onCancel={stop} />
    <ConnectionDialog open={prompt?.type === 'tunnel_host_key_request'} onOpenChange={(open) => { if (!open) stop() }} profileName={prompt?.request.name ?? '端口映射'} host="SSH 端口映射" port={22} username="" status="hostkey" logs={[]} errorMessage={error} hostKeyFingerprint={prompt?.request.fingerprint} knownHostKeyFingerprint={prompt?.request.known_fingerprint} onCancel={stop} onReconnectNow={() => {}} onHostKeyDecision={(decision) => void respond([decision, prompt?.request.fingerprint ?? ''])} />
  </>
}
