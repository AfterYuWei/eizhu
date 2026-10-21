import { readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execute = promisify(execFile)
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0

const moduleCases = {
  account: ['ACCOUNT-01', 'ACCOUNT-02'], audit: ['DIAG-01'],
  backup: ['BACKUP-01', 'BACKUP-02'], backup_compat: ['ARCHIVE-01', 'ARCHIVE-02'],
  legacy_backup: ['ARCHIVE-01', 'ARCHIVE-02', 'BACKUP-02'],
  desktop: ['SHELL-04', 'EDITOR-03', 'PLATFORM-01', 'DIAG-01'],
  document: ['PLATFORM-01', 'SFTP-02', 'VAULT-02', 'CLEAN-01'],
  group: ['PROFILE-01'], lifecycle: ['RELIABILITY-01', 'CLEAN-01'],
  local_state: ['LOCAL-01', 'TERM-02'], platform: ['PLATFORM-01', 'CLEAN-01'],
  profile: ['PROFILE-01', 'PROFILE-02'], server_detail: ['METRICS-01', 'EDITOR-01'],
  sftp: ['SFTP-01', 'SFTP-02', 'SFTP-03', 'EDITOR-02'],
  snippet: ['TERM-03'], ssh: ['SSH-01', 'SSH-02', 'SSH-03', 'TERM-01', 'TERM-03'],
  sync: ['SYNC-01', 'SYNC-02', 'ACCOUNT-02'], tunnel: ['TUNNEL-01'],
  vault: ['VAULT-01', 'VAULT-02', 'SECURITY-01'],
}

export async function filesUnder(root, relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const files = await Promise.all(entries.sort((a, b) => compare(a.name, b.name)).map(async entry => {
    const next = path.posix.join(relative, entry.name)
    return entry.isDirectory() ? filesUnder(root, next) : [next]
  }))
  return files.flat()
}

export async function collectLegacyInventory(root, { revision } = {}) {
  if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected a frozen full Git commit SHA')
  const cache = new Map()
  const read = relative => {
    if (!cache.has(relative)) cache.set(relative, revision
      ? execute('git', ['show', `${revision}:${relative}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 << 20 }).then(result => result.stdout)
      : readFile(path.join(root, relative), 'utf8'))
    return cache.get(relative)
  }
  const list = async relative => revision
    ? (await execute('git', ['ls-tree', '-rz', '--name-only', revision, '--', relative], { cwd: root, encoding: 'utf8', maxBuffer: 8 << 20 })).stdout.split('\0').filter(Boolean).sort()
    : filesUnder(root, relative)
  const bootstrap = await read('src-tauri/src/app/bootstrap.rs')
  const handlers = [...bootstrap.matchAll(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/g)]
  if (handlers.length !== 2) throw new Error('Expected separate mobile and desktop handler lists; review the source before refreshing')
  const names = block => new Set([...block.matchAll(/commands::([a-z][a-z_0-9]+)/g)].map(match => match[1]))
  const mobile = names(handlers[0][1])
  const desktop = names(handlers[1][1])
  const registered = new Set([...desktop, ...mobile])
  const commands = new Map()
  for (const source of await list('src-tauri/src/commands')) {
    if (!source.endsWith('.rs') || source.endsWith('/mod.rs')) continue
    const content = await read(source)
    const module = path.basename(source, '.rs')
    for (const match of content.matchAll(/#\[tauri::command(?:\([^\]]*\))?\][\s\S]*?pub\(crate\)\s+(?:async\s+)?fn\s+(\w+)\s*\(/g)) {
      const name = match[1]
      if (!registered.has(name)) continue
      const existing = commands.get(name)
      const start = content.indexOf('pub(crate)', match.index)
      const open = content.indexOf('(', content.indexOf(`fn ${name}`, start))
      let end = open + 1
      let depth = 1
      for (; depth && end < content.length; end++) {
        if (content[end] === '(') depth++
        if (content[end] === ')') depth--
      }
      if (depth) throw new Error(`Unterminated command signature: ${name}`)
      const body = content.indexOf('{', end)
      const definition = {
        source, line: content.slice(0, start).split('\n').length,
        signature: content.slice(start, body).replace(/\s+/g, ' ').trim(),
      }
      if (existing) { existing.definitions.push(definition); continue }
      if (!moduleCases[module]) throw new Error(`Unclassified command module: ${module}`)
      const caseIds = [...moduleCases[module]]
      let disposition = 'replace-domain-contract'
      let note = '保留业务行为，替换为类型化Electron/Node契约；不要求保留旧命令名称。'
      if (['migrate_electron_settings', 'mark_electron_settings_migrated', 'history_import'].includes(name)) {
        disposition = 'remove-legacy-migration'; note = '删除旧数据迁移入口，新目录从零初始化。'
        caseIds.push('CLEAN-02')
      } else if (['app_lifecycle_update', 'app_background_expired'].includes(name)) {
        disposition = 'remove-mobile-lifecycle'; note = '删除移动端后台恢复窗口；桌面关闭、网络恢复和采样控制由桌面生命周期管理。'
      } else if (name.endsWith('_base64')) {
        disposition = 'remove-mobile-transport'; note = '删除移动端Base64分块传输，桌面二进制及直接文件流式传输继续保留。'
        caseIds.push('CLEAN-01')
      } else if (['desktop', 'document', 'platform', 'lifecycle'].includes(module)) {
        disposition = 'replace-platform-contract'; note = '替换平台或运行时适配，逐项保留桌面仍使用的文件、窗口、网络及诊断能力。'
      } else if (module === 'backup_compat' || (module === 'legacy_backup' && name.startsWith('sync_'))) {
        disposition = 'replace-legacy-command-alias'; note = '移除旧IPC别名，对应版本/云备份业务继续保留，不能因legacy文件名而删除能力。'
        caseIds.push('CLEAN-02')
      }
      commands.set(name, { name, module, desktop: desktop.has(name), mobile: mobile.has(name), disposition, note, caseIds, definitions: [definition], frontend: [] })
    }
  }
  for (const name of registered) if (!commands.has(name)) throw new Error(`Missing definition for ${name}`)
  const frontendFiles = (await list('web/src')).filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))
  for (const file of frontendFiles) {
    const text = await read(file)
    for (const match of text.matchAll(/['"]([a-z][a-z_0-9]+)['"]/g)) {
      const command = commands.get(match[1])
      if (command && !command.frontend.includes(file)) command.frontend.push(file)
    }
  }
  const eventCases = {
    'eizhu-session-message': ['SSH-03', 'TERM-01', 'TERM-03', 'TUNNEL-01'],
    'eizhu-sftp-message': ['SFTP-02', 'SFTP-03'],
    'eizhu-sync-message': ['SYNC-01', 'SYNC-02'],
    'eizhu-workspace-changed': ['ACCOUNT-02'],
    'eizhu-editor-open-file': ['EDITOR-01', 'EDITOR-03'],
    'eizhu-app-close-request': ['EDITOR-03', 'RELIABILITY-01'],
    'eizhu-editor-transition': ['EDITOR-03', 'ACCOUNT-02'],
  }
  const eventSources = ['src-tauri/src/app/events.rs', 'src-tauri/src/app/workspace.rs', 'src-tauri/src/infrastructure/platform/desktop/editor_window.rs']
  const events = []
  for (const [name, caseIds] of Object.entries(eventCases)) {
    const sources = []
    for (const file of [...eventSources, ...frontendFiles]) {
      if ((await read(file)).includes(name)) sources.push(file)
    }
    if (!sources.some(file => file.startsWith('src-tauri/'))) throw new Error(`Missing event producer: ${name}`)
    events.push({ name, caseIds, sources, disposition: 'replace-typed-event' })
  }
  return { commands: [...commands.values()].sort((a, b) => compare(a.name, b.name)), events }
}
