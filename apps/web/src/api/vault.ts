import { bridge } from '@/lib/bridge'
import type { VaultCreateRequest, VaultUpdateRequest, GenerateKeyRequest } from '@/types/vault'
import type { VaultListParams } from '@eizhu/contracts/models/api'

export type { VaultListParams } from '@eizhu/contracts/models/api'

export const vaultApi = {
  list: (params?: VaultListParams) =>
    bridge().vault.list({
      vaultType: params?.type ?? null,
      q: params?.q ?? null,
    }),

  get: (id: string) => bridge().vault.get({ id }),

  create: (data: VaultCreateRequest) => bridge().vault.create({ request: data }),

  update: (id: string, data: VaultUpdateRequest) => bridge().vault.update({ id, request: data }),

  delete: (id: string) => bridge().vault.delete({ id }),

  references: (id: string) => bridge().vault.references({ id }),

  reveal: (id: string) => bridge().vault.reveal({ id }),

  generateKeyPair: (data: GenerateKeyRequest) =>
    bridge().vault.generateKeyPair({
      request: data,
    }),
}

export type { APIError } from '@eizhu/contracts/models/api'
