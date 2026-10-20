import { bridge } from '@/lib/bridge'
import type { GroupCreateRequest, GroupUpdateRequest } from '@/types/group'

export const groupApi = {
  list: () => bridge().group.list(),

  create: (data: GroupCreateRequest) => bridge().group.create({ request: data }),

  update: (id: string, data: GroupUpdateRequest) => bridge().group.update({ id, request: data }),

  delete: (id: string) => bridge().group.delete({ id }),
}
