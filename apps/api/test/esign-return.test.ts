import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {ESignPublicController} from '../src/esign/esign.controller';
test('provider return page offers native navigation without trusting URL signing claims or starting a query',()=>{
 let html='';const headers:Record<string,string>={};const response:any={type(){return this;},set(k:string,v:string){headers[k]=v;return this;},send(v:string){html=v;}};
 new ESignPublicController().returnPage(response);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(v=>v[1]).filter(Boolean);
 assert.ok(scripts.length);assert.equal(headers['Referrer-Policy'],'no-referrer');assert.equal(headers['Cache-Control'],'no-store');
 for(const miniprogram of [true,false]){
  const navigations:any[]=[],events:Record<string,Function>={},button:any={};
  const context:any={window:{},document:{getElementById:()=>button,addEventListener:(k:string,f:Function)=>events[k]=f},wx:{miniProgram:{getEnv:(f:Function)=>f({miniprogram}),navigateBack:(v:any)=>navigations.push(v)}},location:{search:'?status=SIGNED&redirect=https://evil.invalid'}};
  context.window=context;for(const script of scripts)runInNewContext(script,context);context.returnToMiniapp();events.WeixinJSBridgeReady();
  assert.equal(navigations.length,miniprogram?1:0);if(miniprogram)assert.equal(navigations[0].delta,1);
 }
});
