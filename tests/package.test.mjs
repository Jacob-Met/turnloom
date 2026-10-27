import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,cp,readdir,rm,symlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const digest=b=>createHash('sha256').update(b).digest('hex');
test('portable archive serves its complete interface without saved rooms or development state',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'turnloom-package-test-'));
 try{
  const fixture=join(temporary,'source'),out1=join(temporary,'one'),out2=join(temporary,'two');
  await mkdir(fixture);
  for(const name of ['package.json','server.mjs','index.html','README.md','src','app','docs','scripts'])await cp(join(root,name),join(fixture,name),{recursive:true});
  await mkdir(join(fixture,'.turnloom'));await writeFile(join(fixture,'.turnloom','estate.json'),'PRIVATE-ROOM-SENTINEL');
  await mkdir(join(fixture,'node_modules'));await writeFile(join(fixture,'node_modules','secret.txt'),'PRIVATE-DEPENDENCY-SENTINEL');
  const npm=process.env.npm_execpath;assert(npm,'run through npm test');
  const build=out=>spawnSync(process.execPath,[npm,'run','package:runtime','--',out],{cwd:fixture,encoding:'utf8'});
  for(const out of [out1,out2]){const result=build(out);assert.equal(result.status,0,result.stderr+result.stdout);}
  const name=(await readdir(out1)).find(n=>n.endsWith('.tgz')),one=await readFile(join(out1,name)),two=await readFile(join(out2,name));
  assert.deepEqual(one,two,'same input/toolchain archive bytes');
  const members=execFileSync('tar',['-tzf',join(out1,name)],{encoding:'utf8'}).trim().split('\n');
  assert(!members.some(p=>p.includes('.turnloom')||p.includes('node_modules')||p.includes('/tests/')));
  const extracted=join(temporary,'received package é');await mkdir(extracted);
  execFileSync('tar',['-xzf',join(out1,name),'-C',extracted]);
  const runtime=join(extracted,'package'),manifest=JSON.parse(await readFile(join(runtime,'runtime-manifest.json'),'utf8'));
  assert.equal(manifest.source.modified,true);
  for(const item of manifest.files){const bytes=await readFile(join(runtime,item.path));assert.equal(bytes.length,item.bytes,item.path);assert.equal(digest(bytes),item.sha256,item.path);}
  const smoke=spawnSync(process.execPath,['scripts/smoke.mjs'],{cwd:runtime,encoding:'utf8',timeout:20000});
  assert.equal(smoke.status,0,smoke.stderr+smoke.stdout);assert.equal(JSON.parse(smoke.stdout).ok,true);
  const checksum=await readFile(join(out1,name+'.sha256'),'utf8');
  assert(checksum.startsWith(digest(one)+'  '));
  const repeat=build(out1);assert.notEqual(repeat.status,0,'never overwrite existing output');
  assert.deepEqual(await readFile(join(out1,name)),one);assert.equal(await readFile(join(out1,name+'.sha256'),'utf8'),checksum);
  await symlink(join(fixture,'.turnloom','estate.json'),join(fixture,'app','unsafe.txt'));
  const unsafe=build(join(temporary,'unsafe'));assert.notEqual(unsafe.status,0,'reject symlinked runtime input');
 }finally{await rm(temporary,{recursive:true,force:true});}
});
