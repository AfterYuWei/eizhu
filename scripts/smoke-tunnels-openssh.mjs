import assert from 'node:assert/strict'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir, userInfo, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { TunnelListener } from '../packages/core/src/ssh/tunnel.ts'
import { proxyHandshake } from '../packages/core/src/ssh/network.ts'
const require = createRequire(import.meta.url)
const { Client, utils } = require('ssh2')
const reportPath = join('artifacts', 'port-mapping', `${process.platform}-${process.arch}-openssh.json`)
await mkdir(join('artifacts', 'port-mapping'), {recursive:true})
await rm(reportPath, {force:true})
const root = await mkdtemp(join(tmpdir(), 'eizhu-tunnel-openssh-'))
const resources = []
const results = []
let daemon
let stderr = ''
const listen = async (host='127.0.0.1') => {
  const server = net.createServer()
  server.listen(0, host)
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(r=>server.close(r))
  return port
}
const connectSocket = async (host, port) => {
  const socket = net.connect({host, port})
  socket.setTimeout(5000,()=>socket.destroy(new Error('TCP timeout')))
  try { await once(socket,'connect'); return socket }
  catch(e) { socket.destroy(); throw e }
}
try {
  const hostKey = join(root,'host'), identity=join(root,'identity'), authorized=join(root,'authorized_keys')
  for (const path of [hostKey, identity]) execFileSync('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-f',path])
  await writeFile(authorized, await readFile(identity+'.pub'), {mode:0o600})
  const port=await listen()
  const config=join(root,'sshd_config')
  await writeFile(config,[`Port ${port}`,'ListenAddress 127.0.0.1',`HostKey ${hostKey}`,`PidFile ${join(root,'pid')}`,`AuthorizedKeysFile ${authorized}`,'StrictModes no','UsePAM no','PasswordAuthentication no','KbdInteractiveAuthentication no','PubkeyAuthentication yes','AllowTcpForwarding yes','GatewayPorts clientspecified','LogLevel ERROR',''].join('\n'))
  execFileSync('/usr/sbin/sshd',['-t','-f',config])
  daemon=spawn('/usr/sbin/sshd',['-D','-e','-f',config],{stdio:['ignore','ignore','pipe']})
  daemon.stderr.on('data',b=>{stderr+=b.toString()})
  let ready=false
  for(let i=0;i<60;i++){
    if(daemon.exitCode!==null) throw new Error('sshd exited: '+stderr)
    try{const s=await connectSocket('127.0.0.1',port);s.destroy();ready=true;break}catch{await new Promise(r=>setTimeout(r,50))}
  }
  assert.ok(ready,'sshd ready')
  const key=await readFile(identity)
  const fingerprint=createHash('sha256').update(utils.parseKey(await readFile(hostKey)).getPublicSSH()).digest('hex')
  const connect=async()=>{
    const c=new Client();resources.push(c)
    c.on('error',()=>{})
    c.connect({host:'127.0.0.1',port,username:userInfo().username,privateKey:key,hostHash:'sha256',hostVerifier:hash=>hash===fingerprint,readyTimeout:5000})
    await once(c,'ready');return c
  }
  const echo=net.createServer({allowHalfOpen:true},s=>{s.on('error',()=>{});s.pipe(s)})
  resources.push(echo);echo.listen(0,'127.0.0.1');await once(echo,'listening')
  const echoPort=echo.address().port
  for(const kind of ['local','remote','dynamic']) for(const bind_host of ['127.0.0.1','::1','localhost','0.0.0.0','::']) for(const fixed of [false,true]){
    const client=await connect()
    const bind_port=fixed?await listen(bind_host):0
    const listener=new TunnelListener(client,{id:'test',name:'test',profile_id:'test',kind,bind_host,bind_port,target_host:'127.0.0.1',target_port:echoPort},()=>{})
    resources.push(listener)
    const bound=await listener.start()
    assert.ok(bound>0)
    if(fixed)assert.equal(bound,bind_port)
    const family=bind_host==='::'?'IPv6':'IPv4'
    const external=Object.values(networkInterfaces()).flat().find(info=>info && info.family===family && !info.internal && !info.address.startsWith('fe80:'))
    const publicBind=bind_host==='0.0.0.0'||bind_host==='::'
    const probeHost=publicBind?(external?.address??(bind_host==='::'?'::1':'127.0.0.1')):bind_host
    const socket=await connectSocket(probeHost,bound)
    try{
      if(kind==='dynamic'){await proxyHandshake(socket,'socks5','localhost',echoPort);socket.resume()}
      const response=once(socket,'data');socket.write('openssh-'+kind)
      assert.equal((await response)[0].toString(),'openssh-'+kind)
    }finally{socket.destroy()}
    await listener.close();await listener.close()
    await assert.rejects(connectSocket(probeHost,bound))
    client.end()
    results.push({kind,bind_host,fixed,publicBind,interfaceProbe:publicBind&&!!external,echo:true,portReleased:true,idempotentStop:true})
  }
  const report={passed:true,transport:'installed OpenSSH sshd + production TunnelListener',gatewayPorts:'clientspecified',cases:results}
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({passed:true,cases:results.length,report:reportPath}))
}catch(error){console.error(error.message);if(stderr)console.error(stderr);process.exitCode=1}
finally{
  for(const r of resources.reverse()){
    if(r instanceof TunnelListener)await r.close().catch(()=>{})
    else if(r instanceof net.Server)await new Promise(resolve=>r.close(resolve))
    else r.end()
  }
  if(daemon && daemon.exitCode===null){daemon.kill();await once(daemon,'exit')}
  await rm(root,{recursive:true,force:true})
}
