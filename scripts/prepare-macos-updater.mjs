#!/usr/bin/env node

// Give signed macOS archives unique names before merging build artifacts.
import { existsSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function prepareMacosUpdater(dir, version, arch) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !['aarch64', 'x64'].includes(arch)) {
    throw new Error('macOS 更新包需要有效版本号和 aarch64/x64 架构')
  }
  const archives = readdirSync(dir).filter((name) => name.endsWith('.app.tar.gz'))
  // createUpdaterArtifacts is disabled when no signing key is configured.
  if (archives.length === 0) return null
  if (archives.length !== 1) throw new Error('macOS bundle 目录必须仅包含一个更新归档')
  const source = archives[0]
  const target = `eizhu_${version}_${arch}.app.tar.gz`
  if (!existsSync(join(dir, `${source}.sig`))) throw new Error(`缺少签名文件: ${source}.sig`)
  if (source === target) return target
  if (existsSync(join(dir, target)) || existsSync(join(dir, `${target}.sig`))) {
    throw new Error(`macOS 更新包目标文件已存在: ${target}`)
  }
  renameSync(join(dir, source), join(dir, target))
  renameSync(join(dir, `${source}.sig`), join(dir, `${target}.sig`))
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , dir, version, arch] = process.argv
    if (!dir) throw new Error('用法: node scripts/prepare-macos-updater.mjs <bundleDir> <version> <aarch64|x64>')
    const asset = prepareMacosUpdater(dir, version, arch)
    console.log(asset ? `macOS 更新包: ${asset}` : '未生成 macOS 更新归档，跳过重命名')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
