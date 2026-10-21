import { randomUUID } from 'node:crypto'
import { stat, writeFile, rename, rm,copyFile,open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fail, sameContext } from '@eizhu/contracts'
import type { RuntimeContext } from '@eizhu/contracts'

export type FileIdentity = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }
type Grant = {
  owner: number
  context: RuntimeContext
  path: string
  kind: 'backup' | 'text'
  expires: number
  identity: FileIdentity
}
/** Renderer strings are opaque capabilities, never filesystem paths or reusable cross-window grants. */
export class DocumentGrants {
  private grants = new Map<string, Grant>()
  async add(owner: number, context: RuntimeContext, path: string, kind: Grant['kind']) {
    const info = await stat(path)
    if (!info.isFile() || info.size > (kind === 'backup' ? 50 * 1024 * 1024 : 1024 * 1024))
      fail('FILE_TOO_LARGE', '所选文件超过大小限制或不是普通文件')
    this.prune()
    if (this.grants.size >= 64) fail('QUEUE_FULL', '已选择的文件过多，请先取消或释放文件')
    const reference = randomUUID(),
      identity = {
        dev: info.dev,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
      }
    this.grants.set(reference, {
      owner,
      context: { ...context },
      path,
      kind,
      identity,
      expires: Date.now() + 15 * 60 * 1000,
    })
    return { reference, name: basename(path), size: info.size }
  }
  get(owner: number, context: RuntimeContext, reference: string, kind?: Grant['kind']) {
    this.prune()
    const grant = this.grants.get(reference)
    if (
      !grant ||
      grant.owner !== owner ||
      !sameContext(context, grant.context) ||
      (kind && grant.kind !== kind)
    )
      fail('FORBIDDEN', '文件授权已失效，请重新选择文件')
    return grant
  }
  release(owner: number, context: RuntimeContext, reference: string) {
    const grant = this.get(owner, context, reference)
    this.grants.delete(reference)
    return grant
  }
  revoke(owner?: number): void {
    for (const [id, g] of this.grants) if (owner === undefined || g.owner === owner) this.grants.delete(id)
  }
  private prune(): void {
    for (const [id, g] of this.grants) if (g.expires < Date.now()) this.grants.delete(id)
  }
}
/** Selected destination is replaced only after the complete new content has been written successfully. */
export async function saveAtomically(path: string, content: Uint8Array | string): Promise<void> {
  const temporary = join(dirname(path), `.eizhu-save-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
export async function exportFileAtomically(source:string,path:string):Promise<void>{
  const temporary=join(dirname(path),`.eizhu-save-${randomUUID()}.tmp`)
  try{await copyFile(source,temporary,constants.COPYFILE_EXCL);const handle=await open(temporary,'r+');try{await handle.sync()}finally{await handle.close()}await rename(temporary,path)}finally{await rm(temporary,{force:true})}
}
