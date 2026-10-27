import {randomBytes} from 'node:crypto';
import {startServer} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'turnloom-smoke-'));
let app;
try {
  app=await startServer({port:0,dataDir:directory});
  for(const path of ['/','/app/style.css','/app/app.mjs','/api/health']){const res=await fetch(app.url+path);assert.equal(res.status,200,path);assert((await res.text()).length>0,path);}
  const created=await fetch(app.url+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(created.status,201);
  const demo=await created.json();assert.equal(demo.invitations.length,4);
  const joined=await fetch(app.url+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitation:demo.invitations[0].invitation,sessionToken:randomBytes(32).toString('base64url')})});assert.equal(joined.status,200);
  const {token,view}=await joined.json();assert.equal(view.actorId,'mira');
  const publicView=await fetch(app.url+'/api/room',{headers:{Authorization:'Bearer '+token}});assert.equal(publicView.status,200);
  console.log(JSON.stringify({ok:true,assets:3,participants:4,manual:true,recording:false}));
} finally {if(app)await app.close();await rm(directory,{recursive:true,force:true});}
