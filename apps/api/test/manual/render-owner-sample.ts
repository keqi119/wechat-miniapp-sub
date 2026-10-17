import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {ContractPdfRendererService} from '../../src/contract/contract-pdf-renderer.service';
import {createOwnerContractPdfSigningSlots} from '../../src/contract/contract-pdf-render-model';
import {commercialTermKeys,resolveSubscriptionTemplate} from '../../src/contract/contract-template';
import {projectRoot} from '../../src/common/config';
async function main(){
 const out=resolve(projectRoot,'.runtime/owner-pdf');mkdirSync(out,{recursive:true});
 const snapshot={lessorSnapshot:{name:'合成企业车主有限公司',creditCode:'SYNTHETIC-ONLY',address:'合成注册地址',phone:'021-55550000'},revision:1,commercialHash:'a'.repeat(64),months:12,monthlyFeeAmount:1,depositAmount:1,mileagePerMonthKm:1500,excessMileagePriceAmount:150,startDate:'2026-10-17',firstDueDate:'2026-10-17',energyDescription:'客户承担充电电费，电池租赁由产品方承担',benefits:['基础里程1500公里/月'],conditions:'合成测试用途，不建立租赁',commercialTerms:Object.fromEntries(commercialTermKeys.map(k=>[k,'合成已明确条款：'+k]))};
 const identity={name:'合成订阅客户',idCardNo:'SYNTHETIC-NOT-IDENTITY'},resource={id:'SYNTHETIC-CONTRACT',orderId:'SYNTHETIC-ORDER',order:{applicationId:'SYNTHETIC-APPLICATION',customer:{mobile:'13800000000'},finalPlanSnapshot:snapshot}};
 const content=readFileSync(resolve(projectRoot,'docs/legal/versions/owner-signing/owner-rental-contract-v2.md'),'utf8'),body=resolveSubscriptionTemplate(content,resource,identity,2);
 const rendered=await new ContractPdfRendererService().render({agreementKind:'SUBSCRIPTION_STANDARD',contractId:resource.id,contractNo:resource.id,orderNo:resource.orderId,generatedAt:'2026-10-17',templateName:'合成样本：实际车主与客户订阅合同',templateVersion:'2',contentTemplate:body,subscriberParty:{subscriberName:identity.name,subscriberIdNumber:identity.idCardNo,subscriberContactAddress:'合成联系地址',subscriberContactName:identity.name,subscriberContactPhone:'13800000000',subscriberEmail:'',subscriberWechat:''},signingStage:'STAGE1_CONTRACT',signingSlots:createOwnerContractPdfSigningSlots(snapshot.lessorSnapshot.name),appendix:{sections:[{title:'本单实际出租方（合成样本）',rows:[{label:'企业名称',value:snapshot.lessorSnapshot.name},{label:'租金及期限',value:'12期每期0.01元；押金0.01元；2026-10-17至2027-10-16'}]}]}},{cjkFontPath:'C:/Windows/Fonts/simhei.ttf'});
 writeFileSync(resolve(out,'owner-contract.pdf'),rendered.buffer);writeFileSync(resolve(out,'slots.json'),JSON.stringify(rendered.slotCoordinates,null,2));console.log(JSON.stringify({directory:out,slots:rendered.slotCoordinates.length,syntheticOnly:true}));
}main();
