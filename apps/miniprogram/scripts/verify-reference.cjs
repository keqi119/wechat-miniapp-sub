const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/mock-source-manifest.json'),'utf8').replace(/^\uFEFF/,''));let mismatch=0;
for(const file of manifest.files){for(const base of [manifest.source,path.join(root,'reference/miniprogram-mock')]){const bytes=fs.readFileSync(path.join(base,file.path));const hash=crypto.createHash('sha256').update(bytes).digest('hex');if(hash!==file.sha256||bytes.length!==file.bytes){console.error('Mismatch: '+file.path);mismatch++;}}}
console.log(JSON.stringify({files:manifest.files.length,verifiedCopies:2,mismatch,commit:manifest.commit}));if(mismatch)process.exitCode=1;
