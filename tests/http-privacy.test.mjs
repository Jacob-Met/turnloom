import test from 'node:test';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server.mjs';

test('HTTP identity, private draft isolation, and durable one-time invitations', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'turnloom-http-'));
 let srv=await startServer({port:0,dataDir:dir});
 const req=async(path,{method='GET',body,token}={})=>{
  const r=await fetch(srv.url+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json()};
 };
 const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.data;};
 try{
  const demo=ok(await req('/api/demo',{method:'POST',body:{}}));
  assert.equal(demo.invitations.length,4);
  const a=ok(await req('/api/join',{method:'POST',body:{invitation:demo.invitations[0].invitation,sessionToken:randomBytes(32).toString('base64url')}}));
  const b=ok(await req('/api/join',{method:'POST',body:{invitation:demo.invitations[1].invitation,sessionToken:randomBytes(32).toString('base64url')}}));
  assert.ok((await req('/api/join',{method:'POST',body:{invitation:demo.invitations[0].invitation,sessionToken:randomBytes(32).toString('base64url')}})).status>=400);
  assert.ok((await req('/api/session')).status>=400);
  assert.ok((await req('/api/session',{token:'invalid-bearer'})).status>=400);
  const cmd=async(command)=>req('/api/commands',{method:'POST',token:a.token,body:{command}});
  for(const key of ['actorId','ownerId','speakerId']){
   const spoof=await cmd({type:'anchor.create',statement:'SPOOF-MUST-NOT-EXIST',topicId:'place',[key]:demo.invitations[1].participantId});
   assert.ok(spoof.status>=400,`spoof accepted: ${key}`);
  }
  ok(await cmd({type:'reservation.create',id:'privacy-r1',anchorId:'a1',intent:'question'}));
  let own=ok(await req('/api/session',{token:a.token}));
  let r=own.privateReservations.find(x=>x.id==='privacy-r1');assert.ok(r);
  const secret='PRIVATE-SENTINEL-9a10f8-do-not-publish';
  ok(await cmd({type:'draft.update',id:r.id,expectedRevision:r.revision,text:secret}));
  own=ok(await req('/api/session',{token:a.token}));
  assert.equal(own.privateReservations.find(x=>x.id===r.id).draft,secret);
  for(const path of ['/api/room','/api/export','/api/session']){
   const visible=JSON.stringify(ok(await req(path,{token:b.token})));
   for(const forbidden of [secret,a.token,b.token,...demo.invitations.map(x=>x.invitation)]) assert.ok(!visible.includes(forbidden),`leak at ${path}`);
   assert.ok(!visible.includes('SPOOF-MUST-NOT-EXIST'));
  }
  await srv.close();srv=await startServer({port:0,dataDir:dir});
  own=ok(await req('/api/session',{token:a.token}));
  assert.equal(own.privateReservations.find(x=>x.id===r.id).draft,secret);
  assert.ok((await req('/api/join',{method:'POST',body:{invitation:demo.invitations[0].invitation,sessionToken:randomBytes(32).toString('base64url')}})).status>=400);
  assert.ok(!JSON.stringify(ok(await req('/api/export',{token:b.token}))).includes(secret));
 }finally{await srv.close();await rm(dir,{recursive:true,force:true});}
});
