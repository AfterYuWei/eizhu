import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { CliAgentHost } from './ai-cli.ts'

// Protocol peers are synthetic; the bundled MCP process and private IPC are real.
const peer = String.raw`#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
const args=process.argv.slice(2), kind=process.env.EIZHU_TEST_CLI_KIND
if(args[0]==='--version'){console.log('fixture 1');process.exit(0)}
if(args[0]==='mcp'){console.log('[]');process.exit(0)}
const send=v=>process.stdout.write(JSON.stringify(v)+'\n')
let mcp, bridge, native='fixture-session', pending=new Map(), next=0
if(kind==='codex'){
 const values={};for(let i=0;i<args.length;i++)if(args[i]==='-c'){const [k,...v]=args[++i].split('=');values[k]=JSON.parse(v.join('='))}
 if(values['features.shell_tool']!==false||values['features.apps']!==false||values.web_search!=='disabled')throw Error('unsafe config')
 mcp={command:values['mcp_servers.eizhu.command'],args:values['mcp_servers.eizhu.args'],env:{}}
 for(const [k,v] of Object.entries(values))if(k.startsWith('mcp_servers.eizhu.env.'))mcp.env[k.slice(22)]=v
}else if(kind==='claude'){
 if(!args.includes('--bare')||args[args.indexOf('--setting-sources')+1]!==''||JSON.parse(args[args.indexOf('--settings')+1]).disableAllHooks!==true||args[args.indexOf('--tools')+1]!==''||!args.includes('--strict-mcp-config')||args[args.indexOf('--permission-mode')+1]!=='dontAsk')throw Error('unsafe config')
 mcp=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.eizhu
}else{
 const yaml=await readFile(args[args.indexOf('--patch')+1],'utf8')
 if(!process.env.DSH_HOME.includes('deepseek-home')||!yaml.includes('- id: sessions\n  config:'))throw Error('unisolated config')
 for(const id of ['tool-fs','tool-working-directory','persistent-bash','persistent-pwsh'])if(!yaml.includes('- id: '+id+'\n  disabled: true'))throw Error('unsafe config')
 mcp={};for(const key of ['command','args','env'])mcp[key]=JSON.parse(yaml.match(new RegExp('        '+key+': (.+)'))[1])
}
async function tools(){
 bridge=spawn(mcp.command,mcp.args,{env:{...process.env,...mcp.env},stdio:['pipe','pipe','ignore']})
 createInterface({input:bridge.stdout}).on('line',line=>{const f=JSON.parse(line);if(f.id)pending.get(f.id)?.(f.result)})
 const request=(method,params)=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})
 await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fixture',version:'1'}})
 bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n')
 const listed=await request('tools/list',{});if(listed.tools.length!==15)throw Error('catalog mismatch')
 const result=await request('tools/call',{name:'session_info',arguments:{}})
 if(result.isError)throw Error('MCP failed')
 return result
}
createInterface({input:process.stdin}).on('line',async line=>{
 const f=JSON.parse(line)
 if(kind==='claude'){
  await tools();send({type:'system',session_id:native});send({type:'result',result:'完成',is_error:false});return
 }
 if(f.method==='initialize')send({id:f.id,result:kind==='deepseek'?{serverInfo:{name:'deepseek-harness-sdk-runtime'}}:{}})
 else if(f.method==='thread/start'||f.method==='thread/resume')send({id:f.id,result:{thread:{id:native}}})
 else if(f.method==='turn/start'){
  send({id:f.id,result:{}});await tools();send({method:'item/agentMessage/delta',params:{delta:'完成'}});send({method:'turn/completed',params:{turn:{status:'completed'}}})
 }else if(f.method==='session/prompt'){
  native=f.params.sessionId;send({id:f.id,result:{}})
 }else if(f.method==='session/wait'){
  await tools();send({method:'session.event',params:{sessionId:native,event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'完成'}]}}}}});send({id:f.id,result:{}})
 }else if(f.id)send({id:f.id,result:{}})
})
`

for (const kind of ['codex', 'claude', 'deepseek'] as const) {
  test(`${kind}: isolated native configuration, real stdio MCP and shared tool dispatch`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'eizhu-cli-test-'))
    const path = join(root, 'cli.mjs')
    const host = new CliAgentHost(root, root)
    const old = process.env.EIZHU_TEST_CLI_KIND
    process.env.EIZHU_TEST_CLI_KIND = kind
    try {
      await writeFile(path, peer, { mode: 0o700 })
      await writeFile(
        join(root, 'ai-mcp.cjs'),
        'void import(' + JSON.stringify(resolve('apps/desktop/src/runtime/ai-mcp.ts')) + ')',
      )
      let text = '',
        calls = 0
      const result = await host.run(
        { conversationId: randomUUID(), cli: { kind, path, model: 'fixture' }, prompt: 'test' },
        AbortSignal.timeout(15000),
        (value) => {
          text = value
        },
        async (name, args) => {
          assert.equal(name, 'session_info')
          assert.deepEqual(args, {})
          calls++
          return { sessions: [] }
        },
      )
      assert.ok(result.nativeSession)
      assert.equal(text, '完成')
      assert.equal(calls, 1)
    } finally {
      if (old === undefined) delete process.env.EIZHU_TEST_CLI_KIND
      else process.env.EIZHU_TEST_CLI_KIND = old
      await host.close()
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('CLI availability rejects missing programs and versions without required driver flags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eizhu-cli-status-'))
  const host = new CliAgentHost(root, root)
  const previousPath = process.env.PATH
  process.env.PATH = root
  try {
    const path = join(root, 'codex')
    const script = (help: string) =>
      '#!' +
      process.execPath +
      '\nconsole.log(process.argv.includes("--version") ? "fixture 1" : ' +
      JSON.stringify(help) +
      ')\n'
    await writeFile(path, script('old CLI'), { mode: 0o700 })
    let statuses = await host.status([])
    assert.ok(statuses.every((s) => !s.available))
    assert.match(statuses.find((s) => s.kind === 'codex')!.message, /必需/)
    await writeFile(path, script('--listen'), { mode: 0o700 })
    statuses = await host.status([])
    assert.deepEqual(
      statuses.filter((s) => s.available).map((s) => s.kind),
      ['codex'],
    )
    assert.equal(statuses.find((s) => s.kind === 'claude')!.available, false)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await host.close()
    await rm(root, { recursive: true, force: true })
  }
})
