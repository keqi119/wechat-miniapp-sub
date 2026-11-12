// Local synthetic fixture only. Uses the real App + OrderWorkspace mount; no provider/DB.
import {createServer} from '../node_modules/vite/dist/node/index.js';

const steps=['APPLICATION','CONTRACT','PAYMENT','DELIVERY','IN_USE','RETURN','SETTLEMENT'];
const task=(i,orderId='fixture-order')=>({id:'task-'+i,orderId,kind:i%3===0?'RENEWAL':i%3===1?'SUBSCRIPTION':'VEHICLE_SWAP',status:i===1?'PREPARED':i===2?'WITHDRAWN':i===3?'SIGNED':'ARCHIVED',revision:i+1,sourceSha256:'a'.repeat(64),parties:['CUSTOMER','OWNER','PLATFORM'].map(role=>({role,mode:'MANUAL',status:i===1?'PENDING':'SIGNED',signedAt:i===1?null:'2026-11-01T02:00:00Z'})),nextAction:{code:i===1?'V31_GRANT_REVOKED':null,kind:i===1?'UPLOAD':i===3?'ARCHIVE':'DONE'},stopStatus:i===2?'NEEDS_REVIEW':null,evidenceReviewStatus:i===4?'ORIGINAL_CERTIFICATE_REQUIRED':null,legalCompletedAt:i===1?null:'2026-11-01T02:00:00Z',archivedAt:i===1||i===2||i===3?null:'2026-11-01T03:00:00Z',filingStatus:i===1?'NOT_STARTED':i===3?'UNKNOWN':'CONFIRMED',finalFileAvailable:i!==3&&i!==1,archive:i===1||i===2||i===3?null:{status:'ARCHIVED',version:i+1,contractNumber:'SYNTHETIC-'+i},frozenSources:{sourceHash:'a'.repeat(64),cooperationVersionId:'frozen-cooperation-original'}});
const order=id=>({id,orderNo:'本地合成验收 · '+id,status:'AWAITING_SIGNATURE',contractMode:'ELECTRONIC',revision:7,customer:{id:'fixture-customer',name:'本地合成客户'},vehicle:{id:'fixture-vehicle',title:'本地合成车辆'},vehicleId:'fixture-vehicle',createdAt:'2026-11-01T00:00:00Z'});
let partner={id:'fixture-owner',name:'本地合成出租企业',subjectType:'ENTERPRISE',creditCode:'91310000SYNTHETIC00',revision:2,status:'VERIFIED',address:'合成注册地址',contactPhone:'13800000000',agreements:[],vehicles:[],pendingVehicles:[],allowedActions:{electronicCooperation:true}};
let application={id:'fixture-application',revision:4,status:'IN_REVIEW',customerId:'fixture-customer',customer:{name:'本地合成客户'},vehicle:{title:'本地合成车辆'},profile:{name:'本地合成客户'},createdAt:'2026-11-01T00:00:00Z'};
const fixtureMiddleware=(req,res,next)=>{
 const role=(req.headers.cookie||'').match(/fixture-role=(ADMIN|OPERATIONS|FINANCE|SUPPORT)/)?.[1]||'ADMIN';
 const permissions=['orders.read','electronic-documents.read',...(['ADMIN','OPERATIONS'].includes(role)?['orders.write','electronic-documents.write','customers.read','products.read','products.write','model-definitions.read','vehicles.read','partners.read','partners.write','legal-documents.read','applications.read','applications.write']:[])];
 const url=new URL(req.url,'http://127.0.0.1');
 const switchRole=url.pathname.match(/^\/__fixture\/role\/(ADMIN|OPERATIONS|FINANCE|SUPPORT)$/);if(switchRole){res.setHeader('Set-Cookie','fixture-role='+switchRole[1]+'; SameSite=Strict; Path=/');res.statusCode=302;res.setHeader('Location','/#orders?record=fixture-order&view=contracts');return res.end();}
 if(url.pathname==='/__fixture/final-plan'){res.setHeader('Content-Type','text/html');return res.end('<div id="root"></div><script type="module" src="/scripts/v31-task10c2-final-plan.tsx"></script>');}
 if(!url.pathname.startsWith('/api/'))return next();
 const path=url.pathname.slice(4);res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 const send=value=>res.end(JSON.stringify(value));
 if(path==='/admin/auth/me')return send({user:{id:'synthetic-'+role,username:'本地合成 '+role,name:'本地合成 '+role,role,permissions},csrfToken:'local-fixture-not-real'});
 if(req.method==='POST'&&path==='/admin/applications/fixture-application/final-plan'){let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);console.log('SYNTHETIC_FINAL_PLAN_SAVED',JSON.stringify(body));application={...application,revision:5,finalPlan:{...body,id:'synthetic-plan',revision:5,commercialHash:'b'.repeat(64),creditRevision:1,creditBand:'B700_749',creditRuleVersion:'ZHIMA_MANUAL_V1',contractMode:'ELECTRONIC',reviewStatus:'DRAFT'}};send(application);});return;}
 if(path==='/admin/applications')return send({items:[application],total:1,page:1,pageSize:12});
 if(path==='/admin/applications/fixture-application')return send(application);
 if(path==='/admin/applications/fixture-application/credit-review')return send({applicationId:'fixture-application',creditRevision:1,ruleVersion:'ZHIMA_MANUAL_V1',status:'VERIFIED',document:{id:'credit-doc',type:'credit-verification',version:1,title:'合成信用规则',content:'合成内容'},consent:{id:'consent',status:'ACCEPTED',documentId:'credit-doc',version:1},verification:{id:'verification',band:'B700_749',consentId:'consent'},verificationCurrent:true,consentRequirementsMet:true,canVerify:false,canConsent:false,canWithdraw:true,canFinalize:true,depositMultiplier:1});
 if(path==='/admin/customers/fixture-customer/qualifications')return send({customerId:'fixture-customer',revision:1,current:{status:'APPROVED'},items:[{id:'qualification',status:'APPROVED',submittedBy:'synthetic-other',reviewedBy:'synthetic-admin'}]});
 if(path==='/admin/applications/fixture-application/risk-reviews')return send({applicationId:'fixture-application',current:{status:'PENDING'},review:null});
 if(req.method==='POST'&&path==='/admin/partners/fixture-owner/profile'){let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);partner={...partner,...body.profile,revision:partner.revision+1};console.log('SYNTHETIC_PROFILE_SAVED',JSON.stringify(body));send(partner);});return;}
 if(path==='/admin/partners')return send([partner,{...partner,id:'fixture-platform',name:'上海宁达信息科技有限公司'}]);
 if(path==='/admin/partners/fixture-owner')return send(partner);
 if(path==='/admin/partners/fixture-platform')return send({...partner,id:'fixture-platform',name:'上海宁达信息科技有限公司'});
 if(path.endsWith('/company-admin'))return send({status:'UNSET',revision:0});
 if(path.includes('/authorities/'))return send({items:[]});
 if(path.endsWith('/revenue'))return send({items:[],total:0,totals:{},groups:[]});
 if(path==='/admin/vehicles')return send({items:[{id:'fixture-vehicle',title:'本地合成车辆',plateNumber:'沪合成001'}],total:1});
 if(path==='/admin/model-definitions')return send({items:[],total:0});
 if(path==='/admin/benefit-definitions')return send([]);
 if(path==='/admin/applications/fixture-application/final-plan-defaults')return send({applicationId:'fixture-application',revision:application.revision,contractMode:'ELECTRONIC',source:{productId:'p',productVersionId:'pv',version:1,name:'合成6个月产品',hash:'a'.repeat(64)},values:{monthlyFeeAmount:30000,months:6,mileagePerMonthKm:1000,excessMileagePriceAmount:100,energyDescription:'充换电自付',conditions:'真实约定',benefits:[],productSourceHash:'a'.repeat(64),commercialTerms:{vehicleIdentification:'合成VIN与车辆',customerAddress:'合成客户地址',handoverArrangement:'合成交付地点；合成现场联系人'},agreedFeeComponents:{baseFeeAmount:10000,mileageMonthlyFeeAmount:20000}},missingFields:[]});
 if(path==='/admin/products')return send([]);
 if(path==='/admin/legal-documents')return send([]);
 if(req.method!=='GET'){res.statusCode=403;return send({error:{code:'FIXTURE_READ_ONLY',message:'本地合成验收禁止外部动作'}});}
 if(path==='/admin/customers/fixture-customer')return send({id:'fixture-customer',name:'本地合成客户',mobile:'138****0000',status:'ACTIVE'});
 if(path==='/admin/orders')return send({items:[order('fixture-order'),order('fixture-empty')],total:2,page:1,pageSize:20});
 const m=path.match(/^\/admin\/orders\/([^/]+)(\/workspace)?$/);if(m){const id=m[1];if(!m[2])return send(order(id));return send({orderId:id,mode:'ELECTRONIC',contracts:[],billing:[],handovers:[],timeline:[],process:{version:1,orderId:id,orderRevision:7,currentStep:'CONTRACT',steps:steps.map(key=>({key,label:key==='CONTRACT'?'合同与协议':key,state:key==='CONTRACT'?'CURRENT':'WAITING',summary:'本地合成流程；无真实业务动作',checks:[],actions:[]})),blockers:[],attention:[],related:{archives:[],bills:[],tasks:[],handovers:[],settlements:[]}}});}
 if(path==='/admin/electronic-documents/workspace/fixture-error'){res.statusCode=503;return send({error:{code:'SYNTHETIC_READ_ERROR',message:'本地合成读取失败；不得沿用旧资料提交'}});}
 const w=path.match(/^\/admin\/electronic-documents\/workspace\/([^/]+)$/);if(w)return send({orderId:w[1],channel:{configured:true,signingEnabled:true},permissions:{prepare:permissions.includes('electronic-documents.write')},readiness:[{kind:'SUBSCRIPTION',resourceId:w[1],revision:7,canPrepare:false,missing:[{field:'CUSTOMER.address',actionUnused:true,reason:'本地合成：企业法律联系资料待补',responsibleRole:'OWNER_LEGAL',action:{enabled:permissions.includes('partners.read'),href:'#partners?record=fixture-owner'}}],externalVerification:{status:'UNKNOWN',reason:'本地合成；真实渠道待主控验收'}}],related:{handovers:[],renewalCancellations:[],notices:[],refunds:[]},sources:{orderId:w[1]}});
 if(path==='/admin/electronic-documents'){const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20),empty=url.searchParams.get('orderId')==='fixture-empty';return send({items:empty?[]:Array.from({length:Math.min(pageSize,103-(page-1)*pageSize)},(_,i)=>task((page-1)*pageSize+i)),total:empty?0:103,page,pageSize});}
 if(path==='/admin/electronic-documents/workspace/fixture-error'){res.statusCode=503;return send({error:{code:'SYNTHETIC_READ_ERROR',message:'本地合成读取失败；不得沿用旧资料提交'}});}
 const d=path.match(/^\/admin\/electronic-documents\/task-(\d+)(\/dependencies)?$/);if(d&&d[1]==='1'&&!d[2])return setTimeout(()=>send(task(1)),1200);if(d)return send(d[2]?{items:[{...task(88),id:'frozen-cooperation-original',kind:'COOPERATION',orderId:null}]}:task(Number(d[1])));
 res.statusCode=404;send({error:{code:'FIXTURE_ROUTE_UNIMPLEMENTED',message:'本地合成未提供此来源路由'}});
};
const vite=await createServer({root:new URL('../',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),configFile:false,plugins:[{name:'synthetic-local-api',configureServer(server){server.middlewares.use(fixtureMiddleware);}}],server:{host:'127.0.0.1',port:3198,strictPort:true}});
await vite.listen();console.log('Synthetic actual App mounted: http://127.0.0.1:3198/#orders?record=fixture-order&view=contracts');
