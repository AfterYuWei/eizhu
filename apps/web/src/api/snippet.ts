import { bridge } from '@/lib/bridge'
import type { SnippetCreateRequest, SnippetUpdateRequest } from '@/types/snippet'

export const snippetApi = {
  list: () => bridge().snippet.list(),

  create: (data: SnippetCreateRequest) => bridge().snippet.create({ request: data }),

  update: (id: string, data: SnippetUpdateRequest) => bridge().snippet.update({ id, request: data }),

  delete: (id: string) => bridge().snippet.delete({ id }),
}
