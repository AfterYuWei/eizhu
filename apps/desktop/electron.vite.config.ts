import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const desktop = resolve(root, 'apps/desktop')
const web = resolve(root, 'apps/web')
const internal = { '@eizhu/contracts': resolve(root, 'packages/contracts/src/index.ts') }
const external = ['electron', 'better-sqlite3', 'argon2', 'electron-updater', 'ssh2']
const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim()
const channel = process.env.EIZHU_CHANNEL === 'stable' ? 'stable' : 'test'
export default defineConfig({
  main: {
    define: { __EIZHU_VERSION__: JSON.stringify(version), __EIZHU_CHANNEL__: JSON.stringify(channel) },
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
