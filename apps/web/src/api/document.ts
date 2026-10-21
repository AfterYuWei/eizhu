import { bridge } from '@/lib/bridge'

export type { DocumentDescriptor } from '@eizhu/contracts/models/api'

export const documentApi = {
  pick: (multiple = false, mimeTypes: string[] = []) => bridge().document.pick({ multiple, mimeTypes }),
  release: (reference: string) => bridge().document.release({ reference }),
  readText: (reference: string, maxBytes = 1024 * 1024) =>
    bridge().document.readText({ reference, maxBytes }),
  exportText: (content: string, suggestedName: string, mimeType = 'text/plain') =>
    bridge().document.exportText({ content, suggestedName, mimeType }),
}

export async function pickDocumentText(mimeTypes: string[] = ['text/plain'], maxBytes = 1024 * 1024) {
  const document = (await documentApi.pick(false, mimeTypes))[0]
  if (!document) return null
  try {
    return await documentApi.readText(document.reference, maxBytes)
  } finally {
    await documentApi.release(document.reference).catch(() => undefined)
  }
}
