import { build } from 'electron-vite'
import { writeFile } from 'node:fs/promises'
import { buildSettings } from './desktop-build-settings.mjs'
const settings = buildSettings()
await build({ configFile: 'apps/desktop/electron.vite.config.ts' })
await writeFile('apps/desktop/out/build-info.json', JSON.stringify(settings, null, 2) + '\n')
