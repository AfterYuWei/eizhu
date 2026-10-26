import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

/** Uses the controlled SFTP file already opened by stage 4, never user files. */
export async function verifyEditorLayout(editor: BrowserWindow, main: BrowserWindow, root: string) {
  const js = <T = unknown>(source: string): Promise<T> => editor.webContents.executeJavaScript(source)
  const wait = async (source: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js<boolean>(source)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const diagnostic = await js(`({theme:document.documentElement.className,editor:getComputedStyle(document.querySelector('.monaco-editor')).backgroundColor,body:getComputedStyle(document.querySelector('.editor-body')).backgroundColor,monacoToken:getComputedStyle(document.querySelector('.monaco-editor')).getPropertyValue('--vscode-editor-background'),surface:getComputedStyle(document.documentElement).getPropertyValue('--surface-workspace')})`)
    await writeFile(join(root, 'editor-layout-failed.png'), (await editor.webContents.capturePage(undefined, { stayAwake: true })).toPNG())
    throw new Error(`Editor layout timeout: ${source}; ${JSON.stringify(diagnostic)}`)
  }
  const originalSize = editor.getContentSize()
  const original = await js<string | null>(`window.eizhu.app.bootstrap().then(b=>b.settings['eizhu-settings']??null)`)
  const originalFont = await js<string>(`document.documentElement.style.getPropertyValue('--sans-size')`)
  const screenshots: string[] = []
  const geometry = () => js<{ height: number; draggable: boolean; actionsFit: boolean; nativeInset: number; genericBar: boolean; themed: boolean }>(`(()=>{
    const bar=document.querySelector('.editor-titlebar'),actions=document.querySelector('.editor-toolbar-right'),file=document.querySelector('.editor-toolbar-left');
    const a=actions.getBoundingClientRect(),b=bar.getBoundingClientRect(),f=file.getBoundingClientRect();
    return {height:b.height,draggable:getComputedStyle(bar).webkitAppRegion==='drag'&&getComputedStyle(actions).webkitAppRegion==='no-drag',
      actionsFit:a.right<=b.right&&a.left>=f.right&&a.top>=b.top&&a.bottom<=b.bottom,nativeInset:f.left,
      genericBar:!!document.querySelector('.eizhu-header'),themed:getComputedStyle(document.querySelector('.monaco-editor')).backgroundColor===getComputedStyle(document.querySelector('.editor-body')).backgroundColor};
  })()`)
  const capture = async (name: string) => {
    await js(`document.activeElement?.blur();document.fonts.ready.then(()=>new Promise(resolve=>setTimeout(resolve,250)))`)
    await writeFile(join(root, name), (await editor.webContents.capturePage(undefined, { stayAwake: true })).toPNG())
    screenshots.push(name)
  }
  try {
    if (process.platform === 'darwin') assert.deepEqual(editor.getWindowButtonPosition(), { x: 16, y: 24 })
    editor.setContentSize(1280, 800)
    const themes: Record<string, Awaited<ReturnType<typeof geometry>>> = {}
    for (const theme of ['light', 'dark']) {
      const value = JSON.stringify({ ...JSON.parse(original ?? '{}'), state: { ...JSON.parse(original ?? '{}').state, theme } })
      await main.webContents.executeJavaScript(`window.eizhu.settings.write(${JSON.stringify({ key: 'eizhu-settings', value })})`)
      await wait(`document.documentElement.classList.contains('${theme}')&&getComputedStyle(document.querySelector('.monaco-editor')).backgroundColor===getComputedStyle(document.querySelector('.editor-body')).backgroundColor`)
      const measured = await geometry()
      assert.ok(measured.height >= 64 && measured.draggable && measured.actionsFit && measured.themed && !measured.genericBar)
      if (process.platform === 'darwin') assert.ok(measured.nativeInset >= 88)
      themes[theme] = measured
      await capture(`editor-${theme}.png`)
    }
    editor.setContentSize(900, 650)
    await wait(`innerWidth===900`)
    await js(`document.documentElement.style.setProperty('--sans-size','22px')`)
    const narrow = await geometry()
    assert.ok(narrow.actionsFit && narrow.themed && narrow.draggable)
    await capture('editor-dark-narrow-large-font.png')
    assert.equal(await js(`!!document.querySelector('.editor-dirty-dot')&&document.querySelector('.view-lines').textContent.includes('未保存内容')`), true)
    return { passed: true, themes, narrow, unsavedContentRetained: true, screenshots }
  } finally {
    await js(`document.documentElement.style.setProperty('--sans-size',${JSON.stringify(originalFont)})`)
    await main.webContents.executeJavaScript(`window.eizhu.settings.write(${JSON.stringify({ key: 'eizhu-settings', value: original })})`)
    editor.setContentSize(originalSize[0], originalSize[1])
  }
}
