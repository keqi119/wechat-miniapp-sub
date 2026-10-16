import{test}from'node:test';
import assert from'node:assert/strict';
import{listenForHttpTests}from'./http-listener';
test('HTTP test harness rejects an OS-assigned Fetch bad port and retries safely without closing the application',async()=>{
 let port=0,closed=0,calls=0;const app={listen:async(selected:number,host:string)=>{assert.equal(host,'127.0.0.1');port=selected===0?6000:selected;calls++;},getUrl:async()=>`http://127.0.0.1:${port}`,getHttpServer:()=>({close:(cb:()=>void)=>{closed++;cb();}})};
 const url=await listenForHttpTests(app);assert.equal(calls,2);assert.equal(closed,1);assert.ok(Number(new URL(url).port)>=20000);
});
