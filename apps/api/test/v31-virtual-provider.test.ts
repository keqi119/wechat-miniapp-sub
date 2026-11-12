import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectSigningModes} from '../src/electronic-documents/policy';
import {esignNow,signingContext,signingParties} from './electronic-fixtures';
import {ElectronicProvider} from '../src/electronic-documents/provider';
import {runBoundElectronicOperation} from '../src/offline-documents/mode';
import {createHash} from 'node:crypto';
test('virtual MANUAL_ONLY cannot consume otherwise valid automatic authority',()=>{
 const context={...signingContext(),signaturePolicy:'MANUAL_ONLY'};
 assert.equal(selectSigningModes(signingParties(),esignNow,context as any).modes.OWNER,'MANUAL');
 assert.equal(selectSigningModes(signingParties(),esignNow,context as any).modes.PLATFORM,'MANUAL');
});
test('bound virtual dispatch rechecks on every real adapter call while recovery remains available',async()=>{
 const saved={...process.env};Object.assign(process.env,{NEW_ORDER_CONTRACT_MODE:'OFFLINE',ESIGN_NEW_REQUESTS_ENABLED:'true',ELECTRONIC_SIGNING_ENABLED:'true'});
 let requests=0,current=true,checks=0;const bytes=Buffer.from('%PDF-1.7\n'+('synthetic '.repeat(30))+'\n%%EOF'),doc={providerContractId:'SyntheticVirtual',sourceSha256:createHash('sha256').update(bytes).digest('hex'),title:'合成虚拟验收',positions:{}};
 const provider=new ElectronicProvider({enabled:true,signingEnabled:true,baseUrl:'https://textapi17.fadada.com/api2/',appId:'synthetic',appSecret:'synthetic',apiVersion:'2.0',requestTimeoutMs:1000} as any,async()=>{requests++;return{status:200,headers:{},bodyText:JSON.stringify({code:'1000',result:'success',contract_status:0})};});
 try{await assert.rejects(provider.upload(doc,bytes));assert.equal(requests,0);await runBoundElectronicOperation(async()=>{checks++;assert.ok(current,'scope revoked');},async()=>{await provider.upload(doc,bytes);current=false;await assert.rejects(provider.upload(doc,bytes));});assert.equal(requests,1);assert.ok(checks>=3);await provider.queryFiling(doc);assert.equal(requests,2);}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
