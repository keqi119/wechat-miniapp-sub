import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../src/esign/native-fadada-adapter';
import {assertSignerResult} from '../src/esign/fadada/fadada-safety';
import {FadadaApiClient} from '../src/esign/fadada/fadada-api.client';
import {FadadaHttpClient} from '../src/esign/fadada/fadada-http-client';
import {FadadaESignGateway} from '../src/esign/fadada/fadada-esign.provider';
const config:any={enabled:true,appId:'synthetic',appSecret:'synthetic-secret',baseUrl:'https://textapi17.fadada.com/api2/',apiVersion:'2.0',requestTimeoutMs:1000};
const expected={contractId:'envelope1',customerId:'customer1',transactionId:'transaction1'};
const fixture=()=>({code:1,data:{result:'3000',result_desc:'签章成功',endTime:'2026-10-16 23:10:00',download_url:'https://unused.invalid/download',view_url:'https://unused.invalid/view'},msg:'success'});
async function query(raw:any,settings=config,native=true){
 let sent:any;const transport:any=async(r:any)=>{sent=r;return{status:200,headers:{},bodyText:JSON.stringify(raw)};};
 const http=native?new NativeAwareFadadaHttp(settings,transport):new FadadaHttpClient(settings,transport);
 const client=native?new NativeAwareFadadaClient(settings,http):new FadadaApiClient(settings,http);
 return{result:await client.querySignResult(expected),sent,client};
}
test('official result without echoed IDs is bound to the exact signed query, never a different signer',async()=>{
 const {result,sent}=await query(fixture());const params=new URLSearchParams(sent.body);
 assert.equal(sent.url,'https://textapi17.fadada.com/api2/query_sign_result.api');assert.equal(params.get('customer_id'),'customer1');assert.equal(params.get('transaction_id'),'transaction1');assert.ok(params.get('msg_digest'));
 assert.equal(result.status,'SIGNED');assert.equal(result.providerCustomerId,undefined);
 assert.doesNotThrow(()=>assertSignerResult(result,expected));
 for(const key of ['contractId','customerId','transactionId'])assert.throws(()=>assertSignerResult(result,{...expected,[key]:'another'}));
 assert.throws(()=>assertSignerResult(JSON.parse(JSON.stringify(result)),expected));
});
test('plain SDK results and unapproved endpoint cannot create trusted query binding',async()=>{
 const plain=await query(fixture(),config,false);assert.throws(()=>assertSignerResult(plain.result,expected));
 await assert.rejects(query(fixture(),{...config,baseUrl:'https://unapproved.invalid/api2/'}));
});
test('error envelope, conflicting echo and mutated response never authorize signed state',async()=>{
 const echo={contract_id:expected.contractId,customer_id:expected.customerId,transaction_id:expected.transactionId};
 for(const raw of [{...fixture(),code:0},{...fixture(),transaction_id:'another'},{...fixture(),data:{...fixture().data,customerId:'another'}},{...fixture(),data:{...fixture().data,result:'unrecognized'}},{...fixture(),...echo,code:0},{...fixture(),...echo,extra:{customer_id:'another'}}]){
  const {result}=await query(raw);assert.throws(()=>assertSignerResult(result,expected));
 }
 const {result}=await query(fixture());(result.raw as any).data.result='9999';assert.throws(()=>assertSignerResult(result,expected));
});
test('documented pending and failure codes remain distinct from a completed signature',async()=>{
 for(const [value,want]of [['9999','UNKNOWN'],['3001','FAILED'],['3002','FAILED'],['3003','FAILED']]){
  const {result}=await query({...fixture(),data:{...fixture().data,result:value}});assert.equal(result.status,want);assert.doesNotThrow(()=>assertSignerResult(result,expected));
 }
});
test('production query transport refuses redirects instead of sending signed parameters to another origin',async t=>{
 t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{
  if(init.redirect==='error')throw new TypeError('redirect disallowed');
  return new Response(JSON.stringify(fixture()),{status:200});
 });
 const client=new NativeAwareFadadaClient(config,new NativeAwareFadadaHttp(config));
 await assert.rejects(client.querySignResult(expected),/redirect disallowed/);
});
test('only authenticated official empty-record response permits the initial enterprise seal branch',async()=>{
 const task={providerEnvelopeId:'envelope1',platformProviderId:'customer1',platformTransactionId:'transaction1'};
 for(const code of [1201,0,-1]){
  const {client}=await query({code,data:null,msg:'签署记录为空'});
  const gateway:any=new FadadaESignGateway(null as any,config,client,null as any,null as any);
  if(code===1201)assert.equal((await gateway.providerStatus(task,true)).absent,true);
  else await assert.rejects(gateway.providerStatus(task,true));
 }
});
