import { bridge } from '@/lib/bridge'
import type { ProfileCreateRequest, ProfileUpdateRequest } from '@/types/profile'

export const profileApi = {
  list: (params?: { group_id?: string; search?: string }) =>
    bridge().profile.list({
      groupId: params?.group_id ?? null,
      search: params?.search ?? null,
    }),

  get: (id: string) => bridge().profile.get({ id }),

  create: (data: ProfileCreateRequest) => bridge().profile.create({ request: data }),

  update: (id: string, data: ProfileUpdateRequest) => bridge().profile.update({ id, request: data }),

  delete: (id: string) => bridge().profile.delete({ id }),

  testNew: (data: ProfileCreateRequest) => bridge().profile.testNew({ request: data }),

  test: (id: string, data: ProfileUpdateRequest = {}) => bridge().profile.testExisting({ id, request: data }),

  confirmHostKey: (id: string, fingerprint: string) => bridge().profile.confirmHostKey({ id, fingerprint }),
}
