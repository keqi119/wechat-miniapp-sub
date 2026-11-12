const {test}=require('node:test');
const assert=require('node:assert/strict');
const {renderPage}=require('./helpers/wxml-view.cjs');
test('handover page heading describes current facts and does not ask a completed customer to confirm again',()=>{
  for(const [status,title] of [['COMPLETED','交接已完成'],['CUSTOMER_CONFIRMED','本人意见已留存'],['OBJECTION_SUBMITTED','交接异议处理中'],['SUPERSEDED','历史交接记录']]){
    const h={id:'qa-handover',status,checklist:[],evidence:[],fileIds:[]};
    const output=renderPage('handover',{loading:false,subscription:{},handover:h,submitted:h,decision:status==='OBJECTION_SUBMITTED'?'dispute':'confirm',signing:{onlineRecord:true},canRespond:false});
    assert.ok(output.startsWith('车辆交接 '+title),status);
    assert.ok(!output.includes('我已阅读全部交接证据'),status);
    assert.ok(!output.includes('确认交接事实'),status);
  }
});
