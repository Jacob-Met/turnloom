import test from 'node:test';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server.mjs';

test('four participants preserve original topic and exact owner-approved revision',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'turnloom-lifecycle-'));
 const srv=await startServer({port:0,dataDir:dir});
 const req=async(path,token,body)=>{const res=await fetch(srv.url+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:res.status,data:await res.json()};};
 const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.data;};
 const command=(token,c)=>req('/api/commands',token,{command:c});
 try{
  const demo=ok(await req('/api/demo',null,{}));
  const people=[];for(const i of demo.invitations)people.push(ok(await req('/api/join',null,{invitation:i.invitation,sessionToken:randomBytes(32).toString('base64url')})));
  assert.equal(people.length,4);
  const [aac,second,third,fourth]=people;
  const reservation=async()=>ok(await req('/api/session',aac.token)).privateReservations.find(r=>r.id==='slow-question');
  const bind=r=>({id:r.id,expectedRevision:r.revision,expectedDraftVersion:r.draftVersion});
  ok(await command(aac.token,{type:'reservation.create',id:'slow-question',anchorId:'a1',intent:'question'}));
  let r=await reservation();
  ok(await command(aac.token,{type:'draft.update',id:r.id,expectedRevision:r.revision,text:'Private earlier wording'}));
  r=await reservation();
  ok(await command(aac.token,{type:'reservation.ready',...bind(r)}));
  const approved=await reservation();
  ok(await command(second.token,{type:'topic.activate',id:'timing'}));
  ok(await command(third.token,{type:'anchor.create',id:'later-timing',topicId:'timing',statement:'We can discuss timing while the question stays open.'}));
  ok(await command(fourth.token,{type:'topic.activate',id:'books'}));
  assert.equal((await reservation()).revision,approved.revision,'other discussion must not revoke readiness');
  assert.equal((await command(second.token,{type:'reservation.return',...bind(approved)})).data.error.code,'FORBIDDEN','another participant cannot return owner draft');
  ok(await command(aac.token,{type:'draft.update',id:approved.id,expectedRevision:approved.revision,text:'Does the original place have step-free access?'}));
  for(const type of ['reservation.ready','reservation.return','reservation.share'])assert.ok((await command(aac.token,{type,...bind(approved)})).status>=400,`stale ${type} accepted`);
  r=await reservation();
  assert.ok((await command(aac.token,{type:'reservation.share',...bind(r)})).status>=400,'edited draft must require new approval');
  ok(await command(aac.token,{type:'reservation.ready',...bind(r)}));
  r=await reservation();ok(await command(aac.token,{type:'reservation.return',...bind(r)}));
  r=await reservation();ok(await command(aac.token,{type:'reservation.share',...bind(r)}));
  assert.ok((await command(aac.token,{type:'reservation.share',...bind(r)})).status>=400,'share cannot replay');
  const pub=ok(await req('/api/room',fourth.token));
  const contributions=pub.anchors.filter(a=>a.statement==='Does the original place have step-free access?');
  assert.equal(contributions.length,1);assert.equal(contributions[0].replyTo,'a1');
  assert.ok(!JSON.stringify(pub).includes('Private earlier wording'));
  ok(await command(aac.token,{type:'reservation.create',id:'withdraw-check',anchorId:'a1',intent:'preparing'}));
  let wr=ok(await req('/api/session',aac.token)).privateReservations.find(x=>x.id==='withdraw-check');
  ok(await command(aac.token,{type:'reservation.withdraw',id:wr.id,expectedRevision:wr.revision}));
  wr=ok(await req('/api/session',aac.token)).privateReservations.find(x=>x.id==='withdraw-check');
  for(const type of ['reservation.ready','reservation.return','reservation.share','draft.update']) { const payload=type==='draft.update'?{type,id:wr.id,expectedRevision:wr.revision,text:'revival forbidden'}:{type,...bind(wr)}; const rejected=await command(aac.token,payload); assert.equal(rejected.data.error.code,'TERMINAL_STATE',`withdrawn revived by ${type}`); }
 }finally{await srv.close();await rm(dir,{recursive:true,force:true});}
});
