import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {buildV31Document,productMinimumExpression} from '../../apps/api/src/contract-terms/render-model';
import {renderElectronicDocument} from '../../apps/api/src/electronic-documents/print';
import {hash} from '../../apps/api/src/common/data';
const workspace=resolve(__dirname,'../..');
const root=workspace+'/docs/legal/drafts/ninda/launch-20261107-v31',output=root+'/samples';mkdirSync(output,{recursive:true});
const fonts={regular:{path:'C:/Windows/Fonts/msyh.ttc',face:'MicrosoftYaHei'},bold:{path:'C:/Windows/Fonts/msyhbd.ttc',face:'MicrosoftYaHei-Bold'}};
Object.assign(process.env,{CONTRACT_CJK_FONT_FACE:fonts.regular.face,CONTRACT_CJK_BOLD_FONT_PATH:fonts.bold.path,CONTRACT_CJK_BOLD_FONT_FACE:fonts.bold.face});
const owner='合成长名称新能源汽车运营服务与绿色出行技术发展有限公司',customer='合成测试客户甲',platform='上海宁达信息科技有限公司';
const identity=`甲方：${customer}，证件识别：合成演示编号，不对应真实个人；联系电话：合成测试渠道。乙方：${owner}，统一社会信用代码：合成示例企业编号，住所：合成示例市演示路一号；法定代表人：合成测试乙，权限：法定代表人；服务渠道：合成测试服务热线。丙方：${platform}，企业信息和签署人员均为合成资料，仅用于本地布局核验。`;
const products='产品A-v1：实际6个月，最短3个月，基础费2000.00元/月，里程费500.00元/月，合计2500.00元/月，押金5000.00元；产品B-v2：实际12个月，最短6个月，合计3500.00元/月，押金6000.00元；每月2000公里，超里程1.00元/公里；赠送换车1次，额外每次500.00元。';
const fleet=Array.from({length:48},(_,i)=>`车辆${i+1}：品牌车型合成新能源轿车，车牌合成${String(i+1).padStart(3,'0')}，VIN SYNTHETIC${String(i+1).padStart(8,'0')}；登记所有人：${owner}；电池随车；适用期间2027-01-01至2028-12-31；出租权限经合成证据确认；无权利限制，无火烧、水泡、结构损伤。`).join('\n');
const values:Record<string,string>={
 'product.minimumTermMonths':'3','document.references':'合同编号 SAMPLE-01；订单 SAMPLE-ORDER-01；模板 V3.1 第1版',
 'parties.details':identity,'subscription.conditions':products.split('；产品B-v2')[0]+'；月含2000公里，超里程1.00元/公里，赠送换车1次，单次另购500.00元。 BaaS另付980.00元/月，收款人为合成电池服务企业。',
 'vehicle.disclosures':fleet.split('\n')[0],'delivery.plan':'计划2027-01-10于合成示例交付中心交付',
 'insurance.facts':'已确认投保交强险和商业险，保险公司：合成保险公司，尚未出单；已确认安排证据 SAMPLE-INSURANCE-01',
 'partiesAndAccount.details':`甲方：${platform}；乙方：${owner}。双方企业识别、住所、签署人及服务渠道为上述合成资料；乙方对公账户：合成银行合成支行，账户名${owner}，账号为非真实演示编号 SAMPLE-BANK-01。`,
 'cooperation.vehicles':'合作期2027-01-01至2028-12-31。\n'+fleet,
 'cooperation.revenue':'上述48辆车辆，乙方租金分润比例80%，2027-01-01起适用',
 'cooperation.partnerRateBps':'80','cooperation.products':products+'固定三方模板：SAMPLE-TEMPLATE-01，版本1，摘要'+ 'a'.repeat(64),
 'cooperation.minimumTerms':productMinimumExpression([{id:'产品A-v1',minimumTermMonths:3},{id:'产品B-v2',minimumTermMonths:6}]),
 'document.referencesAndParties':'本协议 SAMPLE-CHANGE-01；原合同 SAMPLE-01；订单 SAMPLE-ORDER-01。'+identity,
 'swap.vehiclesAndPeriod':'旧车SYNTHETIC00000001，新车SYNTHETIC00000002；实际出租方均为'+owner+'；原起租日2027-01-10，到期日2027-07-10，当前服务月2027-03-10至2027-04-10。',
 'swap.financialTerms':'升级换车，原月费2500.00元，新月费3500.00元，按本协议公式据实际交付日折算；BaaS无另付；使用赠送换车1次，本次服务费0.00元；实际差价按实际交接后核算。',
 'swap.deliveryAndInsurance':'计划2027-03-20合成示例中心还旧交新；新车已出单：合成保险公司，交强险和商业险，保单号 SAMPLE-POLICY-02。',
 'cancellation.facts':'车牌合成001，VIN SYNTHETIC00000001；客户原因协商取消，双方已核验实际从未交付。',
 'cancellation.financialTerms':'已收押金5000.00元、首期2500.00元，已退0.00元，无其他已确认费用，无争议应退7500.00元，无例外。',
 'renewal.originalTerms':'车辆合成001 / SYNTHETIC00000001，起租日2027-01-10，原日号10，原阶段2027-01-10至2027-07-10，月费2500.00元，押金5000.00元。',
 'renewal.newTerms':products.split('；产品B-v2')[0]+'；本次选产品A-v1，新期2027-07-10至2028-01-10，首期款2500.00元按确认安排支付，BaaS无另付。',
 'renewal.exceptions':'','termination.facts':'车辆合成001 / SYNTHETIC00000001；原期2027-01-10至2027-07-10，当前月费2500.00元，客户个人原因协商提前终止未履行部分，计划2027-04-10合成示例中心还车。',
 'termination.financialTerms':'已收押金5000.00元、租金7500.00元，已退0.00元；提前终止补偿按正文约定，以当期月费与未履行期间剩余租金较低者确定；其他独立事项凭真实证据另核，无例外。'
};
async function main(){const manifest:any[]=[];let mainScope:any;
 for(const id of ['01','02-main','02-grant','03','04','05','06']){
  const envelope=JSON.parse(readFileSync(`${root}/${id}.json`,'utf8'));
  // SAMPLE ONLY. This in-memory object is never written to LegalDocument or any database.
  const template={title:envelope.nodes[0].runs.map((r:any)=>r.text).join(''),type:`ELECTRONIC_V31_${envelope.kind}`,version:1,status:'PUBLISHED',confirmedBy:'SYNTHETIC-IN-MEMORY-ONLY',confirmedAt:new Date('2026-11-07T00:00:00Z'),content:JSON.stringify(envelope)};
  const fixedContent=readFileSync(`${root}/01.json`,'utf8');
  const sampleValues={...values,...(id==='03'?{'document.referencesAndParties':values['document.referencesAndParties']+'\n'+Array.from({length:24},(_,i)=>`合成常设服务联系人${i+1}：合成示例长姓名服务专员，所属企业${owner}，联系方式为合成可留痕官方渠道SAMPLE-CONTACT-${i+1}，仅负责服务联系，不代表替他方签署。`).join('\n')}:{}),...(id==='05'?{'renewal.exceptions':'双方确认本期新增合成书面服务联系渠道 SAMPLE-CONTACT-EXCEPTION，其他约定不变'}:{})};
  sampleValues['cooperation.products']=sampleValues['cooperation.products'].replace('a'.repeat(64),hash(fixedContent));
  const v31Snapshot={values:sampleValues,fixedTemplates:id.startsWith('02')?[{id:'SAMPLE-TEMPLATE-01',version:1,content:fixedContent,hash:hash(fixedContent)}]:undefined,grantReference:id==='02-grant'?{agreementNumber:'SAMPLE-COOPERATION-01',agreementHash:mainScope.hash,attachmentOne:mainScope.nodes}:undefined};
  const model=buildV31Document({kind:envelope.kind},v31Snapshot,template);
  if(id==='02-main')mainScope={hash:createHash('sha256').update(JSON.stringify(model.sections)).digest('hex'),nodes:model.sections.filter(n=>(n.loc>='P067'&&n.loc<='P073')||n.loc==='COOPERATION_EXCEPTIONS')};
  const parties=model.roles.map(role=>({role,partyId:'SAMPLE-'+role,subjectType:role==='CUSTOMER'?'INDIVIDUAL':'ENTERPRISE',name:role==='OWNER'?owner:role==='PLATFORM'?platform:customer,...(role==='CUSTOMER'?{identityNumber:'110101199001010000',phone:'13900000000'}:{creditCode:'SYN000000000000000'})}));
  const {buffer,positions,pageCount}=await renderElectronicDocument({kind:envelope.kind,number:'SAMPLE-'+id,version:1,businessHash:'a'.repeat(64),template,parties,sections:[],variables:{},v31Snapshot},fonts.regular.path);
  writeFileSync(`${output}/${id}.pdf`,buffer);manifest.push({id,sampleOnly:true,file:`${id}.pdf`,sha256:createHash('sha256').update(buffer).digest('hex'),pageCount,positions});
 }
 writeFileSync(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');console.log(manifest.map(m=>({id:m.id,pageCount:m.pageCount})));
}main();
