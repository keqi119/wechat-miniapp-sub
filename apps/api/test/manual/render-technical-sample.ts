import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {renderTechnicalPdf} from '../../src/technical-acceptance/pdf';
import {technicalBody} from '../../src/technical-acceptance/rules';
async function main(){const template=readFileSync('../../docs/legal/versions/technical-signing/technical-signing-verification-v1.md','utf8'),body=technicalBody(template,'SYNTHETIC-TECHNICAL-ACCEPTANCE','合成验证参与者','19900000001',new Date('2026-10-16T12:00:00Z'));const rendered=await renderTechnicalPdf(body,'C:/Windows/Fonts/simhei.ttf');mkdirSync('.runtime',{recursive:true});const file=resolve('.runtime/technical-acceptance-synthetic.pdf');writeFileSync(file,rendered.buffer);console.log(JSON.stringify({file,sha256:createHash('sha256').update(rendered.buffer).digest('hex'),slots:rendered.slotCoordinates,syntheticOnly:true}));}
main();
