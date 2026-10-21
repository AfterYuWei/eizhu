import { StrictMode } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { MainWindowReady } from '@/components/MainWindowReady'
import { bridge,desktopBootstrap } from '@/lib/bridge'
import { initializePlatform } from '@/lib/platform'
import { initializeSettingsStorage } from '@/lib/settingsStorage'
import { installFrontendLogging } from '@/lib/appLog'
import './index.css'
import '@xterm/xterm/css/xterm.css'

let appRoot: Root | null = null
async function bootstrap() {
  try {
    await initializePlatform()
    initializeSettingsStorage()
    installFrontendLogging()
    const isEditor = desktopBootstrap()?.window === 'editor'
    const { default: App } = isEditor ? await import('@/components/Editor/EditorWindowApp') : await import('./App')
    window.addEventListener('eizhu:settings-updated', () => {
      void import('@/store/settings').then(async ({ useSettingsStore, initTheme }) => {
        await useSettingsStore.persist.rehydrate()
        initTheme()
      })
    })
    appRoot = createRoot(document.getElementById('root')!)
    // A hidden window may pause animation frames and timers. Signal readiness at the DOM commit.
    appRoot.render(<StrictMode><App />{!isEditor && <MainWindowReady />}</StrictMode>)
  } catch (error) {
    renderFatal(error instanceof Error ? error.message : String(error))
    if (window.eizhu) await bridge().app.ready().catch(() => undefined)
  }
}

/** 初始化失败的兜底界面。 */
function renderFatal(message: string) {
  appRoot?.unmount()
  appRoot = null

  const root = document.getElementById('root')!
  const shell = document.createElement('div')
  shell.style.cssText = 'min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0A0A;color:#e5e5e5;font-family:system-ui,sans-serif;padding:24px;'
  const content = document.createElement('div')
  content.style.cssText = 'max-width:560px;'
  const title = document.createElement('h2')
  title.style.cssText = 'margin:0 0 12px;font-size:18px;'
  title.textContent = 'eizhu 运行失败'
  const detail = document.createElement('p')
  detail.style.cssText = 'margin:0 0 16px;color:#a3a3a3;font-size:13px;line-height:1.7;'
  detail.textContent = message
  const hint = document.createElement('p')
  hint.style.cssText = 'margin:0;color:#737373;font-size:12px;'
  hint.textContent = '可重新启动应用重试；若持续失败，请查看设置中的诊断日志。'
  content.append(title, detail, hint)
  shell.append(content)
  root.replaceChildren(shell)
}

void bootstrap()
