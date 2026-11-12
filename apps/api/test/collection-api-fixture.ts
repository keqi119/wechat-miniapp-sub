import {randomUUID} from 'node:crypto';
export const collectionNow=new Date('2026-10-31T08:00:00+08:00');
export const financeActor={id:'finance',role:'FINANCE',authVersion:1},adminActor={id:'admin',role:'ADMIN',authVersion:1},operationsActor={id:'operations',role:'OPERATIONS',authVersion:1};
export const collectionCommand=(revision=0)=>({revision,idempotencyKey:randomUUID()});
export const collectionError=(code:string)=>(error:any)=>error.getResponse?.().error?.code===code;
const clone=<T>(value:T):T=>structuredClone(value);
function matches(row:any,where:any):boolean{
 if(!where)return true;return Object.entries(where).every(([key,value]:any)=>{
  if(key==='AND')return(Array.isArray(value)?value:[value]).every((part:any)=>matches(row,part));if(key==='OR')return value.some((part:any)=>matches(row,part));if(key==='NOT')return !matches(row,value);
  if(key.includes('_')&&row?.[key]===undefined&&value&&typeof value==='object')return matches(row,value);const actual=row?.[key];
  if(value&&typeof value==='object'&&!(value instanceof Date)&&!Array.isArray(value))return Object.entries(value).every(([op,wanted]:any)=>op==='mode'?true:op==='is'?matches(actual,wanted):op==='in'?wanted.includes(actual):op==='notIn'?!wanted.includes(actual):op==='not'?!matches({x:actual},{x:wanted}):op==='equals'?actual===wanted:op==='lt'?actual<wanted:op==='lte'?actual<=wanted:op==='gt'?actual>wanted:op==='gte'?actual>=wanted:op==='contains'?String(actual??'').toLowerCase().includes(String(wanted).toLowerCase()):matches(actual||{},value));
  return actual instanceof Date&&value instanceof Date?actual.getTime()===value.getTime():actual===value;
 });
}
export function collectionFixture(){
 let sequence=0,tables:Record<string,any[]>={adminUser:[financeActor,adminActor,operationsActor].map(row=>({...row,active:true})),customer:[{id:'customer',name:'合成履约客户',mobile:'synthetic-phone',profile:{identitySecret:'never-expose'},sourceChannel:'PRIVATE_SOURCE'}],order:[{id:'order',customerId:'customer',status:'ACTIVE',revision:3}],bill:[]};
 const writes:{table:string;action:string;data:any}[]=[],locks:string[]=[],queries:any[]=[],tx:any={};
 const enrich=(table:string,row:any):any=>{const result=clone(row);if(table==='order')result.customer=clone(tables.customer.find(item=>item.id===row.customerId));if(table==='bill'){result.order=enrich('order',tables.order.find(item=>item.id===row.orderId));result.payments=tables.payment.filter(item=>item.billId===row.id).map(item=>enrich('payment',item));}if(table==='payment')result.refunds=clone(tables.refund.filter(item=>item.paymentId===row.id));if(table==='collectionCase'){result.bills=clone(tables.collectionCaseBill.filter(item=>item.caseId===row.id));result.actions=clone(tables.collectionAction.filter(item=>item.caseId===row.id));}return result;};
 const select=(row:any,fields:any):any=>{if(row==null)return row;if(!fields)return clone(row);return Object.fromEntries(Object.entries(fields).filter(([,value])=>value).map(([key,value]:any)=>[key,value===true?clone(row[key]):Array.isArray(row[key])?row[key].map((item:any)=>select(item,value.select)):select(row[key],value.select)]));};
 const names=['adminUser','customer','order','bill','payment','refund','collectionCase','collectionCaseBill','collectionAction','archiveCommand','auditLog'];
 for(const table of names){tables[table]??=[];tx[table]={
  findMany:async(args:any={})=>{queries.push({table,where:clone(args.where??{}),select:clone(args.select??null)});let rows=tables[table].map(row=>enrich(table,row)).filter(row=>matches(row,args.where));const ordering=args.orderBy?(Array.isArray(args.orderBy)?args.orderBy:[args.orderBy]):[];rows.sort((a,b)=>{for(const field of ordering)for(const [key,direction]of Object.entries(field)){const n=a[key]<b[key]?-1:a[key]>b[key]?1:0;if(n)return direction==='desc'?-n:n;}return 0;});return rows.slice(args.skip??0,args.take===undefined?undefined:(args.skip??0)+args.take).map(row=>select(row,args.select));},
  findFirst:async(args:any={})=>(await tx[table].findMany({...args,take:1}))[0]??null,
  findUnique:async(args:any)=>tx[table].findFirst(args),
  findUniqueOrThrow:async(args:any)=>{const row=await tx[table].findFirst(args);if(!row)throw Error('Missing '+table);return row;},
  count:async(args:any={})=>(await tx[table].findMany(args)).length,
  create:async({data,select:fields}:any)=>{const defaults=table==='collectionCase'?{revision:1,status:'ACTIVE',closedAt:null,closedBy:null,closeReason:null}:table==='collectionAction'?{method:null,actionType:null,result:null,content:null,promiseDate:null,promiseAmount:null,nextFollowUpDate:null}:{};const row={id:table+'-'+(++sequence),createdAt:collectionNow,updatedAt:collectionNow,linkedAt:collectionNow,...defaults,...clone(data)};tables[table].push(row);writes.push({table,action:'create',data:clone(data)});return select(enrich(table,row),fields);},
  updateMany:async({where,data}:any)=>{const rows=tables[table].filter(row=>matches(enrich(table,row),where));for(const row of rows){for(const[key,value]of Object.entries(data)as any)row[key]=value&&typeof value==='object'&&'increment'in value?(row[key]??0)+value.increment:clone(value);writes.push({table,action:'update',data:clone(data)});}return{count:rows.length};},
  update:async({where,data,select:fields}:any)=>{await tx[table].updateMany({where,data});return tx[table].findUnique({where,select:fields});},
 };}
 tx.$queryRaw=async(strings:TemplateStringsArray,...values:any[])=>{locks.push(strings.join('?')+' '+values.join(','));return[];};tx.$executeRaw=tx.$queryRaw;
 return{tx,writes,locks,queries,rows:(table:string)=>tables[table],seed:(table:string,row:any)=>tables[table].push(clone(row)),serial:async<T>(operation:(tx:any)=>Promise<T>):Promise<T>=>{const backup=clone(tables),count=writes.length;try{return await operation(tx);}catch(error){tables=backup;writes.splice(count);throw error;}},revoke:()=>{tables.adminUser.find(row=>row.id===financeActor.id).authVersion++;},bill:(id='bill',extra:any={})=>{const row={id,orderId:'order',customerId:'customer',type:'SUBSCRIPTION',status:'PENDING',amount:10000,paidAmount:0,dueDate:new Date('2026-10-30'),sequence:1,...extra};tables.bill.push(row);return row;},pay:(id='bill')=>{const bill=tables.bill.find(row=>row.id===id);bill.status='PAID';bill.paidAmount=bill.amount;const payment={id:'payment-'+id,billId:id,customerId:bill.customerId,revision:0,status:'SUCCEEDED',amount:bill.amount,providerTransactionId:'channel-'+id,reconciliationRequired:false,clientParameters:{secret:'NEVER_CHANNEL_SECRET'}};tables.payment.push(payment);return payment;}};
}
