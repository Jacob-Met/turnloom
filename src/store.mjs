import {open,mkdir,readFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// One process owns a data directory. A failed write never replaces in-memory state.
export async function openStore(directory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const lockPath=join(directory,'writer.lock');
  let lock;
  try { lock=await open(lockPath,'wx',0o600); }
  catch(error) {
    if(error.code==='EEXIST') throw new Error('This data directory already has a writer.lock. Stop its server before reuse. After a crash, verify the recorded PID is no longer running before removing only that lock.');
    throw error;
  }
  await lock.writeFile(JSON.stringify({pid:process.pid,instance:randomUUID()})+'\n');
  await lock.sync();
  const path=join(directory,'estate.json');
  let snapshot={schemaVersion:1,rooms:{},invitations:{},sessions:{}};
  try {
    try { snapshot=JSON.parse(await readFile(path,'utf8')); }
    catch(error) {if(error.code!=='ENOENT')throw error;}
    if(snapshot.schemaVersion!==1 || !snapshot.rooms || !snapshot.invitations || !snapshot.sessions)throw new Error('Unsupported or incomplete saved room data.');
  } catch(error) {await lock.close();await unlink(lockPath);throw error;}
  let queue=Promise.resolve();
  let closed=false;
  return {
    current(){return snapshot;},
    transaction(update) {
      const task=queue.then(async()=>{
        if(closed)throw new Error('Store is closed.');
        const {snapshot:next,result}=await update(snapshot);
        if(next!==snapshot) {
          const temporary=join(directory,'.estate-'+randomUUID()+'.tmp');
          const file=await open(temporary,'wx',0o600);
          try {await file.writeFile(JSON.stringify(next)+'\n');await file.sync();}
          catch(error){await file.close();await unlink(temporary).catch(()=>{});throw error;}
          await file.close();
          try {await rename(temporary,path);}
          catch(error){await unlink(temporary).catch(()=>{});throw error;}
          // Rename has committed the new complete snapshot. Keep memory in agreement.
          snapshot=next;
          const folder=await open(directory,'r');
          try {await folder.sync();}finally{await folder.close();}
        }
        return result;
      });
      queue=task.catch(()=>{});
      return task;
    },
    async close(){if(closed)return;await queue;closed=true;await lock.close();await unlink(lockPath);}
  };
}
