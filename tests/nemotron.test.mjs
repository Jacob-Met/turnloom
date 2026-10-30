import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNemotronClient,parseCue,NEMOTRON_MODEL} from '../src/nemotron.mjs';
import {startServer} from '../server.mjs';

const KEY='test-key-not-real-0123456789';
const SECRET='PRIVATE-DRAFT-SENTINEL-nemotron-test';
const CUE='Going back to Sam about the garden gate, now that we are talking about timing.';

function completion(content){
  return new Response(JSON.stringify({choices:[{message:{content,reasoning:'hidden'}}]}),{status:200,headers:{'content-type':'application/json'}});
}
function fakeFetch(content,calls=[],status=200){
  return async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});
    return status===200?completion(content):new Response(`upstream echoed ${KEY}`,{status});};
}
const goodContent=(id='a3')=>`\n{"statementId":"${id}","cue":"${CUE}"}`;

test('adapter sends only public projection to the Nebius endpoint with the server key',async()=>{
  const calls=[];
  const client=createNemotronClient({apiKey:KEY,fetchImpl:fakeFetch(goodContent(),calls)});
  assert.equal(client.available,true);
  const input={originalAnchor:{id:'a3',statement:'The garden gate is sometimes locked.',speakerId:'sam',topicId:'place'},
    activeTopic:{id:'timing',label:'When we meet'},
    publicContext:{participants:[{id:'sam',name:'Sam'}],anchors:[{id:'a3',statement:'The garden gate is sometimes locked.',speakerId:'sam',topicId:'place'}]}};
  assert.equal(await client.suggestReturnCue(input),CUE);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.tokenfactory.nebius.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization,'Bearer '+KEY);
  assert.equal(calls[0].body.model,NEMOTRON_MODEL);
  assert.ok(calls[0].body.max_tokens>=1500);
  assert.equal(JSON.stringify(calls[0].body).includes(SECRET),false);
});

test('adapter refuses to run without a key and never echoes a key in errors',async()=>{
  const none=createNemotronClient({apiKey:'  '});
  assert.equal(none.available,false);
  await assert.rejects(none.suggestReturnCue({}),error=>error.code==='MODEL_UNAVAILABLE');
  const failing=createNemotronClient({apiKey:KEY,fetchImpl:fakeFetch('',[],500)});
  await assert.rejects(failing.suggestReturnCue({originalAnchor:{id:'a3',speakerId:'sam',statement:'x'},activeTopic:{label:'t'},publicContext:{participants:[],anchors:[]}}),error=>{
    assert.equal(error.code,'MODEL_UNAVAILABLE');assert.equal(error.message.includes(KEY),false);return true;});
});

test('parseCue verifies the cited statement and length before anything is stored',()=>{
  assert.equal(parseCue(goodContent(),'a3'),CUE);
  assert.equal(parseCue('```json\n'+goodContent()+'\n```','a3'),CUE);
  assert.throws(()=>parseCue(goodContent('a1'),'a3'),/did not cite/);
  assert.throws(()=>parseCue('',"a3"),/no suggestion/);
  assert.throws(()=>parseCue('not json','a3'),/not valid JSON/);
  assert.throws(()=>parseCue(`{"statementId":"a3","cue":"${'x'.repeat(301)}"}`,'a3'),/too long/);
});

test('reconnect endpoint stores a verified suggestion, keeps drafts out of the model input, and clears it on edit',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'turnloom-nemotron-'));
  const calls=[];
  const app=await startServer({port:0,dataDir:dir,nemotron:createNemotronClient({apiKey:KEY,fetchImpl:fakeFetch(goodContent(),calls)})});
  const req=async(path,{method='GET',body,token}={})=>{
    const r=await fetch(app.url+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json()};
  };
  const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.data;};
  try{
    const demo=ok(await req('/api/demo',{method:'POST',body:{}}));
    const joined=ok(await req('/api/join',{method:'POST',body:{invitation:demo.invitations[0].invitation,sessionToken:randomBytes(32).toString('base64url')}}));
    const token=joined.token;
    const cmd=command=>req('/api/commands',{method:'POST',token,body:{command}});
    ok(await cmd({type:'reservation.create',id:'nem-r1',anchorId:'a3',intent:'question'}));
    let own=ok(await req('/api/session',{token}));
    let r=own.privateReservations.find(x=>x.id==='nem-r1');
    ok(await cmd({type:'draft.update',id:r.id,expectedRevision:r.revision,text:SECRET}));
    own=ok(await req('/api/session',{token}));
    r=own.privateReservations.find(x=>x.id==='nem-r1');
    assert.equal(own.model.available,true);

    const suggested=ok(await req('/api/reconnect',{method:'POST',token,body:{id:r.id,expectedRevision:r.revision}}));
    const stored=suggested.view.privateReservations.find(x=>x.id==='nem-r1');
    assert.equal(stored.reconnectionCue.text,CUE);
    assert.equal(stored.reconnectionCue.source,'model');
    assert.equal(stored.draft,SECRET);
    assert.equal(stored.status,'preparing');
    assert.equal(calls.length,1);
    assert.equal(JSON.stringify(calls[0].body).includes(SECRET),false);

    for(const path of ['/api/room','/api/export']){
      const visible=JSON.stringify(ok(await req(path,{token})));
      assert.equal(visible.includes(CUE),false,path);assert.equal(visible.includes(SECRET),false,path);
    }

    // Editing the draft is a new context: the suggestion disappears and is not reused.
    const edited=ok(await cmd({type:'draft.update',id:r.id,expectedRevision:stored.revision,text:SECRET+' more'}));
    assert.equal(edited.view.privateReservations.find(x=>x.id==='nem-r1').reconnectionCue,null);

    // A malformed model answer is refused and nothing is stored.
    const bad=createNemotronClient({apiKey:KEY,fetchImpl:fakeFetch(goodContent('a1'))});
    await app.close();
    const app2=await startServer({port:0,dataDir:dir,nemotron:bad});
    try{
      const again=await fetch(app2.url+'/api/session',{headers:{authorization:`Bearer ${token}`}}).then(x=>x.json());
      const current=again.privateReservations.find(x=>x.id==='nem-r1');
      const res=await fetch(app2.url+'/api/reconnect',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({id:current.id,expectedRevision:current.revision})});
      assert.equal(res.status,503);
      const body=await res.json();assert.equal(body.error.code,'MODEL_UNAVAILABLE');
      const after=await fetch(app2.url+'/api/session',{headers:{authorization:`Bearer ${token}`}}).then(x=>x.json());
      assert.equal(after.privateReservations.find(x=>x.id==='nem-r1').reconnectionCue,null);
    }finally{await app2.close();}
    const unavailable=await startServer({port:0,dataDir:dir,nemotron:createNemotronClient({apiKey:''})});
    try{
      const session=await fetch(unavailable.url+'/api/session',{headers:{authorization:`Bearer ${token}`}}).then(x=>x.json());
      assert.equal(session.model.available,false);
      const res=await fetch(unavailable.url+'/api/reconnect',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({id:'nem-r1',expectedRevision:1})});
      assert.equal(res.status,503);
    }finally{await unavailable.close();}
  }finally{await rm(dir,{recursive:true,force:true});}
});
