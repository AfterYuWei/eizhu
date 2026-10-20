import test from 'node:test'
import assert from 'node:assert/strict'
import { ssh, sessionMessageSchema } from '../ssh.ts'
test('SSH contract rejects arbitrary completion programs, unsafe listeners and invalid input',()=>{
  assert.equal(ssh['session.complete'].input.safeParse({id:'s',requestId:'r',script:'rm -rf /',generatorId:'paths',params:{}}).success,false)
  assert.equal(ssh['session.complete'].input.safeParse({id:'s',requestId:'r',generatorId:'kubectl-resources',params:{resource:'pods;reboot'}}).success,false)
  assert.equal(ssh['tunnel.save'].input.safeParse({config:{id:'',name:'t',profile_id:'p',kind:'local',bind_host:'0.0.0.0',bind_port:1,target_host:'localhost',target_port:2}}).success,false)
  assert.equal(ssh['history.record'].input.safeParse({profileId:'p',command:' password',cwd:'/'}).success,false)
  assert.equal(sessionMessageSchema.safeParse({type:'auth_request',payload:{request_id:'r',profile_id:'p',name:'认证',instructions:'',prompts:[{prompt:'密码',echo:false}]}}).success,true)
})
