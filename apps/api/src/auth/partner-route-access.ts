import {getPartnerCapabilities,type PartnerCapability} from '../partners/capabilities';

const financeReads:PartnerCapability[]=['partner.rules.read','partner.accounts.read','partner.settlements.read','partner.payments.read'];
const financeWrites:PartnerCapability[]=['partner.rules.write','partner.accounts.write','partner.settlements.write','partner.payments.record'];
/** Route gate is deliberately coarse for file bodies; the domain rechecks exact file kind. */
export function partnerRouteAllowed(staff:any,path:string,method:string):boolean|null{
 const parts=path.toLowerCase().replace(/\/+$/,'').split('/').slice(2),resource=parts[0];
 if(!['partners','partner-revenue-rules','partner-settlements','offline-archives'].includes(resource))return null;
 const read=['GET','HEAD','OPTIONS'].includes(method),end=parts.at(-1),has=(key:PartnerCapability)=>getPartnerCapabilities(staff).includes(key);
 if(resource==='offline-archives')return ['ADMIN','OPERATIONS'].includes(staff.role)||has(read?'partner.cooperation.read':end==='review'?'partner.cooperation.review':'partner.cooperation.write');
 if(resource==='partners'){
  const direct=['ADMIN','OPERATIONS'].includes(staff.role);
  const simple=(parts.length===1&&(read||method==='POST'))
    ||(parts.length===2&&read)
    ||(parts.length===3&&parts[2]==='profile'&&['POST','PATCH'].includes(method))
    ||(parts.length===3&&parts[2]==='agreements'&&(read||method==='POST'))
    ||(parts.length===5&&parts[2]==='agreements'&&parts[4]==='stop'&&method==='POST')
    ||(parts.length===6&&parts[2]==='agreements'&&parts[4]==='files'&&read)
    ||(parts.length===3&&parts[2]==='company-admin'&&read)
    ||(parts.length===4&&parts[2]==='company-admin'&&['invitation','disable'].includes(parts[3])&&method==='POST')
    ||(parts.length===3&&parts[2]==='revenue'&&read);
  if(simple)return direct;
  if(parts.includes('identities'))return false;
  // The former candidate/reviewer workflow is history; it must never reopen
  // invitation access without the designated person's confirmation.
  if(parts[2]==='portal-access')return read&&has('partner.portal.read');
  return has(read?'partner.cooperation.read':end==='review'?'partner.cooperation.review':'partner.cooperation.write');
 }
 if(parts[1]==='owners'&&parts[3]==='files')return (read?financeReads:financeWrites).some(has);
 if(resource==='partner-revenue-rules')return has(read?'partner.rules.read':end==='review'?'partner.rules.review':'partner.rules.write');
 if(read&&parts[1]==='partners')return financeReads.some(has);
 if(parts[1]==='accounts')return has(read?'partner.accounts.read':end==='review'?'partner.accounts.review':'partner.accounts.write');
 if(!read&&parts[2]==='payments')return has(end==='reconcile'?'partner.payments.review':'partner.payments.record');
 return has(read?'partner.settlements.read':end==='review'?'partner.settlements.review':'partner.settlements.write');
}

export function partnerNavigationPermissions(staff:any):string[]{
 const grants=getPartnerCapabilities(staff);
 const scopes:Record<string,string[]>= {'partners':['partner.cooperation.','partner.portal.'],'partner-revenue-rules':['partner.rules.'],'partner-settlements':['partner.accounts.','partner.settlements.','partner.payments.']};
 return [...new Set([...(['ADMIN','OPERATIONS'].includes(staff.role)?['partners.read','partners.write']:[]),...Object.entries(scopes).flatMap(([resource,prefixes])=>{
  const values=grants.filter(key=>prefixes.some(prefix=>key.startsWith(prefix)));
  return [...(values.length?[`${resource}.read`]:[]),...(values.some(key=>!key.endsWith('.read'))?[`${resource}.write`]:[])];
 })])];
}
