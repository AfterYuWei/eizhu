import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
// @ts-expect-error Build-only ESM settings shared with electron-builder.
import { buildSettings } from '../../scripts/desktop-build-settings.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const desktop = resolve(root, 'apps/desktop')
const web = resolve(root, 'apps/web')
const internal = { '@eizhu/contracts': resolve(root, 'packages/contracts/src/index.ts') }
const external = ['electron', 'better-sqlite3', 'argon2', 'electron-updater', 'ssh2']
const { version, channel, feeds, updateRepository } = buildSettings()
export default defineConfig({
  main: {
    define: {
      __EIZHU_VERSION__: JSON.stringify(version),
      __EIZHU_CHANNEL__: JSON.stringify(channel),
      __EIZHU_UPDATE_FEEDS__: JSON.stringify(feeds),
      __EIZHU_UPDATE_REPOSITORY__: JSON.stringify(updateRepository),
    },
    resolve: { alias: internal },
    build: {
      outDir: resolve(desktop, 'out/main'),
      externalizeDeps: false,
      rollupOptions: {
        external,
        input: {
          index: resolve(desktop, 'src/main/index.ts'),
          runtime: resolve(desktop, 'src/runtime/index.ts'),
          database: resolve(root, 'packages/core/src/database/worker.ts'),
          compute: resolve(root, 'packages/core/src/workers/compute.ts'),
          stage2: resolve(root, 'packages/core/src/database/stage2-smoke.ts'),
          stage3: resolve(root, 'packages/core/src/database/stage3-smoke.ts'),
          'account-foundation': resolve(root, 'packages/core/src/database/account-foundation-smoke.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs', chunkFileNames: 'chunks/[name]-[hash].cjs' },
      },
    },
  },
  preload: {
    resolve: { alias: internal },
    build: {
      outDir: resolve(desktop, 'out/preload'),
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        input: resolve(desktop, 'src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true },
      },
    },
  },
  renderer: {
    root: web,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(web, 'src') } },
    define: {
      'import.meta.env.VITE_EIZHU_VERSION': JSON.stringify(version),
      'import.meta.env.VITE_EIZHU_CHANNEL': JSON.stringify(channel),
    },
    build: {
      outDir: resolve(desktop, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(web, 'index.html'), smoke: resolve(web, 'smoke.html') } },
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
})
