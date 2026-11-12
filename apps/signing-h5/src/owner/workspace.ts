import type {Authority} from './model';
export type ContractDomain='OWNER_CONTRACT'|'PLATFORM_HANDOVER';
export interface BusinessContract {id:string;resourceId:string;documentDomain?:ContractDomain;handoverType?:string;kind:string;status:string;ownerMode:string|null;createdAt:string;archivedAt:string|null;reviewedAt:string|null;parties:{role:string;status:string}[];orderId:string|null;vehicleTitle:string|null;monthlyFeeAmount:number|null;depositAmount:number|null;months:number|null;documentHash:string;sourceSha256:string|null;sourceAvailable:boolean;signedAvailable:boolean;canSign:boolean;canQuery:boolean;blockers:string[];body?:string}
export interface ContractList {items:BusinessContract[];signingMode:'MANUAL';manualSigningEnabled:boolean;automaticSigningEnabled:false}
export type ContractGroup='pending'|'processing'|'completed'|'closed';
export type Feedback={context?:string;error?:string;note?:string;certificateCode?:string;tone?:'info'|'success'};
export type FeedbackMap=Record<string,Feedback>;
export const isHandover=(contract:BusinessContract)=>contract.documentDomain==='PLATFORM_HANDOVER';
export const contractDomain=(contract:BusinessContract):ContractDomain=>contract.documentDomain||'OWNER_CONTRACT';
export const contractTaskKey=(contract:BusinessContract)=>`${contractDomain(contract)}:${contract.id}`;
export function checkedContract(contract:BusinessContract,domain:ContractDomain,taskId?:string){
 if(contractDomain(contract)!==domain||(domain==='PLATFORM_HANDOVER')!==(contract.kind==='HANDOVER')||(taskId!==undefined&&contract.id!==taskId))throw new Error('文件所属业务或编号不一致，请重新读取原记录。');
 return contract;
}
export function contractBasePath(ownerId:string,domain:ContractDomain){
 if(!/^[A-Za-z0-9_-]+$/.test(ownerId)||!['OWNER_CONTRACT','PLATFORM_HANDOVER'].includes(domain))throw new Error('文件地址无效。');
 return `/owners/${ownerId}/${domain==='PLATFORM_HANDOVER'?'handovers':'contracts'}`;
}
export function contractPath(ownerId:string,contract:BusinessContract){
 checkedContract(contract,contractDomain(contract));
 if(!/^[A-Za-z0-9_-]+$/.test(contract.id))throw new Error('文件地址无效。');
 return `${contractBasePath(ownerId,contractDomain(contract))}/${contract.id}`;
}
export function contractKindLabel(contract:BusinessContract){
 if(isHandover(contract))return ({DELIVERY:'交车交接单',RETURN:'还车交接单'} as Record<string,string>)[contract.handoverType||'']||'车辆交接单';
 return contract.kind==='SUBSCRIPTION'?'订阅主合同及费用附件':contract.kind==='AMENDMENT'?'业务补充协议':'业务合同';
}
export function contractPresentation(contract:BusinessContract):{group:ContractGroup;label:string}{
 if(contract.status==='ARCHIVED')return {group:'completed',label:'已签署归档'};
 if(['REJECTED','EXPIRED','CANCELLED'].includes(contract.status))return {group:'closed',label:({REJECTED:'已拒签',EXPIRED:'签署已过期',CANCELLED:'已取消'} as Record<string,string>)[contract.status]};
 if(contract.status==='UNKNOWN')return {group:'processing',label:'签署结果待确认'};
 const customer=contract.parties.find(p=>p.role==='CUSTOMER'),owner=contract.parties.find(p=>p.role===(isHandover(contract)?'PLATFORM':'OWNER'));
 if(owner?.status==='SIGNED'&&customer?.status==='SIGNED')return {group:'processing',label:'双方已签，待归档'};
 if(customer?.status!=='SIGNED')return {group:'pending',label:'待客户签署'};
 if(owner?.status==='UNKNOWN'||['SIGNING','PROCESSING'].includes(contract.status))return {group:'processing',label:'签署处理中'};
 return {group:'pending',label:contract.canSign?'待法人签署':'待准备签署'};
}
export const contractConfirmationKey=(contract:BusinessContract)=>JSON.stringify({documentDomain:contractDomain(contract),kind:contract.kind,handoverType:contract.handoverType,id:contract.id,resourceId:contract.resourceId,documentHash:contract.documentHash,sourceSha256:contract.sourceSha256,status:contract.status,parties:contract.parties});
export function contractSignPayload(contract:BusinessContract,confirmation:string,accepted:boolean){
 if(!accepted||confirmation!==contractConfirmationKey(contract))throw new Error('请核对本份完整合同并重新勾选确认。');
 if(!contract.canSign||!contract.sourceAvailable||!contract.parties.some(p=>p.role==='CUSTOMER'&&p.status==='SIGNED')||['ARCHIVED','REJECTED','EXPIRED','CANCELLED'].includes(contract.status))throw new Error('当前合同尚不满足法人签署条件，请查询最新结果。');
 if(!/^[a-f0-9]{64}$/.test(contract.documentHash)||!contract.sourceSha256||!/^[a-f0-9]{64}$/.test(contract.sourceSha256))throw new Error('合同文件摘要不完整，请重新读取。');
 return {accepted:true as const,documentHash:contract.documentHash,sourceSha256:contract.sourceSha256};
}
export function contractFilePath(ownerId:string,taskId:string,kind:'source'|'signed',domain:ContractDomain='OWNER_CONTRACT'){
 if(!/^[A-Za-z0-9_-]+$/.test(ownerId)||!/^[A-Za-z0-9_-]+$/.test(taskId))throw new Error('文件地址无效。');
 return `/owner/api${contractBasePath(ownerId,domain)}/${taskId}/files/${kind}`;
}
export function authoritySection(authority:Authority):'current'|'attention'|'history'{
 if(authority.method!=='UNILATERAL_LETTER'&&!authority.document)return 'history';
 if(['WITHDRAWN','REVOKED','REJECTED','EXPIRED','CANCELLED'].includes(authority.status)||authority.document?.withdrawnAt||Date.parse(authority.scope.validUntil)<Date.now())return 'history';
 return authority.status==='SIGNED'?'current':'attention';
}
export function authorityGuidance(authority:Authority){
 if(authority.method!=='UNILATERAL_LETTER'&&!authority.document)return authority.status==='REVOKING'?'历史渠道授权正在撤销。只需查询最终结果；查询失败不代表撤销完成。':authority.status==='REVOKED'?'历史渠道授权已撤销，保留办理记录。':'历史渠道授权，与当前宁达单方授权书分开保存。请先查询；确认不再使用后再撤销。';
 if(authority.status==='WITHDRAWN'||authority.document?.withdrawnAt)return '本地授权已撤回，无需继续办理。已签文件仍保留。';
 if(['REJECTED','EXPIRED','CANCELLED'].includes(authority.status))return '本份授权办理已结束，无需继续签署。原文件和处理结果保留查阅。';
 if(Date.parse(authority.scope.validUntil)<Date.now())return '授权期间已结束，原文件和签署结果保留查阅；如需后续授权，请重新确认期间与范围。';
 if(authority.status==='SIGNED')return '授权书已签署。业务合同请到“业务合同”逐单确认签署；当前不会自动盖章。';
 if(authority.certificateMatchesCurrent===null)return '当前证书核验结果需更新。请先重新核验企业与证书状态，再判断本份授权是否可以继续签署。';
 if(authority.certificateMatchesCurrent===false)return '这份待签授权书使用旧证书，建议撤回；如需新授权，请核验企业后重新填写范围。系统不会自动撤回或替换文件。';
 return authority.status==='UNKNOWN'?'签署结果暂未确认，请先查询本份记录，避免重复办理。':'如仍需这份授权，请继续签署；重复或不再需要的待签件可撤回。';
}
