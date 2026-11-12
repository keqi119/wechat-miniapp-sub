import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {hash} from '../../apps/api/src/common/data';
import {projectRoot} from '../../apps/api/src/common/config';
import {renderUnilateralLetter,NINDA_AUTHORIZATION_GRANTEE} from '../../apps/api/src/owner-signing/unilateral-letter-document';

async function main(){
 const root=projectRoot,content=await readFile(resolve(root,'docs/legal/drafts/ninda/owner-authorization-letter-v1.md'),'utf8');
 const rendered=await renderUnilateralLetter({authorityId:'PREVIEW-ONLY-NOT-VALID-20261021',ownerId:'synthetic-preview',ownerName:'合成验收企业（仅供预览）',creditCode:'示例信用代码（非真实登记信息）',ownerAddress:'示例地址（非真实登记信息）',legalName:'示例法人',grantee:NINDA_AUTHORIZATION_GRANTEE,validFrom:'2026-10-21T00:00:00.000Z',validUntil:'2027-10-21T00:00:00.000Z',documentKinds:['SUBSCRIPTION_WITH_FEES'],templateId:'preview-letter-v1',templateVersion:1,templateHash:hash(content),templateContent:content},process.env.PREVIEW_CJK_FONT||'C:/Windows/Fonts/simhei.ttf');
 const directory=resolve(root,'output/pdf');await mkdir(directory,{recursive:true});
 const path=resolve(directory,'宁达-企业车主单方用印授权书-待确认样张-20261021.pdf');await writeFile(path,rendered.buffer);
 console.log(JSON.stringify({path,bytes:rendered.buffer.length,bodyHash:rendered.bodyHash,slotCoordinates:rendered.slotCoordinates}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
