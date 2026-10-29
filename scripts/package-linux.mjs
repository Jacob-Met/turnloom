import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,copyFile,chmod,readdir,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Offline build: npm run package:linux -- VERIFIED_NODE_ARCHIVE NEW_OUTPUT_DIRECTORY
const [runtimeInput,outputInput]=process.argv.slice(2);
assert.ok(runtimeInput&&outputInput,'Expected NODE_ARCHIVE NEW_OUTPUT_DIRECTORY');
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(outputInput);
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=(exe,args,cwd=root)=>execFileSync(exe,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const git=(...args)=>run('git',args).trim();
assert.equal(git('status','--porcelain'),'','Build requires a clean committed checkout');
const commit=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
const qualificationInputs=['scripts/package-linux.mjs','scripts/TURNLOOM.sh','docs/LINUX.md'];
const sourceInputs=new Map();
for(const name of qualificationInputs){const bytes=await readFile(join(root,name));assert.ok(execFileSync('git',['show',commit+':'+name],{cwd:root}).equals(bytes),'Uncommitted build input '+name);sourceInputs.set(name,bytes);}
const npm=process.env.npm_execpath;assert.ok(npm,'Run through npm run package:linux');
const archiveBytes=await readFile(resolve(runtimeInput));
const runtimeArchiveSHA='b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406';
const runtimeSHA='94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90';
assert.equal(sha(archiveBytes),runtimeArchiveSHA,'Unexpected Node archive');
const stage=await mkdtemp(join(tmpdir(),'turnloom-linux-'));
try {
 const runtimeArchive=join(stage,'node.tar.gz');await writeFile(runtimeArchive,archiveBytes);
 const bundle=join(stage,'TURNLOOM');await mkdir(join(bundle,'runtime','bin'),{recursive:true});
 const unpack=join(stage,'node');await mkdir(unpack);
 run('tar',['-xzf',runtimeArchive,'-C',unpack,'--strip-components=1','node-v22.23.4-linux-x64/bin/node','node-v22.23.4-linux-x64/LICENSE','node-v22.23.4-linux-x64/README.md']);
 assert.equal(sha(await readFile(join(unpack,'bin/node'))),runtimeSHA);
 for(const name of ['bin/node','LICENSE','README.md'])await copyFile(join(unpack,name),join(bundle,'runtime',name));
 const node=join(bundle,'runtime/bin/node');await chmod(node,0o755);
 assert.deepEqual(JSON.parse(run(node,['-p','JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'])),{version:'v22.23.4',platform:'linux',arch:'x64'});
 const sourceOutput=join(stage,'source-package');
 const packed=JSON.parse(run(node,[join(root,'scripts/package-runtime.mjs'),sourceOutput]));
 assert.equal(packed.source.commit,commit);assert.equal(packed.source.modified,false);
 const sourceArchive=await readFile(packed.artifact);assert.equal(sha(sourceArchive),packed.sha256);
 const app=join(bundle,'app');await mkdir(app);
 run('tar',['-xzf',packed.artifact,'-C',app,'--strip-components=1']);
 const manifest=JSON.parse(await readFile(join(app,'runtime-manifest.json'),'utf8'));
 for(const f of manifest.files)assert.equal(sha(await readFile(join(app,f.path))),f.sha256);
 await copyFile(join(root,'scripts/TURNLOOM.sh'),join(bundle,'TURNLOOM.sh'));
 assert.ok((await readFile(join(bundle,'TURNLOOM.sh'))).equals(sourceInputs.get('scripts/TURNLOOM.sh')));
 await copyFile(join(root,'docs/LINUX.md'),join(bundle,'START-HERE.md'));
 assert.ok((await readFile(join(bundle,'START-HERE.md'))).equals(sourceInputs.get('docs/LINUX.md')));
 await chmod(join(bundle,'TURNLOOM.sh'),0o755);
 const build={application:'TURNLOOM',platform:'linux-x64',source_commit:commit,source_tree:tree,source_archive_sha256:packed.sha256,runtime:{version:'v22.23.4',archive_sha256:runtimeArchiveSHA,executable_sha256:runtimeSHA},launcher:'TURNLOOM.sh',limits:['Requires Linux x64 GNU libc, normal system libraries and a browser.','No user rooms included; data uses existing CLI/environment defaults (otherwise app/.turnloom).','Private local application; no hosted deployment or participant study qualification.']};
 await writeFile(join(bundle,'BUILD.json'),JSON.stringify(build,null,2)+'\n');
 const files=[];
 async function walk(dir,relative=''){for(const name of (await readdir(dir)).sort()){const rel=relative?relative+'/'+name:name,at=join(dir,name),s=await lstat(at);assert.ok(!s.isSymbolicLink());if(s.isDirectory())await walk(at,rel);else {assert.ok(s.isFile());files.push(rel);}}}
 await walk(bundle);files.sort();
 await writeFile(join(bundle,'SHA256SUMS'),(await Promise.all(files.map(async f=>sha(await readFile(join(bundle,f)))+'  '+f))).join('\n')+'\n');
 const filename='turnloom-0.1.0-linux-x64.tar.gz',archive=join(stage,filename);
 run('tar',['-czf',archive,'-C',stage,'TURNLOOM']);const bytes=await readFile(archive);
 assert.equal(git('rev-parse','HEAD'),commit);assert.equal(git('rev-parse','HEAD^{tree}'),tree);assert.equal(git('status','--porcelain'),'');
 for(const [name,bytes] of sourceInputs)assert.ok((await readFile(join(root,name))).equals(bytes),'Build input changed '+name);
 await mkdir(output); // Exclusive destination: never overwrite a prior delivery.
 await copyFile(archive,join(output,filename),constants.COPYFILE_EXCL);
 await writeFile(join(output,filename+'.sha256'),sha(bytes)+'  '+filename+'\n',{flag:'wx'});
 console.log(JSON.stringify({archive:join(output,filename),sha256:sha(bytes),bytes:bytes.length,build,files:files.length+1},null,2));
} finally {await rm(stage,{recursive:true,force:true});}
