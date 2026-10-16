import {readFileSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyMiniappPackage({workspace=process.cwd(),project,expectedManifestSha,expectedConfigSha}={}){
 const workspaceRoot=realpathSync(workspace),defaultPath=resolve(workspaceRoot,'apps/miniprogram/.artifacts/production');
 const requested=resolve(project||defaultPath);
 if(lstatSync(requested).isSymbolicLink())throw Error('Symbolic project path rejected');
 const projectPath=realpathSync(requested),isDefault=projectPath===defaultPath;
 if(!isDefault&&!projectPath.startsWith(realpathSync(resolve(workspaceRoot,'.runtime/releases'))+sep))throw Error('Project outside approved artifact roots');
 if(!isDefault&&(!/^[a-f0-9]{64}$/i.test(expectedManifestSha||'')||!/^[a-f0-9]{64}$/i.test(expectedConfigSha||'')))throw Error('External frozen manifest and config hashes required');
 for(const entry of readdirSync(projectPath,{withFileTypes:true}))if(!['src','project.config.json','FILE-MANIFEST.json'].includes(entry.name)||entry.isSymbolicLink())throw Error('Unexpected project file');
 const manifestBytes=readFileSync(resolve(projectPath,'FILE-MANIFEST.json')),configBytes=readFileSync(resolve(projectPath,'project.config.json'));
 const manifestSha256=sha(manifestBytes),configSha256=sha(configBytes);
 if(expectedManifestSha&&manifestSha256!==expectedManifestSha.toLowerCase())throw Error('Frozen manifest hash mismatch');
 if(expectedConfigSha&&configSha256!==expectedConfigSha.toLowerCase())throw Error('Frozen config hash mismatch');
 const manifest=JSON.parse(manifestBytes),config=JSON.parse(configBytes);
 if(config.appid!=='wxa7089edf4a34a7f5'||config.compileType!=='miniprogram'||config.miniprogramRoot!=='src/'||config.setting?.urlCheck!==true||config.packOptions?.include?.length||config.packOptions?.ignore?.length)throw Error('Unexpected miniapp configuration');
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Source manifest missing');
 const expected=new Map();
 for(const file of manifest.files){
  if(typeof file.path!=='string'||!/^src\/(?:[^/\\:.]+\/)*[^/\\:]+$/.test(file.path)||file.path.split('/').some(x=>x==='.'||x==='..')||!/^[a-f0-9]{64}$/.test(file.sha256||''))throw Error('Invalid manifest path or hash');
  if(expected.has(file.path))throw Error('Duplicate manifest path');expected.set(file.path,file.sha256);
 }
 const actual=[];
 function walk(relative){for(const entry of readdirSync(resolve(projectPath,relative),{withFileTypes:true})){
  const name=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Symbolic source path rejected');
  if(entry.isDirectory())walk(name);else if(entry.isFile())actual.push(name);else throw Error('Unsupported source file');
 }}
 walk('src');
 if(actual.length!==expected.size||actual.some(path=>!expected.has(path)))throw Error('Source file set differs from manifest');
 for(const path of actual)if(sha(readFileSync(resolve(projectPath,path)))!==expected.get(path))throw Error('Source hash mismatch');
 return{projectPath,config,manifestSha256,configSha256,files:actual.length};
}
