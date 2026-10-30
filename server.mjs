import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {createRoom,apply,acceptModelResult,modelInput,sharedView,ownerView,publicExport,DomainError} from './src/controller.mjs';
import {demoSeed} from './src/seed.mjs';
import {openStore} from './src/store.mjs';
import {createNemotronClient,NEMOTRON_MODEL,ModelError} from './src/nemotron.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const STATIC=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app/app.mjs',['app/app.mjs','text/javascript; charset=utf-8']],
  ['/app/style.css',['app/style.css','text/css; charset=utf-8']],
]);
const CLIENT_COMMANDS=new Set(['topic.create','topic.activate','anchor.create','reservation.create','draft.update','reservation.ready','reservation.return','reservation.withdraw','reservation.share']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
class HttpError extends Error {constructor(code,message,status){super(message);this.name='HttpError';this.code=code;this.status=status;}}
function failure(code,message,status=400){return new HttpError(code,message,status);}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
async function jsonBody(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw failure('CONTENT_TYPE','Use application/json.',415);
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>32768)throw failure('TOO_LARGE','This request is too large.',413);chunks.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure('INVALID_JSON','The request is not valid JSON.');}
  if(!plain(data))throw failure('INVALID_BODY','Send a JSON object.');
  return data;
}

export async function startServer({port=4177,dataDir=join(ROOT,'.turnloom'),nemotron=createNemotronClient({apiKey:process.env.NEBIUS_API_KEY})}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port.');
  const store=await openStore(resolve(dataDir));
  let allowedHosts=new Set();
  function identify(req,snapshot) {
    const authorization=req.headers.authorization||'';
    if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))throw failure('UNAUTHORIZED','Enter using your participant invitation.',401);
    const record=snapshot.sessions[hash(authorization.slice(7))];
    if(!record||!snapshot.rooms[record.roomId])throw failure('UNAUTHORIZED','This participant session is not available.',401);
    return record;
  }
  function view(snapshot,identity) {
    return {...ownerView(snapshot.rooms[identity.roomId],identity.actorId),mode:'fictional-demo',
      model:nemotron.available
        ?{available:true,mode:'nemotron',model:NEMOTRON_MODEL,provider:'NVIDIA Nemotron on Nebius Token Factory',message:'Optional return suggestions read only public statements. Your draft is never sent.'}
        :{available:false,mode:'manual',message:'Manual anchors are active. Set NEBIUS_API_KEY on this server to enable optional return suggestions.'}};
  }
  function reply(res,status,payload,extra={}) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});
    res.end(JSON.stringify(payload));
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Permissions-Policy','microphone=(), camera=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if(!allowedHosts.has(req.headers.host))throw failure('HOST','This local server does not accept that host.',403);
      if(req.headers.origin && !['http://'+req.headers.host].includes(req.headers.origin))throw failure('ORIGIN','Use this server from its own page.',403);
      if(req.headers['sec-fetch-site']==='cross-site')throw failure('ORIGIN','Cross-site requests are not accepted.',403);
      const url=new URL(req.url,'http://'+req.headers.host);
      if(req.method==='GET'&&STATIC.has(url.pathname)) {
        const [file,type]=STATIC.get(url.pathname);const bytes=await readFile(join(ROOT,file));
        res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length});res.end(bytes);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/health'){reply(res,200,{ok:true,application:'TURNLOOM',mode:'manual',recording:false});return;}
      if(req.method==='POST'&&url.pathname==='/api/demo') {
        await jsonBody(req);
        const outcome=await store.transaction(snapshot=>{
          if(Object.keys(snapshot.rooms).length>=64)throw failure('ROOM_LIMIT','This local demo already contains 64 rooms. Use another data directory for a new study.',409);
          const roomId=randomUUID();const room=createRoom(demoSeed(roomId));
          const invitations={...snapshot.invitations};
          const links=room.participants.map(participant=>{
            const invitation=secret();invitations[hash(invitation)]={roomId,actorId:participant.id};
            return {participantId:participant.id,name:participant.name,invitation,href:'/#invite='+invitation};
          });
          return {snapshot:{...snapshot,rooms:{...snapshot.rooms,[roomId]:room},invitations},result:{room:sharedView(room),invitations:links}};
        });
        reply(res,201,outcome);return;
      }
      if(req.method==='POST'&&url.pathname==='/api/join') {
        const data=await jsonBody(req);
        if(typeof data.invitation!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.invitation))throw failure('INVITATION','This invitation is not valid.',401);
        if(typeof data.sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.sessionToken))throw failure('SESSION_TOKEN','A retained session key is required.',400);
        const outcome=await store.transaction(snapshot=>{
          const key=hash(data.invitation),tokenHash=hash(data.sessionToken),invitation=snapshot.invitations[key];
          if(!invitation||!snapshot.rooms[invitation.roomId])throw failure('INVITATION','This invitation has already been used or is not available.',401);
          const identity={roomId:invitation.roomId,actorId:invitation.actorId};
          if(invitation.usedTokenHash){
            const session=snapshot.sessions[tokenHash];
            if(invitation.usedTokenHash!==tokenHash||!session||session.roomId!==identity.roomId||session.actorId!==identity.actorId)throw failure('INVITATION','This invitation has already been used by a different session.',401);
            return {snapshot,result:{token:data.sessionToken,view:view(snapshot,identity)}};
          }
          if(snapshot.sessions[tokenHash])throw failure('SESSION_COLLISION','This session key is already in use. The invitation remains available.',409);
          const invitations={...snapshot.invitations,[key]:{...identity,usedTokenHash:tokenHash}};
          const next={...snapshot,invitations,sessions:{...snapshot.sessions,[tokenHash]:identity}};
          return {snapshot:next,result:{token:data.sessionToken,view:view(next,identity)}};
        });
        reply(res,200,outcome);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/session'){
        const snapshot=store.current();reply(res,200,view(snapshot,identify(req,snapshot)));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/room'){
        const snapshot=store.current(),identity=identify(req,snapshot);reply(res,200,sharedView(snapshot.rooms[identity.roomId]));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/export'){
        const snapshot=store.current(),identity=identify(req,snapshot);
        reply(res,200,publicExport(snapshot.rooms[identity.roomId]),{'Content-Disposition':'attachment; filename="turnloom-shared-conversation.json"'});return;
      }
      if(req.method==='POST'&&url.pathname==='/api/commands') {
        const data=await jsonBody(req);
        if(!plain(data.command)||!CLIENT_COMMANDS.has(data.command.type))throw failure('COMMAND','This participant command is not supported.');
        const command={...data.command};
        if(['topic.create','anchor.create','reservation.create'].includes(command.type)&&command.id===undefined)command.id=randomUUID();
        if('actorId' in command||'ownerId' in command||'speakerId' in command)throw failure('IDENTITY','Participant identity comes from your session.',403);
        const outcome=await store.transaction(snapshot=>{
          const identity=identify(req,snapshot);
          const changed=apply(snapshot.rooms[identity.roomId],command,identity.actorId);
          const next={...snapshot,rooms:{...snapshot.rooms,[identity.roomId]:changed.state}};
          return {snapshot:next,result:{result:changed.result,view:view(next,identity)}};
        });
        reply(res,200,outcome);return;
      }
      if(req.method==='POST'&&url.pathname==='/api/reconnect') {
        const data=await jsonBody(req);
        if(!nemotron.available)throw failure('MODEL_UNAVAILABLE','Manual anchors remain available. Set NEBIUS_API_KEY on this server to enable optional return suggestions.',503);
        if(typeof data.id!=='string'||!Number.isSafeInteger(data.expectedRevision))throw failure('INVALID_INPUT','Choose a reservation and refresh before asking for a suggestion.');
        const requestId=randomUUID();
        // Step 1 records the request against the owner's current revision; any later change makes it stale.
        await store.transaction(snapshot=>{
          const identity=identify(req,snapshot);
          const changed=apply(snapshot.rooms[identity.roomId],{type:'model.request',id:data.id,expectedRevision:data.expectedRevision,requestId},identity.actorId);
          return {snapshot:{...snapshot,rooms:{...snapshot.rooms,[identity.roomId]:changed.state}},result:null};
        });
        // Step 2 calls the model outside the write queue, with the public projection only.
        const requested=store.current(),identity=identify(req,requested);
        const input=modelInput(requested.rooms[identity.roomId],data.id,identity.actorId);
        let cue;
        try{cue=await nemotron.suggestReturnCue(input);}
        catch(error){
          if(error instanceof ModelError)throw failure('MODEL_UNAVAILABLE',error.message+' Manual anchors remain available.',503);
          throw error;
        }
        // Step 3 stores the suggestion only if the reservation, draft and public context are still exactly the ones asked about.
        const outcome=await store.transaction(snapshot=>{
          const current=identify(req,snapshot);
          const changed=acceptModelResult(snapshot.rooms[current.roomId],{id:input.id,requestId:input.requestId,reservationRevision:input.reservationRevision,draftVersion:input.draftVersion,contextRevision:input.contextRevision,cue});
          const next={...snapshot,rooms:{...snapshot.rooms,[current.roomId]:changed.state}};
          return {snapshot:next,result:{result:changed.result,view:view(next,current)}};
        });
        reply(res,200,outcome);return;
      }
      throw failure('NOT_FOUND','This page or action is not available.',404);
    } catch(error) {
      const known=error instanceof HttpError||error instanceof DomainError;
      const code=known?error.code:'INTERNAL';
      const status=error instanceof HttpError?error.status:!known?500:(/STALE|REVISION|VERSION|CONFLICT|TERMINAL|READY|RETURN|STATE|EXISTS/.test(code)?409:/OWNER|FORBIDDEN|ACTOR/.test(code)?403:/NOT_FOUND|UNKNOWN_ID/.test(code)?404:400);
      const message=status>=500&&code!=='MODEL_UNAVAILABLE'?'The action could not be confirmed. Refresh to see the saved state before trying again.':error.message;
      if(!res.headersSent)reply(res,status,{error:{code,message}});
      else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(error){await store.close();throw error;}
  const actual=server.address().port;
  allowedHosts=new Set(['127.0.0.1:'+actual,'localhost:'+actual]);
  let closing;
  return {server,url:'http://127.0.0.1:'+actual,dataDir:resolve(dataDir),
    close(){return closing??=(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await store.close();})();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const options={port:Number(process.env.PORT||4177),dataDir:process.env.TURNLOOM_DATA_DIR||join(ROOT,'.turnloom')};
  for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--port')options.port=Number(process.argv[++i]);else if(process.argv[i]==='--data-dir')options.dataDir=process.argv[++i];else throw new Error('Unknown argument '+process.argv[i]);}
  const app=await startServer(options);
  console.log('TURNLOOM_READY '+JSON.stringify({url:app.url,mode:'manual',recording:false}));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().then(()=>process.exit(0),()=>process.exit(1));});
}
