import {mkdtemp,mkdir,readFile,writeFile,readdir,lstat,rm,copyFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const destination=resolve(process.argv[2]||join(root,'artifacts'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const stage=await mkdtemp(join(tmpdir(),'turnloom-package-'));
const files=['server.mjs','index.html','README.md','scripts/smoke.mjs'];
for(const directory of ['src','app','docs']) {
  const directoryStat=await lstat(join(root,directory));
  if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())throw new Error('Not a regular source directory: '+directory);
  async function walk(at) {
    for(const name of (await readdir(at)).sort()) {
      const path=join(at,name),stat=await lstat(path);
      if(stat.isSymbolicLink())throw new Error('Package inputs cannot be symlinks: '+relative(root,path));
      if(stat.isDirectory())await walk(path);else if(stat.isFile())files.push(relative(root,path));else throw new Error('Unsupported input '+path);
    }
  }
  await walk(join(root,directory));
}
let commit=null;
try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{}
const manifest={schemaVersion:1,application:'TURNLOOM',version:pkg.version,source:{commit,modified:false},toolchain:{node:process.version,npm:process.env.npm_config_user_agent||null},files:[]};
try {
  for(const name of files.sort()){
    const path=join(root,name),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Not a regular input: '+name);
    const bytes=await readFile(path),out=join(stage,name);await mkdir(dirname(out),{recursive:true});await writeFile(out,bytes);
    manifest.files.push({path:name,bytes:bytes.length,sha256:digest(bytes),origin:'source'});
    if(commit){try{if(!execFileSync('git',['show',commit+':'+name],{cwd:root,stdio:['ignore','pipe','pipe']}).equals(bytes))manifest.source.modified=true;}catch{manifest.source.modified=true;}}
    else manifest.source.modified=true;
  }
  for(const name of ['package.json','scripts/package-runtime.mjs']){
    const bytes=await readFile(join(root,name));
    (manifest.buildInputs??=[]).push({path:name,bytes:bytes.length,sha256:digest(bytes)});
    if(commit){try{if(!execFileSync('git',['show',commit+':'+name],{cwd:root,stdio:['ignore','pipe','pipe']}).equals(bytes))manifest.source.modified=true;}catch{manifest.source.modified=true;}}
  }
  const runtime={name:'turnloom-runtime',version:pkg.version,private:true,type:'module',engines:pkg.engines,scripts:{start:'node server.mjs',smoke:'node scripts/smoke.mjs'}};
  const runtimeBytes=Buffer.from(JSON.stringify(runtime,null,2)+'\n');await writeFile(join(stage,'package.json'),runtimeBytes);
  manifest.files.push({path:'package.json',bytes:runtimeBytes.length,sha256:digest(runtimeBytes),origin:'generated'});
  manifest.files.sort((a,b)=>a.path.localeCompare(b.path));
  await writeFile(join(stage,'runtime-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const npm=process.env.npm_execpath;
  if(!npm)throw new Error('Run this through npm run package:runtime so the exact npm CLI is known.');
  const packed=JSON.parse(execFileSync(process.execPath,[npm,'pack','--ignore-scripts','--json','--offline'],{cwd:stage,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const expected=[...manifest.files.map(x=>x.path),'runtime-manifest.json'].sort();
  if(JSON.stringify(packed[0].files.map(x=>x.path).sort())!==JSON.stringify(expected))throw new Error('Archive membership did not match the runtime manifest.');
  const archive=join(stage,packed[0].filename),bytes=await readFile(archive);
  await mkdir(destination,{recursive:true});
  const target=join(destination,packed[0].filename),sidecar=target+'.sha256';
  let ownsSidecar=false;
  try{
    const handle=await open(sidecar,'wx');ownsSidecar=true;
    try{await handle.writeFile(digest(bytes)+'  '+packed[0].filename+'\n');}finally{await handle.close();}
    await copyFile(archive,target,constants.COPYFILE_EXCL);
  }catch(error){if(ownsSidecar)await rm(sidecar,{force:true});throw error;}
  console.log(JSON.stringify({artifact:target,sha256:digest(bytes),bytes:bytes.length,files:expected.length,source:manifest.source},null,2));
}finally{await rm(stage,{recursive:true,force:true});}
