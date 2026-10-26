import type { TransferTask, SftpConflictInfo, DirectoryTransferMode, ConflictResolution } from '@eizhu/contracts/models/sftp'
import type { FileStat } from './endpoint.ts'
import type { ArchiveEntry } from './archive.ts'

export interface CopyFile {
  source: string
  dest: string
  stat: FileStat
  target?: FileStat
  temporary: string
  offset: number
  prefixHash?: string
  complete: boolean
  dir: boolean
}
export interface Checkpoint {
  task: TransferTask
  sourceProfile: string
  targetProfile: string
  sourceSession: string
  targetSession: string
  sourceBinding?: string
  targetBinding?: string
  files: CopyFile[]
  index: number
  upload?: { size: number; lastModified: number; sequence: number; prefixHash?: string; prefixBytes?: number }
  download?: boolean
  dragRoot?: string
  archive?: { paths: string[]; rows: ArchiveEntry[]; format: 'tar.gz' | 'zip'; spool: string; ready: boolean; refreshRows?: boolean }
  preparation?: { paths: string[]; destDir: string; mode: DirectoryTransferMode; resolution: ConflictResolution; conflicts?: SftpConflictInfo[] }
}

/** The immutable directory plan is written once; subsequent ACKs save only the cursor. */
export type CheckpointProgress = Omit<Checkpoint, 'files' | 'archive'> & {
  current?: Pick<CopyFile, 'offset' | 'prefixHash' | 'complete'>
  archive?: Omit<NonNullable<Checkpoint['archive']>, 'rows'>
}
export function checkpointProgress(checkpoint: Checkpoint): CheckpointProgress {
  const { files, archive, ...state } = checkpoint
  const file = files[state.index]
  return {
    ...state,
    ...(file ? { current: { offset: file.offset, prefixHash: file.prefixHash, complete: file.complete } } : {}),
    ...(archive ? { archive: { paths: archive.paths, format: archive.format, spool: archive.spool, ready: archive.ready, refreshRows: archive.refreshRows } } : {}),
  }
}
export function restoreCheckpoint(base: Checkpoint, progress?: CheckpointProgress): Checkpoint {
  if (!progress) return base // Existing full checkpoints remain readable.
  const { current, archive, ...state } = progress
  return {
    ...base,
    ...state,
    files: base.files.map((file, index) => ({
      ...file,
      ...(index < state.index ? { complete: true, offset: file.dir ? 0 : file.stat.size } : {}),
      ...(index === state.index ? current : {}),
    })),
    ...(base.archive && archive ? { archive: { ...base.archive, ...archive } } : {}),
  }
}
