import { SyncService } from '../sync/service.ts'
import type { EventStream } from '../sync/service.ts'
import { sync, isSyncOperation } from '@eizhu/contracts'
import { ArchiveService } from '../archive/service.ts'
import type { Transport } from '../archive/network.ts'
import { archive, isArchiveOperation } from '@eizhu/contracts'
import { SshService } from '../ssh/service.ts'
import { SftpService } from '../sftp/service.ts'
import { sftp,isSftpOperation } from '@eizhu/contracts'
import type { BinaryPort } from '../ssh/stream.ts'
import { ssh, isSshOperation } from '@eizhu/contracts'
import { foundation, fail, sameContext, local, isLocalOperation, offlineWorkspace, account, isAccountOperation } from '@eizhu/contracts'
import type { RpcRequest, RuntimeContext, WorkspaceIdentity } from '@eizhu/contracts'
import { validateWorkspace } from '../account/workspace.ts'
import { AccountService } from '../account/service.ts'
import { workerAccountStorage, accountStorage } from '../account/storage.ts'
import { WorkerClient } from '../workers/client.ts'
import { ResourceScope } from './scope.ts'
import { Client } from 'ssh2'
import type { Payload } from '../local/model.ts'
import type { decodeBackup } from '../local/backup.ts'
import type { FileIdentity } from '../local/backup.ts'
import { join } from 'node:path'

export class RuntimeService {
  private scope = new ResourceScope()
  private database: WorkerClient
  private compute: WorkerClient
  private filePreviews = new Map<string, { token: string; hash: string }>()
  private restoreTokens = new Set<string>()
  private rememberToken(token: string): void {
    if (this.restoreTokens.size >= 4) this.restoreTokens.delete(this.restoreTokens.values().next().value!)
    this.restoreTokens.add(token)
  }
  private archive: ArchiveService
  private ssh: SshService
  private sftp:SftpService
  private verification: { root: string; path: string; path3: string; account: string; sync: string }
  private workspace: WorkspaceIdentity = offlineWorkspace
  private initialized = false
  private sync!: SyncService
  private stream?: EventStream
  private emitSync: (status: import('@eizhu/contracts').SyncStatus, refresh:boolean) => void
  private account!: AccountService
  private emitAccount: (status: import('@eizhu/contracts').AccountStatus) => void
  private accountTransport: Transport
  readonly context: RuntimeContext
  constructor(
    context: RuntimeContext,
    root: string,
    paths: { database: string; compute: string; verification: string; verification3: string; verificationAccount: string; verificationSync: string },
    key: Uint8Array,
    emit: (name: 'eizhu-session-message'|'eizhu-sftp-message'|'eizhu-account-message'|'eizhu-sync-message', payload: unknown) => void = () => undefined,
    localHome?:string,
    transport:Transport=async()=>fail('CLOUD_UNAVAILABLE','云存储网络不可用'),
    workspace?: WorkspaceIdentity,
    accountTransport: Transport = async () => fail('ACCOUNT_UNAVAILABLE', '账号网络不可用'),
    stream?: EventStream,
  ) {
    this.context = context
    this.accountTransport = accountTransport
    this.stream = stream
    this.emitSync = (status, refresh) => emit('eizhu-sync-message', { workspaceGeneration:this.context.generation, status, refresh })
    this.emitAccount = (status) => {emit('eizhu-account-message', { workspaceGeneration: this.context.generation, status });this.sync?.credentialsChanged()}
    this.verification = {
      root: join(root, 'stage2-integration'),
      path: paths.verification,
      path3: paths.verification3,
      account: paths.verificationAccount,
      sync: paths.verificationSync,
    }
    this.database = new WorkerClient(paths.database, { root, key, workspace }, 64)
    this.compute = new WorkerClient(paths.compute, undefined, 8)
    this.scope.own(() => this.database.close())
    this.scope.own(() => this.compute.close())
    this.ssh = new SshService(this.database, this.compute, context, emit)
    this.scope.own(() => this.ssh.close())
    this.sftp=new SftpService(this.ssh,this.database,context,root,emit,localHome)
    this.scope.own(()=>this.sftp.close())
    this.archive=new ArchiveService(this.database,this.compute,transport,token=>this.rememberToken(token))
    this.scope.own(()=>this.archive.close())
  }
  async initialize(): Promise<WorkspaceIdentity> {
    if (this.initialized) fail('RUNTIME_INIT_FAILED', '业务进程已经初始化')
    this.workspace = validateWorkspace(await this.database.call('workspace.identity'))
    this.context.workspaceId = this.workspace.id
    this.account = new AccountService(workerAccountStorage(this.database), this.accountTransport, this.workspace, this.emitAccount, this.compute)
    this.scope.own(() => this.account.close())
    this.sync = new SyncService(this.database,this.compute,this.account,this.workspace,this.context,this.emitSync,this.stream)
    this.scope.own(()=>this.sync.close())
    this.initialized = true
    return this.workspace
  }
  startBackground(): void { this.account.start();this.sync.start() }
  async execute(request: RpcRequest): Promise<unknown> {
    if (!this.initialized) fail('RUNTIME_INIT_FAILED', '业务进程尚未初始化')
    if (!sameContext(request.context, this.context)) fail('WORKSPACE_CHANGED', '数据空间已变化，请重试')
    if (this.scope.controller.signal.aborted) fail('RUNTIME_CLOSED', '业务进程正在关闭')
    if (request.operation === 'account.setSyncEnabled') {const d=account[request.operation].input.parse(request.input);const status=await this.sync.setEnabled(d.enabled);this.emitAccount(status);return status}
    if (isSyncOperation(request.operation)) {
      const result = sync[request.operation].output.parse(await this.sync.execute(request.operation, request.input))
      if (request.operation === 'sync.bootstrap') this.emitAccount(await this.database.call('account.storage.status'))
      return result
    }
    if (isAccountOperation(request.operation)) return account[request.operation].output.parse(await this.account.execute(request.operation, request.input))
    if(isArchiveOperation(request.operation)) return archive[request.operation].output.parse(await this.archive.execute(request.operation,request.input))
    if (isSshOperation(request.operation))
      return ssh[request.operation].output.parse(await this.ssh.execute(request.operation, request.input))
    if(isSftpOperation(request.operation))return sftp[request.operation].output.parse(await this.sftp.execute(request.operation,request.input))
    if(request.operation==='sftp.authorizeEditor'){const d=request.input as {sessionId:string;path:string};return this.sftp.authorizeEditor(d.sessionId,d.path)}
    if(request.operation==='sftp.downloadPath')return this.sftp.downloadPath((request.input as {taskId:string}).taskId)
    switch (request.operation) {
      case 'account.authenticate': {
        const d = request.input as { operation: string; input: unknown }
        if (!d || (d.operation !== 'account.login' && d.operation !== 'account.register')) fail('BAD_REQUEST', '账号操作无效')
        return this.account.authenticate(d.operation, d.input)
      }
      case 'account.prepareLogout': return this.account.prepareLogout()
      case 'account.commitTransition': {
        const d = accountStorage['account.storage.commit'].parse(request.input)
        if (d.target.id !== this.workspace.id) fail('WORKSPACE_CHANGED', '目标空间尚未打开')
        await this.database.call('account.storage.commit', d)
        return this.account.execute('account.status', undefined)
      }
      case 'runtime.beforeQuit': return this.archive.beforeQuit()
      case 'runtime.health':
        await this.database.call('health')
        return { context: this.context, schema: 3, workers: 2 }
      case 'workspace.status':
        return { id: this.context.workspaceId, generation: this.context.generation, userId: this.workspace.userId }
      case 'settings.read':
        return this.database.call('settings.read')
      case 'settings.write':
        return this.database.call('settings.write', foundation['settings.write'].input.parse(request.input))
      case 'runtime.smoke': {
        const client = new Client()
        client.end()
        return {
          ...(await this.compute.call<{ kdf: boolean; crypto: boolean }>('smoke', undefined, {
            signal: this.scope.controller.signal,
          })),
          ssh2: true,
        }
      }
      default:
        if (request.operation === 'runtime.verifySyncEngine') {
          const verifier=new WorkerClient(this.verification.sync,{root:join(this.verification.root,'sync-engine'),fixtures:(request.input as {fixtures:string}).fixtures},1)
          try{return await verifier.call('verify')}finally{await verifier.close()}
        }
        if (request.operation === 'runtime.verifyAccountFoundation') {
          const verifier = new WorkerClient(this.verification.account, { root: join(this.verification.root, 'account-foundation') }, 1)
          try { return await verifier.call('verify') } finally { await verifier.close() }
        }
        if (request.operation === 'runtime.verifyStage3Storage') {
          const verifier = new WorkerClient(
            this.verification.path3,
            { root: join(this.verification.root, 'stage3') },
            1,
          )
          try {
            return await verifier.call('verify')
          } finally {
            await verifier.close()
          }
        }
        if (request.operation === 'runtime.verifyStage2') {
          const verifier = new WorkerClient(
            this.verification.path,
            { root: this.verification.root, fixtures: (request.input as { fixtures: string }).fixtures },
            1,
          )
          try {
            return await verifier.call('verify')
          } finally {
            await verifier.close()
          }
        }
        if (request.operation === 'backup.exportBytes') {
          const input = local['backup.export'].input.parse(request.input)
          return this.compute.call(
            'backup.encode',
            { payload: await this.database.call('local.snapshot'), ...input },
            { signal: this.scope.controller.signal },
          )
        }
        if (request.operation === 'document.readGrantedText')
          return this.compute.call('document.readText', request.input, {
            signal: this.scope.controller.signal,
          })
        if (request.operation === 'backup.granted') {
          const d = request.input as { operation: keyof typeof local; input: unknown; identity: FileIdentity }
          const result = await this.executeLocal(d.operation, d.input, d.identity);if(d.operation==='backup.import')this.sync.wake();return result
        }
        if (request.operation === 'backup.releaseSource') {
          const { path } = request.input as { path: string }
          const preview = this.filePreviews.get(path)
          if (preview) this.restoreTokens.delete(preview.token)
          this.filePreviews.delete(path)
          return
        }
        if (isLocalOperation(request.operation)) {const result=await this.executeLocal(request.operation, request.input);if(/\.(create|update|delete)$/.test(request.operation)||['backup.applyRestore','backup.import'].includes(request.operation))this.sync.wake();return result}
        return fail('STAGE_NOT_READY', '该业务能力尚未开放；官方备份不在本轮账号同步范围')
    }
  }
  private async executeLocal(
    operation: keyof typeof local,
    raw: unknown,
    identity?: FileIdentity,
  ): Promise<unknown> {
    const input = local[operation].input.parse(raw)
    const options = { signal: this.scope.controller.signal }
    switch (operation) {
      case 'vault.generateKeyPair':
        return this.compute.call(operation, input, options)
      case 'vault.create':
      case 'vault.update': {
        const data =
          operation === 'vault.create'
            ? local[operation].input.parse(input)
            : local[operation].input.parse(input)
        const result = await this.compute.call<{ credential: Record<string, string>; fingerprint: string }>(
          'credential.prepare',
          { credential: data.request, type: data.request.type },
          options,
        )
        return this.database.call(operation, { ...data, request: { ...data.request, ...result.credential } })
      }
      case 'profile.create':
      case 'profile.update': {
        const data =
          operation === 'profile.create'
            ? local[operation].input.parse(input)
            : local[operation].input.parse(input)
        if (data.request.private_key)
          await this.compute.call(
            'credential.prepare',
            { credential: data.request, type: 'private_key' },
            options,
          )
        return this.database.call(operation, data)
      }
      case 'backup.preview':
      case 'backup.prepareRestore': {
        // Paths here are substituted by main from a window/context-bound native picker grant.
        const data = local[operation].input.parse(input),
          parsed = await this.compute.call<Awaited<ReturnType<typeof decodeBackup>>>(
            'backup.decode',
            { path: data.filePath, password: data.password, identity },
            options,
          )
        const result = await this.database.call<{
          token: string
          stats: unknown
          conflicts: unknown
          changes: unknown
          credentialMode: string
          exportedAt: string
          source: unknown
        }>('backup.prepare', {
          ...parsed,
          source: { kind: 'file', name: data.filePath.split(/[\\/]/).pop() },
          payload: parsed.payload as Payload,
        })
        if (this.filePreviews.size >= 4) this.filePreviews.delete(this.filePreviews.keys().next().value!)
        this.filePreviews.set(data.filePath, { token: result.token, hash: parsed.hash })
        this.rememberToken(result.token)
        if (operation === 'backup.preview')
          return {
            credential_mode: result.credentialMode,
            exported_at: result.exportedAt,
            stats: result.stats,
            conflicts: result.conflicts,
          }
        const { conflicts, ...preview } = result
        void conflicts
        return preview
      }
      case 'backup.import': {
        const data = local[operation].input.parse(input),
          preview = this.filePreviews.get(data.filePath)
        if (!preview) fail('PREVIEW_EXPIRED', '请先预览备份')
        const parsed = await this.compute.call<Awaited<ReturnType<typeof decodeBackup>>>(
          'backup.decode',
          { path: data.filePath, password: data.password, identity },
          options,
        )
        if (parsed.hash !== preview.hash) fail('PREVIEW_CHANGED', '备份文件已变化，请重新预览')
        const result = await this.database.call('backup.apply', {
          token: preview.token,
          strategy: data.strategy,
        })
        this.filePreviews.clear()
        this.restoreTokens.clear()
        return result
      }
      case 'backup.applyRestore': {
        const data = local[operation].input.parse(input)
        if (!this.restoreTokens.has(data.token)) fail('PREVIEW_EXPIRED', '预览所属运行实例已失效，请重新预览')
        await this.database.call(operation, data)
        this.restoreTokens.clear()
        this.filePreviews.clear()
        return
      }
      case 'backup.previewSafety': {
        const result = await this.database.call<{ token: string; conflicts: unknown }>(operation, input)
        this.rememberToken(result.token)
        const { conflicts, ...preview } = result
        void conflicts
        return preview
      }
      default:
        return this.database.call(operation, input)
    }
  }
  bindTerminal(id: string, subscriptionId: string, port: BinaryPort): Promise<void> {
    return this.ssh.bind(id, subscriptionId, port)
  }
  close(): Promise<void> {
    return this.scope.close()
  }
}
