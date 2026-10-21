import { bridge } from '@/lib/bridge'
import type { CredentialMode } from '@eizhu/contracts/models/api'
import type { ImportStrategy } from '@eizhu/contracts/models/api'
import type { BackupSource } from '@eizhu/contracts/models/api'

export type { CredentialMode } from '@eizhu/contracts/models/api'
export type { ImportStrategy } from '@eizhu/contracts/models/api'

export type { BackupStats } from '@eizhu/contracts/models/api'

export type { BackupPreview } from '@eizhu/contracts/models/api'

export type { BackupImportResult } from '@eizhu/contracts/models/api'

/** Node.js 系统对话框返回的待导入文件；正文始终留在 Node.js 侧。 */
export type { BackupSource } from '@eizhu/contracts/models/api'

export async function pickBackupFile(): Promise<BackupSource | null> {
  const picked = await bridge().backup.pickFile()
  if (!picked) return null
  if (typeof picked === 'string') {
    return { name: picked.split(/[\\/]/).pop() ?? picked, path: picked }
  }
  return { name: picked.name, path: picked.reference }
}

export async function releaseBackupSource(src: BackupSource): Promise<void> {
  await bridge().document.release({ reference: src.path })
}

/** Node.js 直接导出数据库并通过系统保存对话框落盘。 */
export async function exportBackup(mode: CredentialMode, password?: string): Promise<string | null> {
  return bridge().backup.export({ mode, password })
}

export function previewBackup(src: BackupSource, password?: string) {
  return bridge().backup.preview({
    filePath: src.path,
    password,
  })
}

export function importBackup(src: BackupSource, strategy: ImportStrategy, password?: string) {
  return bridge().backup.import({
    filePath: src.path,
    strategy,
    password,
  })
}
