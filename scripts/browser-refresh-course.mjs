import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {requireChromiumSandbox} from './support/chromium-sandbox.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.TURNLOOM_PLAYWRIGHT||'playwright-core');
const runtimeRoot=resolve(process.env.TURNLOOM_RUNTIME_ROOT||fileURLToPath(new URL('../',import.meta.url)));
const receiptRoot=resolve(process.env.TURNLOOM_RECEIPTS||join(tmpdir(),'turnloom-refresh-receipts'));
await mkdir(receiptRoot,{recursive:true});
const dataDir=await mkdtemp(join(tmpdir(),'turnloom-refresh-data-'));
const receipt={kind:'session-refresh-order-browser-course',runtimeRoot,node:process.version,checks:[],pageerrors:[],externalRequests:[]};
const redact=s=>String(s).replace(/[A-Za-z0-9_-]{43}/g,'[redacted-secret]');
const bounded=async(fn,message,timeout=12000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error(message);};
const deadline=(promise,message,timeout=12000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeout);})]).finally(()=>clearTimeout(timer));};
let app,browser;const contexts=[];let stage='startup';
async function participant(){
 const response=await fetch(app.url+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,201);const demo=await response.json();
 const context=await browser.newContext({viewport:{width:1100,height:900}});contexts.push(context);
 context.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(app.url).origin)receipt.externalRequests.push(new URL(r.url()).origin);});
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>receipt.pageerrors.push(redact(e.message)));
 const cdp=await context.newCDPSession(page);receipt.sandbox??=await requireChromiumSandbox({send:(method,params)=>cdp.send(method,params)});
 await page.goto(app.url+demo.invitations.find(i=>i.participantId==='mira').href);await page.locator('#workspace').waitFor({state:'visible'});
 await page.locator('[data-anchor="a3"] .reserve-button').click();await page.locator('#reserve').click();await page.locator('#draft-area').waitFor({state:'visible'});
 return {page,demo,context};
}
async function current(page){
 const token=await page.evaluate(()=>sessionStorage.getItem('turnloom.token'));
 const response=await fetch(app.url+'/api/session',{headers:{Authorization:'Bearer '+token}});
 assert.equal(response.status,200);return response.json();
}
async function save(page,text){
 await page.locator('#draft').fill(text);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/commands'&&r.request().method()==='POST');
 await page.locator('#save-draft').click();assert.equal((await response).status(),200);
 await bounded(async()=> (await current(page)).privateReservations.some(r=>r.draft===text),'Expected saved draft not received');
 await bounded(()=>page.locator('#save-draft').isDisabled(),'Save did not finish');
}
async function holdNextSession(page){
 let release,observe,fulfilled;
 const gate=new Promise(r=>{release=r;});
 const captured=new Promise(r=>{observe=r;});
 const delivered=new Promise(r=>{fulfilled=r;});
 let used=false;
 await page.route('**/api/session',async route=>{
  if(used){await route.continue();return;}used=true;
  const response=await route.fetch();const body=await response.text();
  observe(JSON.parse(body));await gate;await route.fulfill({response,body});fulfilled();
 });
 return {captured:deadline(captured,'Background read was not captured'),release:async()=>{release();await deadline(delivered,'Background read was not delivered');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));},dispose:()=>page.unroute('**/api/session')};
}
try{
 const {startServer}=await import(pathToFileURL(join(runtimeRoot,'server.mjs')).href);
 app=await startServer({port:0,dataDir});browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,chromiumSandbox:true,args:['--enable-automation']});receipt.browser=browser.version();
 stage='stale poll after saved draft';
 {
  const {page,context}=await participant();await save(page,'Earlier saved fictional draft.');
  const held=await holdNextSession(page);const previous=await held.captured;
  assert.ok(previous.privateReservations.some(r=>r.draft==='Earlier saved fictional draft.'));
  await save(page,'Newer exact fictional contribution.');
  await held.release();
  const visible=await page.locator('#draft').inputValue(),stored=(await current(page)).privateReservations.find(r=>r.anchorId==='a3').draft;
  receipt.savedDraft={visible,stored};
  assert.equal(visible,'Newer exact fictional contribution.','A delayed background read replaced a newer confirmed draft in the composer');
  assert.equal(stored,visible);
  receipt.checks.push('delayed background read cannot replace a newer confirmed draft');
  await held.dispose();await context.close();
 }
 stage='stale poll across participant entry';
 {
  const {page,demo,context}=await participant();await save(page,'Mira private fictional contribution.');
  const held=await holdNextSession(page);assert.equal((await held.captured).actorId,'mira');
  const next=demo.invitations.find(i=>i.participantId==='leo');
  await page.goto(app.url+next.href);
  await bounded(()=>page.locator('#identity').innerText().then(t=>t==='Your session: Leo'),'Second participant did not enter');
  await held.release();
  const identity=await page.locator('#identity').innerText();
  receipt.joinedIdentity={visible:identity,stored:(await current(page)).actorId};
  assert.equal(identity,'Your session: Leo','A previous participant response replaced the newly joined identity');
  assert.equal((await current(page)).actorId,'leo');
  assert.equal(await page.locator('#composer').isHidden(),true);
  receipt.checks.push('delayed old participant read cannot replace a newly accepted session');
  await held.dispose();await context.close();
 }
 stage='stale command across participant entry';
 {
  const {page,demo,context}=await participant();await save(page,'Original participant baseline.');
  let release,observe,delivered;const gate=new Promise(r=>{release=r;}),captured=new Promise(r=>{observe=r;}),finished=new Promise(r=>{delivered=r;});
  let used=false;
  await page.route('**/api/commands',async route=>{if(used){await route.continue();return;}used=true;const response=await route.fetch();const body=await response.text();observe(JSON.parse(body));await gate;await route.fulfill({response,body});delivered();});
  await page.locator('#draft').fill('Committed before another participant enters.');await page.locator('#save-draft').click();
  const originalResult=await deadline(captured,'Delayed command was not captured');assert.equal(originalResult.view.actorId,'mira');
  const next=demo.invitations.find(i=>i.participantId==='leo');await page.goto(app.url+next.href);
  await bounded(()=>page.locator('#identity').innerText().then(t=>t==='Your session: Leo'),'Second participant did not enter while command was pending');
  release();await deadline(finished,'Delayed command was not delivered');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.locator('#identity').innerText(),'Your session: Leo','A previous participant command replaced the newly joined identity');
  assert.equal(await page.locator('#draft').inputValue(),'');assert.equal(await page.locator('#composer').isHidden(),true);
  receipt.checks.push('delayed original-session action cannot replace a newly accepted participant');
  await page.unroute('**/api/commands');await context.close();
 }
 stage='slow background read recovery';
 {
  const {page,context}=await participant();
  let release,observe,delivered;const gate=new Promise(r=>{release=r;}),captured=new Promise(r=>{observe=r;}),finished=new Promise(r=>{delivered=r;});
  let reads=0;
  await page.route('**/api/session',async route=>{reads+=1;if(reads>1){await route.continue();return;}const response=await route.fetch();const body=await response.text();observe();await gate;await route.fulfill({response,body});delivered();});
  await deadline(captured,'Slow session read was not captured');
  const token=await page.evaluate(()=>sessionStorage.getItem('turnloom.token'));
  const posted=await fetch(app.url+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({command:{type:'anchor.create',statement:'A new point while the earlier refresh is delayed.'}})});
  assert.equal(posted.status,200);await new Promise(r=>setTimeout(r,2800));
  assert.equal(reads,1,'Background refreshes overlapped while the earlier read was still pending');
  release();await deadline(finished,'Slow session read was not delivered');
  await bounded(()=>page.locator('.statement-text').allTextContents().then(xs=>xs.includes('A new point while the earlier refresh is delayed.')),'Polling did not receive new state after its slow read completed');
  receipt.checks.push('slow background reads stay serialized and later updates still arrive');
  await page.unroute('**/api/session');await context.close();
 }
 stage='genuine stale command error across participant entry';
 {
  const {page,demo,context}=await participant();
  let intercepted=false,released=false,releaseHeld,reportPrepared,reportDone;
  const gate=new Promise(r=>{releaseHeld=()=>{if(!released){released=true;r();}};});
  const prepared=new Promise(r=>{reportPrepared=r;}),done=new Promise(r=>{reportDone=r;});
  await page.route('**/api/commands',async route=>{
   if(intercepted||route.request().method()!=='POST'){await route.continue();return;}intercepted=true;
   try{
    const request=route.request(),original=request.postDataJSON().command;
    assert.equal(original.type,'draft.update');const authorization=request.headers().authorization;assert.ok(authorization);
    const concurrent=await fetch(request.url(),{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({command:{type:'draft.update',id:original.id,expectedRevision:original.expectedRevision,text:'Concurrent fictional save.'}})});
    assert.equal(concurrent.status,200);await concurrent.arrayBuffer();
    const response=await route.fetch(),body=await response.text();assert.equal(response.status(),409);assert.equal(JSON.parse(body).error.code,'STALE_REVISION');
    reportPrepared(true);await gate;await route.fulfill({response,body});reportDone(true);
   }catch{reportPrepared(false);try{await route.abort('failed');}catch{}reportDone(false);}
  });
  try{
   await page.locator('#draft').fill('Pending fictional UI save.');await page.locator('#save-draft').click();
   assert.equal(await deadline(prepared,'Genuine stale command was not prepared'),true);
   await page.goto(app.url+demo.invitations.find(i=>i.participantId==='leo').href);
   await bounded(()=>page.locator('#identity').innerText().then(t=>t==='Your session: Leo'),'Leo did not enter before delayed error');
   const viewState=()=>page.evaluate(()=>({identity:document.querySelector('#identity').textContent.trim(),hidden:document.querySelector('#composer').hidden,draft:document.querySelector('#draft').value,error:document.querySelector('#error').textContent.trim(),notice:document.querySelector('#notice').textContent.trim()}));
   const expected={identity:'Your session: Leo',hidden:true,draft:'',error:'',notice:''};assert.deepEqual(await viewState(),expected);
   const delivered=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/commands'&&r.status()===409);void delivered.catch(()=>{});
   releaseHeld();assert.equal(await deadline(done,'Genuine stale error was not delivered'),true);await (await delivered).finished();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.deepEqual(await viewState(),expected);assert.equal((await current(page)).actorId,'leo');
   receipt.checks.push('genuine old-session STALE_REVISION error cannot affect a newly accepted participant');
  }finally{releaseHeld();await context.close();if(intercepted)await deadline(done,'Stale command cleanup did not finish');}
 }
 stage='dirty draft and focus across delayed prior-session read';
 {
  const {page,demo,context}=await participant();let held,released=false;
  try{
   const mira=await current(page),oldIds=mira.privateReservations.map(r=>r.id);assert.equal(mira.actorId,'mira');
   held=await holdNextSession(page);await held.captured;
   await page.goto(app.url+demo.invitations.find(i=>i.participantId==='leo').href);
   await bounded(()=>page.locator('#identity').innerText().then(t=>t==='Your session: Leo'),'Leo did not enter for dirty draft');
   await page.locator('[data-anchor="a3"] .reserve-button').click();await page.locator('#reserve').click();await page.locator('#draft-area').waitFor({state:'visible'});
   await bounded(()=>page.locator('#draft').isEnabled(),'Leo editor did not become enabled');
   const before=await current(page);assert.equal(before.actorId,'leo');assert.equal(before.privateReservations.length,1);
   const reservation=before.privateReservations[0];assert.equal(reservation.ownerId,'leo');assert.equal(reservation.anchorId,'a3');
   const draftText='Leo unsaved continuity after changing participants.',quote=await page.locator('#anchor-quote').textContent(),preview=await page.locator('#share-preview').textContent(),notice=await page.locator('#notice').textContent();
   await page.locator('#draft').fill(draftText);await page.locator('#draft').evaluate(e=>{e.focus();e.setSelectionRange(5,9,'forward');});
   const assertEditor=async()=>{
    const ui=await page.evaluate(({id,oldIds})=>{const d=document.querySelector('#draft'),ids=[...document.querySelectorAll('.branches button[data-reservation]')].map(e=>e.dataset.reservation);return{identity:document.querySelector('#identity').textContent.trim(),value:d.value,focused:document.activeElement===d,start:d.selectionStart,end:d.selectionEnd,direction:d.selectionDirection,disabled:d.disabled,readOnly:d.readOnly,status:document.querySelector('#draft-status').textContent,preview:document.querySelector('#share-preview').textContent,quote:document.querySelector('#anchor-quote').textContent,error:document.querySelector('#error').textContent.trim(),notice:document.querySelector('#notice').textContent,own:ids.includes(id),old:oldIds.some(id=>ids.includes(id))};},{id:reservation.id,oldIds});
    assert.equal(ui.identity,'Your session: Leo');assert.equal(ui.value,draftText);assert.equal(ui.focused,true);assert.equal(ui.start,5);assert.equal(ui.end,9);assert.equal(ui.direction,'forward');assert.equal(ui.disabled,false);assert.equal(ui.readOnly,false);assert.match(ui.status,/Unsaved changes/i);assert.equal(ui.preview,preview);assert.equal(ui.quote,quote);assert.equal(ui.error,'');assert.equal(ui.notice,notice);assert.equal(ui.own,true);assert.equal(ui.old,false);
   };
   await assertEditor();
   const nextLeoPoll=page.waitForResponse(async r=>{if(r.request().method()!=='GET'||new URL(r.url()).pathname!=='/api/session'||!r.ok())return false;try{return(await r.json()).actorId==='leo';}catch{return false;}},{timeout:15000});void nextLeoPoll.catch(()=>{});
   await held.release();released=true;await assertEditor();await deadline(nextLeoPoll,'No subsequent Leo poll');
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await assertEditor();
   const after=await current(page);assert.equal(after.actorId,'leo');assert.equal(after.privateReservations.length,1);assert.deepEqual(after.privateReservations[0],reservation);
   receipt.checks.push('new participant unsaved words focus selection and ownership survive old response and next poll');
  }finally{try{if(held&&!released)await held.release();}finally{try{if(held)await held.dispose();}finally{await context.close();}}}
 }
 stage='background read timeout recovery';
 for(const switchParticipant of [false,true]){
  const {page,demo,context}=await participant();
  let releaseHeld,observed,handlerDone,used=false,firstRequest,aborted=false;
  const gate=new Promise(r=>{releaseHeld=r;}),captured=new Promise(r=>{observed=r;}),done=new Promise(r=>{handlerDone=r;});
  page.on('requestfailed',request=>{if(request===firstRequest)aborted=true;});
  await page.route('**/api/session',async route=>{
   if(used){await route.continue();return;}used=true;firstRequest=route.request();
   try{const response=await route.fetch(),body=await response.text();observed(true);await gate;await route.fulfill({response,body});}
   catch{observed(false);}
   finally{handlerDone();}
  });
  try{
   assert.equal(await deadline(captured,'Timeout read was not captured'),true);
   if(switchParticipant){
    await page.goto(app.url+demo.invitations.find(i=>i.participantId==='leo').href);
    await bounded(()=>page.locator('#identity').innerText().then(t=>t==='Your session: Leo'),'Leo did not enter while read was stalled');
   }
   const actor=switchParticipant?'leo':'mira',name=switchParticipant?'Leo':'Mira';
   const token=await page.evaluate(()=>sessionStorage.getItem('turnloom.token'));
   const statement='Automatic refresh recovered for '+actor+' after a read timeout.';
   const posted=await fetch(app.url+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({command:{type:'anchor.create',statement}})});
   assert.equal(posted.status,200);await posted.arrayBuffer();
   await bounded(()=>page.locator('.statement-text').allTextContents().then(xs=>xs.includes(statement)),'A stalled background read blocked subsequent polling for '+actor,18000);
   assert.equal(aborted,true,'The original background request was not bounded by cancellation');
   assert.equal(await page.locator('#identity').innerText(),'Your session: '+name);
   assert.equal(await page.locator('#error').textContent(),'');
   receipt.checks.push('stalled background read times out and refresh resumes for '+(switchParticipant?'a newly accepted participant':'the current participant'));
  }finally{releaseHeld();await deadline(done,'Timed-out request cleanup did not finish');await page.unroute('**/api/session');await context.close();}
 }
 assert.deepEqual(receipt.pageerrors,[]);assert.deepEqual(receipt.externalRequests,[]);receipt.passed=true;
}catch(error){receipt.passed=false;receipt.failure={stage,message:redact(error.message),stack:redact(error.stack)};process.exitCode=1;}
finally{await browser?.close().catch(()=>{});await app?.close().catch(()=>{});await rm(dataDir,{recursive:true,force:true});await writeFile(join(receiptRoot,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks,stage,receipt:join(receiptRoot,'receipt.json'),failure:receipt.failure?.message,savedDraft:receipt.savedDraft,joinedIdentity:receipt.joinedIdentity}));}
