import assert from 'node:assert/strict'
import net from 'node:net'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { TunnelConfig, TunnelStatus } from '@eizhu/contracts/models/api'
import { proxyHandshake } from '@eizhu/core/ssh/network'

/** Actual renderer + preload/main/runtime/SSH against the Stage 3 isolated loopback peers. */
export async function verifyPortMapping(window: BrowserWindow, root: string, profileId: string, echoPort: number) {
  const js = <T = unknown>(source: string): Promise<T> => window.webContents.executeJavaScript(source)
  const wait = async (source: string) => {
    for (let i = 0; i < 200; i++) {
      if (await js<boolean>(source)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Port mapping UI timeout: ${source}`)
  }
  const originalSize = window.getContentSize()
  const originalMinimum = window.getMinimumSize()
  const original = await js<{ theme: string; font: string }>(`({theme:document.documentElement.className,font:document.documentElement.style.getPropertyValue('--sans-size')})`)
  const configs = (await js<TunnelConfig[]>('window.eizhu.tunnel.list()')).filter((c) => c.profile_id === profileId)
  assert.equal(configs.length, 3)
  const screenshots: string[] = []
  const relayChecks: Array<{ kind: string; aligned: boolean; downward: boolean; nodePause: boolean; singlePacket: boolean; branchOrder: number[]; branchEndErrors: number[] }> = []
  let created: string | undefined
  const open = async () => {
    await js(`document.querySelector('.shell-primary-nav [aria-controls="workspace-port-mapping"]').click()`)
    await wait(`!!document.querySelector('.port-mapping-view')&&document.querySelector('.pm-content')?.getAttribute('aria-busy')==='false'`)
  }
  const capture = async (name: string, theme: string) => {
    await js(`(async()=>{document.activeElement?.blur();document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(${JSON.stringify(theme)});await document.fonts.ready;await new Promise(resolve=>setTimeout(resolve,200))})()`)
    await writeFile(join(root, name), (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG())
    screenshots.push(name)
  }
  const choose = async (field: string, label: string) => {
    await js(`document.querySelector('[data-field="${field}"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',bubbles:true}))`)
    await wait(`!!document.querySelector('[role="option"]')`)
    await js(`[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).click()`)
    await wait(`!document.querySelector('[role="option"]')`)
  }
  const chooseTarget = async (label: string) => {
    await js(`document.querySelector('.pm-address-trigger').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',bubbles:true}))`)
    await wait(`!!document.querySelector('.pm-address-options [role="menuitem"]')`)
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.pm-address-options [role="menuitem"]'),el=>el.textContent).slice(0,3)`), ['127.0.0.1', '::1', 'localhost'])
    await js(`[...document.querySelectorAll('.pm-address-options [role="menuitem"]')].find(el=>el.textContent===${JSON.stringify(label)}).click()`)
    await wait(`!document.querySelector('.pm-address-options [role="menuitem"]')&&document.activeElement?.getAttribute('data-field')==='target_host'`)
    assert.equal(await js(`document.querySelector('[data-field="target_host"]').value`), label)
  }
  const verifyRelay = async () => {
    window.webContents.debugger.attach('1.3')
    try {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      const checks = await js<(typeof relayChecks)[number]>(`(()=>{
        const flow=document.querySelector('.pm-flow'),kind=flow.dataset.mappingFlow;
        const icons=[...flow.querySelectorAll('[data-flow-step] .pm-flow-icon')];
        const centers=icons.map(icon=>({x:icon.x.baseVal.value+icon.width.baseVal.value/2,y:icon.y.baseVal.value+icon.height.baseVal.value/2}));
        const aligned=centers.length===3&&centers.every(center=>Math.abs(center.x-centers[0].x)<.01);
        const downward=centers.length===3&&centers[0].y<centers[1].y&&centers[1].y<centers[2].y;
        const packets=[...flow.querySelectorAll('.pm-flow-packet')],animations=packets.map(packet=>packet.getAnimations()[0]);
        if(animations.some(animation=>!animation))throw new Error('Relay animation is missing');
        const clocks=animations.map(animation=>animation.currentTime);
        const sample=time=>{animations.forEach(animation=>{animation.pause();animation.currentTime=time});return packets.map(packet=>({opacity:Number(getComputedStyle(packet).opacity),offset:Number.parseFloat(getComputedStyle(packet).strokeDashoffset)}))};
        try {
          const pauseA=sample(2100)[0].offset,pauseB=sample(2400)[0].offset;
          const nodePause=Math.abs(pauseA+102)<.1&&Math.abs(pauseB+102)<.1;
          const branchOrder=[],times=kind==='dynamic'?[1000,5800,10600]:[1000,3000];
          let singlePacket=true;
          for(const time of times){const active=sample(time).map((state,index)=>state.opacity>.5?index:-1).filter(index=>index>=0);singlePacket&&=active.length===1;if(kind==='dynamic')branchOrder.push(active[0])}
          const branchEndErrors=kind==='dynamic'?packets.map((packet,index)=>Math.abs(sample(index*4800+4515)[index].offset+packet.getTotalLength())):[];
          singlePacket&&=branchEndErrors.every(error=>error<.1);
          const idle=sample(kind==='dynamic'?4700:4400).every(state=>state.opacity===0);
          return {kind,aligned,downward,nodePause,singlePacket:singlePacket&&idle,branchOrder,branchEndErrors};
        } finally {animations.forEach((animation,index)=>{animation.currentTime=clocks[index];animation.play()})}
      })()`)
      assert.ok(checks.aligned && checks.downward && checks.nodePause && checks.singlePacket, JSON.stringify(checks))
      if (checks.kind === 'dynamic') assert.deepEqual(checks.branchOrder, [0, 1, 2])
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      assert.equal(await js(`Array.from(document.querySelectorAll('.pm-flow-packet')).every(packet=>getComputedStyle(packet).animationName==='none'&&getComputedStyle(packet).display==='none')&&document.querySelectorAll('.pm-flow-track').length>=2`), true)
      relayChecks.push(checks)
    } finally {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
      window.webContents.debugger.detach()
    }
  }
  const verifyEcho = async (kind: TunnelConfig['kind'], port: number) => {
    const socket = net.connect(port, '127.0.0.1')
    try {
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
      if (kind === 'dynamic') { await proxyHandshake(socket, 'socks5', 'localhost', echoPort); socket.resume() }
      const echoed = new Promise<string>((resolve, reject) => {
        socket.setTimeout(5000, () => reject(new Error('Port mapping echo timeout')))
        socket.once('data', (b) => resolve(b.toString()))
        socket.once('error', reject)
      })
      socket.write('port-mapping-' + kind)
      assert.equal(await echoed, 'port-mapping-' + kind)
    } finally { socket.destroy() }
  }
  try {
    window.setContentSize(1280, 800)
    await open(); await open()
    assert.equal(await js(`document.querySelectorAll('#workspace-port-mapping').length`), 1)
    assert.equal(await js(`document.querySelectorAll('#workspace-tab-port-mapping').length`), 0)
    assert.equal(await js(`document.querySelectorAll('.shell-tab-list [aria-selected="true"]').length`), 0)
    for (const config of configs) {
      await js(`document.querySelector('[data-mapping-id="${config.id}"] .pm-rule-actions button').click()`)
      await wait(`window.eizhu.tunnel.statuses().then(rows=>rows.find(r=>r.id==='${config.id}')?.status==='running')`)
      const state = (await js<TunnelStatus[]>('window.eizhu.tunnel.statuses()')).find((r) => r.id === config.id)!
      assert.ok(state.bound_port)
      await verifyEcho(config.kind, state.bound_port)
      await wait(`document.querySelector('[data-mapping-id="${config.id}"] .pm-status')?.textContent==='运行中'`)
      assert.equal(await js(`document.querySelector('[data-mapping-id="${config.id}"] [aria-label^="编辑"]').disabled`), true)
    }
    const first = configs[0]
    await js(`document.querySelector('[data-mapping-id="${first.id}"] [aria-label^="复制"]').click()`)
    const firstState = (await js<TunnelStatus[]>('window.eizhu.tunnel.statuses()')).find((r) => r.id === first.id)!
    await wait(`window.eizhu.clipboard.read().then(text=>text==='127.0.0.1:${firstState.bound_port}')`)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'w',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`)
    assert.equal(await js(`!document.querySelector('#workspace-port-mapping').hidden`), true)
    await js(`window.__portMappingSmokePage=document.querySelector('.port-mapping-view');document.querySelector('.shell-primary-nav [aria-controls="workspace-vault"]').click()`)
    await wait(`document.querySelector('#workspace-port-mapping').hidden`)
    assert.equal((await js<TunnelStatus[]>('window.eizhu.tunnel.statuses()')).filter((r) => configs.some((c) => c.id === r.id) && r.status === 'running').length, 3)
    await open()
    assert.equal(await js(`document.querySelector('.port-mapping-view')===window.__portMappingSmokePage`), true)
    await capture('port-mapping-light.png', 'light')
    await capture('port-mapping-dark.png', 'dark')
    window.setContentSize(900, 650)
    await js(`document.documentElement.style.setProperty('--sans-size','20px')`)
    await wait(`innerWidth===900`)
    await capture('port-mapping-large-narrow.png', 'light')
    assert.equal(await js(`(()=>{const view=document.querySelector('.port-mapping-view'),content=view.querySelector('.pm-content');return view.scrollWidth<=view.clientWidth+1&&content.scrollWidth<=content.clientWidth+1})()`), true)

    window.setContentSize(1280, 800)
    await js(`document.documentElement.style.setProperty('--sans-size','14px');document.querySelector('.pm-create').click()`)
    await wait(`!!document.querySelector('.port-mapping-form')`)
    await js(`document.querySelector('.port-mapping-form').requestSubmit()`)
    await wait(`document.activeElement?.getAttribute('data-field')==='name'`)
    await js(`(()=>{for(const [field,value] of Object.entries({name:'页面验收映射',bind_port:'0',target_port:'${echoPort}'})){const input=document.querySelector('[data-field="'+field+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))}})()`)
    await js(`document.querySelector('[data-field="profile_id"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',bubbles:true}))`)
    await wait(`!!document.querySelector('[role="option"]')`)
    // Fixture profiles share names; pick the option with this exact profile's list ordinal.
    const profileIndex = await js<number>(`window.eizhu.profile.list({groupId:null,search:null}).then(rows=>rows.findIndex(p=>p.id==='${profileId}'))`)
    assert.ok(profileIndex >= 0)
    await js(`document.querySelectorAll('[role="option"]')[${profileIndex}].click()`)
    await wait(`!document.querySelector('[role="option"]')`)
    assert.equal(await js(`(()=>{const input=document.querySelector('[data-field="name"]'),label=document.querySelector('.pm-field label');return getComputedStyle(input).fontSize==='14px'&&getComputedStyle(label).fontSize==='14px'&&input.getBoundingClientRect().height===30})()`), true)
    assert.equal(await js(`(()=>{const form=document.querySelector('.pm-editor-grid'),flow=document.querySelector('.pm-flow'),fields=form.querySelector('fieldset');return flow.getBoundingClientRect().left>=fields.getBoundingClientRect().right&&form.scrollWidth<=form.clientWidth+1})()`), true)
    assert.equal(await js(`document.querySelector('.pm-flow').dataset.mappingFlow==='local'&&document.querySelector('.pm-flow svg[role="img"]').getAttribute('aria-label').includes('本机监听 → SSH → 远端目标')`), true)
    await verifyRelay()
    await chooseTarget('localhost')
    await chooseTarget('127.0.0.1')
    await capture('port-mapping-form.png', 'light')
    const flowBounds = await js<{ x: number; y: number; width: number; height: number }>(`(()=>{const r=document.querySelector('.pm-flow').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.right)-Math.floor(r.x),height:Math.ceil(r.bottom)-Math.floor(r.y)}})()`)
    await writeFile(join(root, 'port-mapping-flow-detail.png'), (await window.webContents.capturePage(flowBounds, { stayAwake: true })).toPNG())
    screenshots.push('port-mapping-flow-detail.png')
    await capture('port-mapping-form-dark.png', 'dark')
    await choose('bind_host', '0.0.0.0')
    await choose('kind', '远端映射')
    assert.equal(await js(`document.querySelector('[data-field="bind_host"]').textContent.includes('127.0.0.1')&&document.querySelector('[data-field="bind_port"]').value===''&&document.querySelector('[data-field="target_port"]').value===''&&!document.querySelector('.pm-public-warning[role="note"]')`), true)
    await choose('bind_host', '0.0.0.0')
    await chooseTarget('::1')
    assert.equal(await js(`document.querySelector('.pm-flow svg[role="img"]').getAttribute('aria-label').includes('服务器监听 → SSH → 本机侧目标')&&document.querySelector('.pm-flow svg[role="img"]').getAttribute('aria-label').includes('目标 [::1]:端口')`), true)
    await verifyRelay()
    await js(`(()=>{for(const [field,value] of Object.entries({bind_port:'0',target_host:'remote-draft.example.invalid',target_port:'3000'})){const input=document.querySelector('[data-field="'+field+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))}})()`)
    await choose('kind', '本地映射')
    assert.equal(await js(`document.querySelector('[data-field="bind_host"]').textContent.includes('0.0.0.0')&&document.querySelector('[data-field="target_host"]').value==='127.0.0.1'&&document.querySelector('[data-field="target_port"]').value==='${echoPort}'`), true)
    await choose('kind', '动态代理')
    assert.equal(await js(`!document.querySelector('[data-field="target_host"]')&&document.querySelector('[data-field="bind_host"]').textContent.includes('127.0.0.1')&&document.querySelector('[data-field="bind_port"]').value===''`), true)
    await choose('bind_host', '::')
    await capture('port-mapping-dynamic-flow.png', 'light')
    assert.equal(await js(`document.querySelector('.pm-flow').dataset.mappingFlow==='dynamic'&&document.querySelectorAll('.pm-flow-targets .pm-flow-node').length===3&&!document.querySelector('[data-field="target_host"]')`), true)
    await verifyRelay()
    await choose('kind', '远端映射')
    assert.equal(await js(`document.querySelector('[data-field="bind_host"]').textContent.includes('0.0.0.0')&&document.querySelector('[data-field="target_host"]').value==='remote-draft.example.invalid'&&document.querySelector('[data-field="target_port"]').value==='3000'`), true)
    await js(`(()=>{for(const [field,value] of Object.entries({target_host:'127.0.0.1',target_port:'${echoPort}'})){const input=document.querySelector('[data-field="'+field+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))}})()`)
    await wait(`!!document.querySelector('.port-mapping-form .pm-public-warning')&&!document.querySelector('[role="option"]')`)
    await capture('port-mapping-public-form.png', 'light')
    await capture('port-mapping-remote-listener.png', 'light')
    // Product windows normally stop at 900px; temporarily permit a smaller
    // isolated smoke viewport to exercise the stacked responsive layout.
    window.setMinimumSize(600, 500)
    window.setContentSize(680, 650)
    await js(`document.documentElement.style.setProperty('--sans-size','20px')`)
    await wait(`innerWidth===680`)
    await capture('port-mapping-form-large-narrow.png', 'light')
    const narrow = await js<{ stacked: boolean; width: number; scrollWidth: number; height: number; scrollHeight: number; font: string }>(`(()=>{const grid=document.querySelector('.pm-editor-grid'),flow=document.querySelector('.pm-flow'),fields=grid.querySelector('fieldset'),input=document.querySelector('[data-field="name"]');return {stacked:flow.getBoundingClientRect().top>=fields.getBoundingClientRect().bottom,width:grid.clientWidth,scrollWidth:grid.scrollWidth,height:grid.clientHeight,scrollHeight:grid.scrollHeight,font:getComputedStyle(input).fontSize}})()`)
    assert.equal(narrow.stacked, true, JSON.stringify(narrow))
    assert.ok(narrow.scrollWidth <= narrow.width + 1, JSON.stringify(narrow))
    assert.equal(narrow.font, '20px', JSON.stringify(narrow))
    assert.ok(narrow.scrollHeight > narrow.height, JSON.stringify(narrow))
    await js(`document.querySelector('.pm-editor-grid').scrollTop=document.querySelector('.pm-editor-grid').scrollHeight`)
    assert.equal(await js(`(()=>{const flow=document.querySelector('.pm-flow').getBoundingClientRect(),footer=document.querySelector('.pm-dialog-actions').getBoundingClientRect();return flow.bottom<=footer.top+1&&footer.bottom<=innerHeight})()`), true)
    await capture('port-mapping-form-narrow-flow.png', 'light')
    window.setContentSize(1280, 800)
    window.setMinimumSize(originalMinimum[0], originalMinimum[1])
    await js(`document.documentElement.style.setProperty('--sans-size','14px')`)
    await wait(`innerWidth===1280`)
    await js(`document.querySelector('.port-mapping-form').requestSubmit()`)
    await wait(`!document.querySelector('.port-mapping-form')&&[...document.querySelectorAll('.pm-rule h2')].some(el=>el.textContent==='页面验收映射')`)
    created = (await js<TunnelConfig[]>('window.eizhu.tunnel.list()')).find((c) => c.name === '页面验收映射')!.id
    const saved = (await js<TunnelConfig[]>('window.eizhu.tunnel.list()')).find((c) => c.id === created)!
    assert.equal(saved.kind, 'remote')
    assert.equal(saved.bind_host, '0.0.0.0')
    assert.equal((await js<TunnelStatus[]>('window.eizhu.tunnel.statuses()')).find((r) => r.id === created)!.status, 'stopped')
    assert.equal(await js(`window.eizhu.tunnel.start({id:'${created}'}).then(()=>false,e=>e.code==='TUNNEL_PUBLIC_CONFIRM_REQUIRED')`), true)
    await js(`document.querySelector('[data-mapping-id="${created}"] [aria-label^="启动"]').click()`)
    await wait(`!!document.querySelector('.pm-public-confirm[role="alertdialog"]')`)
    await capture('port-mapping-public-confirm.png', 'light')
    assert.equal((await js<TunnelStatus[]>('window.eizhu.tunnel.statuses()')).find((r) => r.id === created)!.status, 'stopped')
    await js(`document.querySelector('.pm-public-confirm [data-slot="alert-dialog-cancel"]').click()`)
    await wait(`!document.querySelector('.pm-public-confirm[role="alertdialog"]')`)
    await js(`document.querySelector('[data-mapping-id="${created}"] [aria-label^="启动"]').click()`)
    await wait(`!!document.querySelector('.pm-public-confirm[role="alertdialog"]')`)
    await js(`document.querySelector('.pm-public-confirm [data-slot="alert-dialog-action"]').click()`)
    await wait(`document.querySelector('[data-mapping-id="${created}"] .pm-status')?.textContent==='运行中'`)
    const publicState = (await js<TunnelStatus[]>('window.eizhu.tunnel.statuses()')).find((r) => r.id === created)!
    assert.ok(publicState.bound_port)
    await verifyEcho('remote', publicState.bound_port)
    await js(`document.querySelector('[data-mapping-id="${created}"] [aria-label^="停止"]').click()`)
    await wait(`document.querySelector('[data-mapping-id="${created}"] .pm-status')?.textContent==='已停止'`)
    assert.equal(await js(`window.eizhu.tunnel.start({id:'${created}'}).then(()=>false,e=>e.code==='TUNNEL_PUBLIC_CONFIRM_REQUIRED')`), true)
    assert.equal(await js(`(async()=>{const config=(await window.eizhu.tunnel.list()).find(c=>c.id==='${created}');return window.eizhu.tunnel.start({id:config.id,confirmedConfig:{...config,target_port:config.target_port===65535?1:config.target_port+1}}).then(()=>false,e=>e.code==='TUNNEL_CONFIG_CHANGED')})()`), true)
    await js(`document.querySelector('[data-mapping-id="${created}"] [aria-label^="启动"]').click()`)
    await wait(`!!document.querySelector('.pm-public-confirm[role="alertdialog"]')`)
    await js(`document.querySelector('.pm-public-confirm [data-slot="alert-dialog-cancel"]').click()`)
    await wait(`!document.querySelector('.pm-public-confirm[role="alertdialog"]')`)
    await js(`document.querySelector('[data-mapping-id="${created}"] [aria-label^="删除"]').click()`)
    await wait(`!!document.querySelector('[role="dialog"]')`)
    await js(`[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent==='确认删除').click()`)
    await wait(`!document.querySelector('[data-mapping-id="${created}"]')&&!document.querySelector('[role="dialog"]')`)
    created = undefined
    for (const config of configs) {
      await js(`document.querySelector('[data-mapping-id="${config.id}"] .pm-rule-actions button').click()`)
      await wait(`document.querySelector('[data-mapping-id="${config.id}"] .pm-status')?.textContent==='已停止'`)
    }
    return { passed: true, syntheticSsh: true, modes: ['local', 'remote', 'dynamic'], rendererToTcp: true, singletonPage: true, independentLifecycle: true, actualPortClipboard: true, formValidation: true, saveOnly: true, delete: true, responsive: true, publicConfirmation: true, publicUnconfirmedRejected: true, stalePublicConfirmationRejected: true, publicRestartRequiresConfirmation: true, independentModeDrafts: true, remotePublicListener: true, selectableTarget: true, nativeFormFont: true, reactiveFlowPreview: true, reducedMotion: true, relayChecks, screenshots }
  } finally {
    for (const config of configs) await js(`window.eizhu.tunnel.stop({id:'${config.id}'})`)
    if (created) await js(`window.eizhu.tunnel.delete({id:'${created}'})`)
    await js(`document.querySelector('.shell-tab-list [role="tab"]')?.click();delete window.__portMappingSmokePage;document.documentElement.className=${JSON.stringify(original.theme)};document.documentElement.style.setProperty('--sans-size',${JSON.stringify(original.font)});window.eizhu.clipboard.write({text:''})`)
    window.setContentSize(originalSize[0], originalSize[1])
    window.setMinimumSize(originalMinimum[0], originalMinimum[1])
  }
}
