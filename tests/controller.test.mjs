import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,apply,acceptModelResult,sharedView,publicExport,ownerView,modelInput} from '../src/controller.mjs';
const SECRET='PRIVATE_DRAFT_canary_64fd19';
function room(){return createRoom({id:'room-test',title:'Fictional reading circle',fictional:true,
 participants:[{id:'mira',name:'Mira'},{id:'leo',name:'Leo'},{id:'sam',name:'Sam'},{id:'jo',name:'Jo'}],
 topics:[{id:'place',label:'Where we meet'},{id:'timing',label:'When we meet'}],activeTopicId:'place',
 anchors:[{id:'a1',statement:'Could we meet at the library?',speakerId:'leo',topicId:'place'}]});}
function send(state,type,values={},actor='mira'){return apply(state,{type,...values},actor);}
function reservation(state,actor='mira',id='r1'){return ownerView(state,actor).privateReservations.find(r=>r.id===id);}
function reserve(state=room()){return send(state,'reservation.create',{id:'r1',anchorId:'a1',intent:'different-view'}).state;}
function edit(state,value=SECRET){const r=reservation(state);return send(state,'draft.update',{id:r.id,expectedRevision:r.revision,text:value}).state;}
function action(state,type){const r=reservation(state);return send(state,type,{id:r.id,expectedRevision:r.revision,expectedDraftVersion:r.draftVersion}).state;}
function request(state,requestId='model-1'){const r=reservation(state);return send(state,'model.request',{id:r.id,expectedRevision:r.revision,requestId});}
function resultFor(receipt,cue='Return to the original library question.'){return{id:'r1',...receipt.result.request,cue};}
function rejectsCode(fn,code){assert.throws(fn,error=>error?.code===code);}
test('private edits are immutable and absent from all non-owner projections',()=>{
 const before=reserve(),snapshot=structuredClone(before),publicBefore=sharedView(before),state=edit(before);
 assert.deepEqual(before,snapshot);assert.deepEqual(sharedView(state),publicBefore);
 assert.equal(reservation(state).draft,SECRET);assert.equal(reservation(state).draftVersion,1);assert.equal(reservation(state).revision,2);
 for(const projection of [sharedView(state),publicExport(state),ownerView(state,'leo')])assert.equal(JSON.stringify(projection).includes(SECRET),false);
 const pub=sharedView(state).reservations[0];
 assert.deepEqual(Object.keys(pub).sort(),['anchorId','id','intent','ownerId','status']);assert.equal(pub.intent,'different-view');
 rejectsCode(()=>send(state,'draft.update',{id:'r1',expectedRevision:2,text:'Other person overwrite'},'leo'),'FORBIDDEN');
});
test('model input is draft-free and model result cannot publish or edit',()=>{
 const receipt=request(edit(reserve())),state=receipt.state,input=modelInput(state,'r1','mira');
 assert.equal(JSON.stringify(input).includes(SECRET),false);assert.equal(Object.hasOwn(input,'draft'),false);
 assert.equal(input.originalAnchor.statement,'Could we meet at the library?');
 assert.equal(input.reservationRevision,reservation(state).revision);assert.equal(input.contextRevision,state.contextRevision);
 rejectsCode(()=>modelInput(state,'r1','leo'),'FORBIDDEN');
 const publicBefore=sharedView(state),accepted=acceptModelResult(state,resultFor(receipt)).state;
 assert.equal(reservation(accepted).draft,SECRET);assert.equal(reservation(accepted).status,'preparing');assert.equal(reservation(accepted).modelRequest,null);
 assert.equal(reservation(accepted).reconnectionCue.source,'model');assert.deepEqual(sharedView(accepted),publicBefore);
 assert.equal(JSON.stringify(ownerView(accepted,'leo')).includes('Return to the original library question.'),false);
 rejectsCode(()=>acceptModelResult(accepted,resultFor(receipt)),'STALE_MODEL_RESULT');
 rejectsCode(()=>send(state,'model.result',{...resultFor(receipt)}),'UNKNOWN_COMMAND');
});
test('new turn, topic change, private edit, and newer request reject stale models',()=>{
 const receipt=request(edit(reserve())),original=receipt.state,response=resultFor(receipt);
 const newTurn=send(original,'anchor.create',{id:'a2',statement:'Could Sunday work?',topicId:'timing'},'sam').state;
 rejectsCode(()=>acceptModelResult(newTurn,response),'STALE_MODEL_RESULT');
 const changedTopic=send(original,'topic.activate',{id:'timing'},'jo').state;
 rejectsCode(()=>acceptModelResult(changedTopic,response),'STALE_MODEL_RESULT');
 const changedDraft=edit(original,'A revised private contribution.');rejectsCode(()=>acceptModelResult(changedDraft,response),'STALE_MODEL_RESULT');
 const newer=request(original,'model-2').state;rejectsCode(()=>acceptModelResult(newer,response),'STALE_MODEL_RESULT');
});
test('public reservation changes invalidate model context without private-edit cadence',()=>{
 const receipt=request(edit(reserve())),initial=receipt.state;
 const other=send(initial,'reservation.create',{id:'r2',anchorId:'a1',intent:'question'},'leo').state;
 assert.ok(other.contextRevision>initial.contextRevision);rejectsCode(()=>acceptModelResult(other,resultFor(receipt)),'STALE_MODEL_RESULT');
 const ready=action(initial,'reservation.ready');assert.ok(ready.contextRevision>initial.contextRevision);
 const preparing=edit(ready,'Changed after readiness.');assert.ok(preparing.contextRevision>ready.contextRevision);
 const privateAgain=edit(preparing,'Another private edit.');assert.equal(privateAgain.contextRevision,preparing.contextRevision);assert.deepEqual(sharedView(privateAgain),sharedView(preparing));
});
test('editing invalidates readiness and return; sharing requires current explicit actions',()=>{
 let state=action(edit(reserve()),'reservation.ready');const ready=reservation(state);
 rejectsCode(()=>action(state,'reservation.share'),'RETURN_REQUIRED');
 state=action(state,'reservation.return');assert.equal(reservation(state).status,'ready');
 assert.equal(sharedView(state).timeline.at(-1).kind,'return');assert.equal(Object.hasOwn(sharedView(state).timeline.at(-1),'text'),false);
 rejectsCode(()=>action(state,'reservation.return'),'ALREADY_RETURNED');
 state=edit(state,'The exact revised contribution.');const current=reservation(state);
 assert.equal(current.status,'preparing');assert.equal(current.readyDraftVersion,null);assert.equal(current.returnedDraftVersion,null);
 rejectsCode(()=>send(state,'reservation.share',{id:'r1',expectedRevision:ready.revision,expectedDraftVersion:ready.draftVersion}),'STALE_REVISION');
 rejectsCode(()=>action(state,'reservation.share'),'NOT_READY');
 state=action(action(action(state,'reservation.ready'),'reservation.return'),'reservation.share');
 const view=sharedView(state),publication=view.timeline.at(-1);
 assert.equal(publication.kind,'publication');assert.equal(publication.text,'The exact revised contribution.');assert.equal(publication.anchorId,'a1');assert.equal(publication.topicId,'place');
 const anchor=view.anchors.find(a=>a.id===publication.publishedAnchorId);assert.ok(anchor);
 assert.equal(anchor.statement,publication.text);assert.equal(anchor.replyTo,'a1');assert.equal(anchor.speakerId,'mira');assert.equal(anchor.sequence,publication.sequence);
 state=send(state,'reservation.create',{id:'r2',anchorId:anchor.id,intent:'question'},'leo').state;
 assert.equal(reservation(state,'leo','r2').anchorId,anchor.id);rejectsCode(()=>edit(state),'TERMINAL_STATE');
});
test('withdrawal is terminal, preserves saved private words, and rejects delayed models',()=>{
 const receipt=request(edit(reserve())),before=receipt.state,r=reservation(before);
 const state=send(before,'reservation.withdraw',{id:'r1',expectedRevision:r.revision}).state,snapshot=structuredClone(state);
 assert.equal(reservation(state).status,'withdrawn');assert.equal(reservation(state).draft,SECRET);
 assert.equal(JSON.stringify(sharedView(state)).includes(SECRET),false);assert.ok(state.contextRevision>before.contextRevision);
 rejectsCode(()=>edit(state),'TERMINAL_STATE');rejectsCode(()=>action(state,'reservation.ready'),'TERMINAL_STATE');rejectsCode(()=>action(state,'reservation.share'),'TERMINAL_STATE');
 rejectsCode(()=>acceptModelResult(state,resultFor(receipt)),'TERMINAL_STATE');assert.deepEqual(state,snapshot);
});
test('manual anchors bind trusted speaker and reject unsupported fields and excess text',()=>{
 const state=room(),snapshot=structuredClone(state);
 rejectsCode(()=>send(state,'anchor.create',{id:'spoof',statement:'Spoofed attribution',speakerId:'leo'}),'UNKNOWN_FIELD');
 rejectsCode(()=>send(state,'anchor.update',{id:'a1',statement:'Changed original'}),'UNKNOWN_COMMAND');
 rejectsCode(()=>send(state,'anchor.create',{id:'large',statement:'x'.repeat(8001)}),'INVALID_INPUT');
 const next=send(state,'anchor.create',{id:'manual',statement:'My own manually entered point.'},'jo').state;
 assert.equal(next.anchors.at(-1).speakerId,'jo');assert.equal(next.anchors.at(-1).source,'manual');assert.equal(next.anchors.at(-1).topicId,'place');assert.deepEqual(state,snapshot);
});
