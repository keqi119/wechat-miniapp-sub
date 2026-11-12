type CooperationOwner={id:string;name:string};
type CooperationRegistration={status:'PENDING_AGREEMENT'|'CONFLICT';owners:CooperationOwner[]};

/** Registration is a read-only document association, never an effective cooperation. */
export function VehicleCooperation({entity}:{entity:Record<string,unknown>}){
 const owner=entity.cooperationOwner as CooperationOwner|null|undefined;
 const registration=entity.cooperationRegistration as CooperationRegistration|null|undefined;
 const candidates=registration?.owners??[];
 const conflict=registration?.status==='CONFLICT'||candidates.length>1;
 const pending=!owner&&!conflict&&candidates.length===1;
 const label=owner?.name??(conflict?'合作商待核对':pending?candidates[0].name:'未登记合作商');
 const note=owner&&conflict?'资料关联待核对':pending?'协议待补':null;
 return <span>{label}{note?<><br/><small className="muted">{note}</small></>:null}{conflict&&candidates.length?<><br/><small className="muted">登记候选：{candidates.map(candidate=>candidate.name).join('、')}</small></>:null}</span>;
}
