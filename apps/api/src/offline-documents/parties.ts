import {ensure} from '../common/errors';
export type ArchiveParty={role:string;partyId:string;name?:string;subjectType?:string;identityNumber?:string;phone?:string;creditCode?:string};
const labels:Record<string,string>={CUSTOMER:'承租人',OWNER:'出租方',PLATFORM:'平台服务方'};
export function partyMissingFields(p:ArchiveParty){
 const missing:string[]=[];if(!p.name?.trim())missing.push('姓名或名称');
 if(p.subjectType==='INDIVIDUAL'){if(!/^\d{17}[\dXx]$/.test(p.identityNumber||''))missing.push('身份证号');if(!/^[+\d ()-]{5,30}$/.test(p.phone||''))missing.push('电话');}
 else if(p.subjectType==='ENTERPRISE'){if(!/^[A-Z0-9]{18}$/.test(p.creditCode||''))missing.push('统一社会信用代码');}
 else missing.push('主体类型');return missing;
}
export function assertPartyDetails(parties:ArchiveParty[],roles:string[]){for(const role of roles){const p=parties.find(p=>p.role===role);const missing=p?partyMissingFields(p):['签署主体'];ensure(p?.partyId&&!missing.length,409,'PRINT_PARTIES_REQUIRED',`请先按已核验资料补齐${labels[role]||role}：${missing.join('、')}`);}}
export function partyPrintValue(p:ArchiveParty){return p.subjectType==='INDIVIDUAL'?`${p.name}；身份证号：${p.identityNumber}；电话：${p.phone}`:p.subjectType==='ENTERPRISE'?`${p.name}；统一社会信用代码：${p.creditCode}`:p.name||'';}
/** Only frozen order facts may fill an order party; current partner contacts are not legal identity. */
export function frozenPartyDetails(parties:ArchiveParty[],snapshot:any={}){return parties.map(p=>{
 const lessor=snapshot.lessorSnapshot||{},profile=snapshot.customerProfileSnapshot||{};
 if(p.role==='CUSTOMER')return{...p,subjectType:p.subjectType||'INDIVIDUAL',phone:p.phone||profile.mobile};
 if(p.role==='OWNER'&&p.partyId===lessor.ownerId&&p.name===lessor.name)return{...p,subjectType:p.subjectType||lessor.subjectType,creditCode:p.creditCode||lessor.creditCode,phone:p.phone||lessor.phone};
 if(p.role==='PLATFORM')return{...p,subjectType:p.subjectType||'ENTERPRISE'};
 return p;
 });}
export function updatePartyDetails(parties:ArchiveParty[],details:{parties:Array<{role:string;partyId:string;identityNumber?:string;phone?:string;creditCode?:string}>}){
 ensure(new Set(details.parties.map(p=>p.role)).size===details.parties.length,400,'ARCHIVE_PARTIES_REQUIRED','主体角色不能重复');
 for(const change of details.parties){const p=parties.find(p=>p.role===change.role&&p.partyId===change.partyId);ensure(p,409,'ARCHIVE_PARTIES_REQUIRED','只能补齐本版已冻结的签署主体');ensure(p.subjectType==='INDIVIDUAL'?!change.creditCode:p.subjectType==='ENTERPRISE'?!change.identityNumber&&!change.phone:false,400,'ARCHIVE_PARTIES_REQUIRED','补齐字段与原主体类型不符');for(const field of ['identityNumber','phone','creditCode'] as const)ensure(change[field]===undefined||!p[field]||change[field]===p[field],409,'ARCHIVE_PARTY_FIELD_FROZEN','本版已有法定信息已冻结，仅可补齐缺失字段，请核查资料来源');}
 return parties.map(p=>({...p,...details.parties.find(c=>c.role===p.role)}));
}
