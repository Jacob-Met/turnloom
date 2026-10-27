const LIMIT = Object.freeze({
  participants:16,topics:64,anchors:2000,reservations:2000,timeline:8000,
  name:100,label:200,statement:8000,draft:8000,cue:2000,
});
const STATUSES=new Set(['preparing','ready','withdrawn','shared']);
const INTENTS=new Set(['question','different-view','preparing']);
const clone=value=>structuredClone(value);
export class DomainError extends Error {constructor(code,message){super(message);this.name='DomainError';this.code=code;}}
function fail(code,message){throw new DomainError(code,message);}
function check(condition,code,message){if(!condition)fail(code,message);}
function object(value){check(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_INPUT','Expected an object.');}
function text(value,max,blank=false){check(typeof value==='string'&&value.length<=max&&(blank||value.trim().length>0),'INVALID_INPUT','Invalid text.');return value;}
function id(value){check(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),'INVALID_INPUT','Invalid identifier.');return value;}
function integer(value){check(Number.isSafeInteger(value)&&value>=0,'INVALID_INPUT','Invalid revision.');return value;}
function fields(value,allowed){object(value);for(const key of Object.keys(value))check(allowed.includes(key),'UNKNOWN_FIELD',`Unsupported field: ${key}`);}
function participant(state,actorId){id(actorId);const p=state.participants.find(p=>p.id===actorId);check(p,'FORBIDDEN','Unknown participant.');return p;}
function find(items,value,label){id(value);const item=items.find(item=>item.id===value);check(item,'NOT_FOUND',`${label} not found.`);return item;}
function unique(items,value){id(value);check(!items.some(item=>item.id===value),'DUPLICATE_ID','Identifier already exists.');}
function capacity(items,max){check(items.length<max,'LIMIT_EXCEEDED','Room limit reached.');}
function advanceContext(state){state.contextRevision+=1;for(const r of state.reservations)r.reconnectionCue=null;}
function event(state,value){capacity(state.timeline,LIMIT.timeline);state.sequence+=1;state.timeline.push({...value,sequence:state.sequence});}
function owned(state,command,actorId){
  const r=find(state.reservations,command.id,'Reservation');
  check(r.ownerId===actorId,'FORBIDDEN','Owner action required.');
  integer(command.expectedRevision);
  check(r.revision===command.expectedRevision,'STALE_REVISION','Reservation changed; refresh before acting.');
  check(!['withdrawn','shared'].includes(r.status),'TERMINAL_STATE','Reservation is terminal.');
  return r;
}
function draftMatch(r,command){integer(command.expectedDraftVersion);check(r.draftVersion===command.expectedDraftVersion,'STALE_DRAFT','Draft changed; review the current draft.');}
function invalidateModel(r){r.modelRequest=null;r.reconnectionCue=null;}
function addAnchor(state,input,speakerId){
  unique(state.anchors,input.id);capacity(state.anchors,LIMIT.anchors);participant(state,speakerId);
  const topicId=input.topicId??state.activeTopicId;find(state.topics,topicId,'Topic');text(input.statement,LIMIT.statement);
  event(state,{kind:'anchor',anchorId:input.id,topicId,speakerId});
  state.anchors.push({id:input.id,statement:input.statement,source:'manual',speakerId,topicId,sequence:state.sequence});
  advanceContext(state);
}
export function createRoom(seed){
  fields(seed,['id','title','participants','topics','activeTopicId','anchors','fictional']);id(seed.id);text(seed.title,LIMIT.label);
  check(Array.isArray(seed.participants)&&seed.participants.length>0&&seed.participants.length<=LIMIT.participants,'INVALID_INPUT','Invalid participants.');
  check(Array.isArray(seed.topics)&&seed.topics.length>0&&seed.topics.length<=LIMIT.topics,'INVALID_INPUT','Invalid topics.');
  check(seed.fictional===undefined||typeof seed.fictional==='boolean','INVALID_INPUT','Invalid fictional flag.');
  const state={schemaVersion:1,id:seed.id,title:seed.title,fictional:seed.fictional===true,participants:[],topics:[],activeTopicId:seed.activeTopicId,contextRevision:0,sequence:0,anchors:[],reservations:[],timeline:[]};
  for(const p of seed.participants){fields(p,['id','name']);unique(state.participants,p.id);text(p.name,LIMIT.name);state.participants.push({id:p.id,name:p.name});}
  for(const t of seed.topics){fields(t,['id','label']);unique(state.topics,t.id);text(t.label,LIMIT.label);state.topics.push({id:t.id,label:t.label});}
  find(state.topics,seed.activeTopicId,'Topic');check(seed.anchors===undefined||Array.isArray(seed.anchors),'INVALID_INPUT','Invalid anchors.');
  for(const a of seed.anchors??[]){
    fields(a,['id','statement','topicId','speakerId','source','sequence']);
    check(a.source===undefined||a.source==='manual','INVALID_INPUT','Only explicit manual anchors are supported.');
    if(a.sequence!==undefined)check(a.sequence===state.sequence+1,'INVALID_INPUT','Seed sequence must preserve ordered turns.');
    addAnchor(state,a,a.speakerId);
  }
  return state;
}
const COMMAND_FIELDS={
  'topic.create':['type','id','label'],'topic.activate':['type','id'],'anchor.create':['type','id','statement','topicId'],
  'reservation.create':['type','id','anchorId','intent'],'draft.update':['type','id','expectedRevision','text'],
  'reservation.ready':['type','id','expectedRevision','expectedDraftVersion'],
  'reservation.return':['type','id','expectedRevision','expectedDraftVersion'],
  'reservation.withdraw':['type','id','expectedRevision'],
  'reservation.share':['type','id','expectedRevision','expectedDraftVersion'],
  'model.request':['type','id','expectedRevision','requestId'],
};
export function apply(state,command,actorId){
  object(command);check(Object.hasOwn(COMMAND_FIELDS,command.type),'UNKNOWN_COMMAND','Unsupported command.');
  fields(command,COMMAND_FIELDS[command.type]);participant(state,actorId);
  const next=clone(state);let result={id:command.id};
  if(command.type==='topic.create'){
    unique(next.topics,command.id);capacity(next.topics,LIMIT.topics);text(command.label,LIMIT.label);
    next.topics.push({id:command.id,label:command.label});advanceContext(next);
  }else if(command.type==='topic.activate'){
    find(next.topics,command.id,'Topic');check(next.activeTopicId!==command.id,'INVALID_TRANSITION','Topic is already active.');
    next.activeTopicId=command.id;event(next,{kind:'topic',topicId:command.id,actorId});advanceContext(next);
  }else if(command.type==='anchor.create'){
    addAnchor(next,command,actorId);
  }else if(command.type==='reservation.create'){
    unique(next.reservations,command.id);capacity(next.reservations,LIMIT.reservations);find(next.anchors,command.anchorId,'Anchor');
    const intent=command.intent??'preparing';check(INTENTS.has(intent),'INVALID_INPUT','Invalid intent.');
    next.reservations.push({id:command.id,ownerId:actorId,anchorId:command.anchorId,intent,status:'preparing',revision:1,draftVersion:0,draft:'',readyDraftVersion:null,returnedDraftVersion:null,modelRequest:null,reconnectionCue:null,publication:null});
    result.revision=1;advanceContext(next);
  }else{
    const r=owned(next,command,actorId);check(STATUSES.has(r.status),'INVALID_STATE','Invalid reservation state.');
    if(command.type==='draft.update'){
      text(command.text,LIMIT.draft,true);
      const wasReady=r.status==='ready';
      r.draft=command.text;r.draftVersion+=1;r.status='preparing';r.readyDraftVersion=null;r.returnedDraftVersion=null;invalidateModel(r);
      if(wasReady)advanceContext(next);
    }else if(command.type==='reservation.ready'){
      draftMatch(r,command);check(r.status==='preparing','INVALID_TRANSITION','Already ready.');text(r.draft,LIMIT.draft);
      r.status='ready';r.readyDraftVersion=r.draftVersion;invalidateModel(r);advanceContext(next);
    }else if(command.type==='reservation.withdraw'){
      r.status='withdrawn';r.readyDraftVersion=null;r.returnedDraftVersion=null;invalidateModel(r);advanceContext(next);
    }else if(command.type==='reservation.return'||command.type==='reservation.share'){
      draftMatch(r,command);check(r.status==='ready'&&r.readyDraftVersion===r.draftVersion,'NOT_READY','Current draft must be explicitly ready.');
      const anchor=find(next.anchors,r.anchorId,'Anchor');
      const common={reservationId:r.id,anchorId:r.anchorId,ownerId:r.ownerId,topicId:anchor.topicId};
      if(command.type==='reservation.return'){
        check(r.returnedDraftVersion!==r.draftVersion,'ALREADY_RETURNED','This ready draft already returned to its anchor.');
        r.returnedDraftVersion=r.draftVersion;event(next,{kind:'return',...common});
      }else{
        check(r.returnedDraftVersion===r.draftVersion,'RETURN_REQUIRED','Return to the original point before sharing.');
        capacity(next.anchors,LIMIT.anchors);
        const prefix='publication-'+(next.sequence+1);let publishedAnchorId=prefix,suffix=0;
        while(next.anchors.some(a=>a.id===publishedAnchorId))publishedAnchorId=prefix+'-'+(++suffix);
        r.publication={text:r.draft,anchorId:r.anchorId,topicId:anchor.topicId,publishedAnchorId};
        r.status='shared';event(next,{kind:'publication',...common,publishedAnchorId,text:r.draft});
        next.anchors.push({id:publishedAnchorId,statement:r.draft,source:'manual',speakerId:r.ownerId,topicId:anchor.topicId,replyTo:r.anchorId,sequence:next.sequence});
      }
      invalidateModel(r);advanceContext(next);
    }else if(command.type==='model.request'){
      id(command.requestId);
      r.modelRequest={requestId:command.requestId,reservationRevision:r.revision+1,draftVersion:r.draftVersion,contextRevision:next.contextRevision};
      r.reconnectionCue=null;
    }
    r.revision+=1;result={id:r.id,revision:r.revision,draftVersion:r.draftVersion};
    if(command.type==='model.request')result.request=clone(r.modelRequest);
  }
  return {state:next,result};
}
export function acceptModelResult(state,input){
  fields(input,['id','requestId','reservationRevision','draftVersion','contextRevision','cue']);
  const original=find(state.reservations,input.id,'Reservation');
  check(!['withdrawn','shared'].includes(original.status),'TERMINAL_STATE','Reservation is terminal.');
  text(input.cue,LIMIT.cue);id(input.requestId);
  for(const key of ['reservationRevision','draftVersion','contextRevision'])integer(input[key]);
  const q=original.modelRequest;
  check(q&&q.requestId===input.requestId&&q.reservationRevision===input.reservationRevision&&q.draftVersion===input.draftVersion&&q.contextRevision===input.contextRevision&&original.revision===input.reservationRevision&&original.draftVersion===input.draftVersion&&state.contextRevision===input.contextRevision,'STALE_MODEL_RESULT','Model context is no longer current.');
  const next=clone(state),r=find(next.reservations,input.id,'Reservation');
  r.reconnectionCue={text:input.cue,source:'model',contextRevision:input.contextRevision};r.modelRequest=null;r.revision+=1;
  return {state:next,result:{id:r.id,revision:r.revision}};
}
export function sharedView(state){
  return clone({
    schemaVersion:state.schemaVersion,id:state.id,title:state.title,fictional:state.fictional,
    participants:state.participants.map(({id,name})=>({id,name})),
    topics:state.topics.map(({id,label})=>({id,label})),activeTopicId:state.activeTopicId,contextRevision:state.contextRevision,
    anchors:state.anchors.map(a=>({id:a.id,statement:a.statement,source:a.source,speakerId:a.speakerId,topicId:a.topicId,sequence:a.sequence,...(a.replyTo?{replyTo:a.replyTo}:{})})),
    reservations:state.reservations.map(r=>({id:r.id,ownerId:r.ownerId,anchorId:r.anchorId,intent:r.intent,status:r.status,
      ...(r.status==='shared'?{publication:{text:r.publication.text,anchorId:r.publication.anchorId,topicId:r.publication.topicId,publishedAnchorId:r.publication.publishedAnchorId}}:{})})),
    timeline:state.timeline.map(e=>{
      const out={kind:e.kind,sequence:e.sequence,topicId:e.topicId};
      for(const key of ['anchorId','speakerId','actorId','reservationId','ownerId','publishedAnchorId'])if(e[key]!==undefined)out[key]=e[key];
      if(e.kind==='publication')out.text=e.text;
      return out;
    }),
  });
}
export function publicExport(state){return sharedView(state);}
export function ownerView(state,actorId){participant(state,actorId);return {...sharedView(state),actorId,privateReservations:clone(state.reservations.filter(r=>r.ownerId===actorId))};}
export function modelInput(state,reservationId,actorId){
  participant(state,actorId);const r=find(state.reservations,reservationId,'Reservation');
  check(r.ownerId===actorId,'FORBIDDEN','Owner action required.');check(!['withdrawn','shared'].includes(r.status),'TERMINAL_STATE','Reservation is terminal.');
  const q=r.modelRequest;check(q&&q.reservationRevision===r.revision&&q.draftVersion===r.draftVersion&&q.contextRevision===state.contextRevision,'STALE_MODEL_REQUEST','Request context is no longer current.');
  const publicContext=sharedView(state),anchor=find(publicContext.anchors,r.anchorId,'Anchor');
  return clone({id:r.id,...q,instruction:'Suggest a brief neutral cue for returning to the quoted original point. Do not invent, complete, paraphrase, or attribute the participant’s unshared contribution. Do not imply consent.',originalAnchor:anchor,activeTopic:find(publicContext.topics,state.activeTopicId,'Topic'),publicContext});
}
