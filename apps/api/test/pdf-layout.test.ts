import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import PDFDocument from 'pdfkit';
import {ContractPdfRendererService} from '../src/contract/contract-pdf-renderer.service';
import {createStage1ContractPdfSigningSlots} from '../src/contract/contract-pdf-render-model';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
const font=[process.env.FADADA_CJK_FONT_PATH,'C:/Windows/Fonts/simhei.ttf','/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf'].find(path=>path&&existsSync(path));
async function draw(lines:number,fontPath=font,agreementKind='DELIVERY_DELAY_AMENDMENT'){
 const texts:{text:string;page:number}[]=[];let page=0,attached=false;
 const original=PDFDocument.prototype.text;
 PDFDocument.prototype.text=function(text:any,...args:any[]){if(!attached){attached=true;this.on('pageAdded',()=>{page++;});}texts.push({text:String(text),page});return(original as any).call(this,text,...args);};
 try{const result=await new ContractPdfRendererService().render({agreementKind,contractId:'synthetic',contractNo:'synthetic',orderNo:'synthetic-order',generatedAt:'2026-10-16',templateName:'延期交车补充协议',templateVersion:'1',contentTemplate:Array.from({length:lines},(_,i)=>`第${i+1}条：双方已确认本期服务金额及真实交付安排。`).join('\n'),subscriberParty:{subscriberName:'合成样张客户',subscriberIdNumber:'SYNTHETIC-ONLY',subscriberContactAddress:'合成地址',subscriberContactPhone:'',subscriberContactName:'合成样张客户',subscriberEmail:'',subscriberWechat:''},signingStage:'STAGE1_CONTRACT',signingSlots:createStage1ContractPdfSigningSlots(),appendix:{sections:[{title:'双方已确认安排',rows:[{label:'金额',value:'人民币1.00元'}]}]}}as any,{cjkFontPath:fontPath});return{...result,texts};}finally{PDFDocument.prototype.text=original;}
}
test('delay PDF identifies its own agreement and omits placement debugging text',{skip:!font},async()=>{
 const result=await draw(12);assert.equal(result.texts[0].text,'延期交车补充协议');assert.equal(result.texts.some(x=>x.text.includes('Offset intent')),false);
});
test('each signing section title and both physical slots stay on the same page near page boundaries',{skip:!font},async()=>{
 for(const lines of [12,18,24,30,36,42]){const result=await draw(lines);for(const [title,prefix]of [['合同正文签署区','STAGE1_BODY_'],['附件1签署区','STAGE1_ATTACHMENT1_']]){const heading=result.texts.find(x=>x.text===title)!;assert.ok(heading);const slots=result.slotCoordinates.filter(x=>x.slotId.startsWith(prefix));assert.equal(slots.length,2);for(const slot of slots){assert.equal(slot.pageNumber,heading.page,`${lines} lines: ${title} must accompany ${slot.slotId}`);assert.ok(slot.y>0&&slot.y<1131);}}}
});
test('handover uses the same deployable CJK face and preserves two rendered signature coordinates',{skip:!font},async()=>{
 const writer=new ContractPdfArtifactWriterService({storedFile:{findMany:async()=>[]}}as any);
 const result=await(writer as any).renderHandover({id:'synthetic-handover',orderId:'synthetic-order',manifestHash:'a'.repeat(64),confirmedAt:new Date('2026-10-16T00:00:00Z'),readingKm:12000,checklist:{actualTimeAndPlace:'合成核验地点'},fileIds:[]},{version:1,content:'合成交接记录，金额¥1.00。'},{name:'合成客户',idCardNo:'SYNTHETIC-ONLY'},font);
 assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-');assert.equal(result.slotCoordinates.length,2);assert.equal(result.slotCoordinates[0].pageNumber,result.slotCoordinates[1].pageNumber);
});

const productionFont='../../.runtime/delivery-delay-pdf-qa/fonts/NotoSansCJK-Regular.ttc';
const layoutFonts=[...new Set([font,existsSync(productionFont)?productionFont:undefined].filter(Boolean))] as string[];
type DrawnBox={x:number;y:number;width:number;height:number;page:PDFKit.PDFPage};
async function captureBoxes(run:()=>Promise<any>){
 const boxes:DrawnBox[]=[];const original=PDFDocument.prototype.rect;
 PDFDocument.prototype.rect=function(x:number,y:number,width:number,height:number){boxes.push({x,y,width,height,page:this.page});return original.call(this,x,y,width,height);};
 try{return{result:await run(),boxes};}finally{PDFDocument.prototype.rect=original;}
}
function assertContained(slots:any[],boxes:DrawnBox[]){
 assert.equal(boxes.length,slots.length,'every signature needs a visible reserved box');
 slots.forEach((slot,i)=>{
  const box=boxes[i],appearance=slot.slotId.endsWith('_PLATFORM')?{width:124,height:124}:{width:100,height:45};
  const x=slot.x/800*box.page.width,y=slot.y/1131*box.page.height;
  assert.ok(Math.abs(x-box.x-box.width/2)<.02,'provider X is the image centre');
  assert.ok(Math.abs(y-box.y-box.height/2)<.02,'provider Y is the image centre');
  assert.ok(x-appearance.width/2>=box.x+10&&x+appearance.width/2<=box.x+box.width-10,'actual appearance needs horizontal padding');
  assert.ok(y-appearance.height/2>=box.y+10&&y+appearance.height/2<=box.y+box.height-10,'actual appearance needs vertical padding');
  assert.ok(box.y>=box.page.margins.top&&box.y+box.height<=box.page.height-box.page.margins.bottom,'reserved box must fit the printable page');
  if(i>0&&boxes[i-1].page===box.page)assert.ok(box.y>=boxes[i-1].y+boxes[i-1].height+30,'signer labels must not overlap the previous box');
 });
}
test('contract and amendment PDFs reserve real signature sizes with their headings across fonts and page boundaries',{skip:!font},async()=>{
 for(const fontPath of layoutFonts)for(const kind of ['SUBSCRIPTION_STANDARD','DELIVERY_DELAY_AMENDMENT','VEHICLE_SWAP_SUPPLEMENT'])for(const lines of [0,12,18,24,30,42]){
  const{result,boxes}=await captureBoxes(()=>draw(Math.max(1,lines),fontPath,kind));
  assert.equal(result.slotCoordinates.length,4);assertContained(result.slotCoordinates,boxes);
  for(const[title,prefix]of [['合同正文签署区','STAGE1_BODY_'],['附件1签署区','STAGE1_ATTACHMENT1_']]){
   const heading=result.texts.find((t:any)=>t.text===title);assert.ok(heading);
   for(const slot of result.slotCoordinates.filter((s:any)=>s.slotId.startsWith(prefix)))assert.equal(slot.pageNumber,heading.page,`${kind}/${lines}/${fontPath}: heading and signatures stay together`);
  }
 }
});
test('handover provider centres and real appearance bounds match both drawn signing boxes',{skip:!font},async()=>{
 for(const fontPath of layoutFonts){
  const writer=new ContractPdfArtifactWriterService({storedFile:{findMany:async()=>[]}}as any);
  const{result,boxes}=await captureBoxes(()=>(writer as any).renderHandover({id:'synthetic-handover',orderId:'synthetic-order',manifestHash:'a'.repeat(64),confirmedAt:new Date('2026-10-16T00:00:00Z'),readingKm:12000,checklist:{actualTimeAndPlace:'合成核验地点'},fileIds:[]},{version:1,content:'合成交接记录。'.repeat(250)},{name:'合成客户',idCardNo:'SYNTHETIC-ONLY'},fontPath));
  assert.equal(result.slotCoordinates.length,2);assertContained(result.slotCoordinates,boxes);
  assert.equal(boxes[0].page,boxes[1].page);assert.equal(result.slotCoordinates[0].pageNumber,result.slotCoordinates[1].pageNumber);
 }
});

async function drawHandoverChecklist(checklist:any,fontPath=existsSync(productionFont)?productionFont:font){
 const texts:Array<{text:string;page:number;y:number}>=[];const original=PDFDocument.prototype.text;let page=0,attached=false;
 PDFDocument.prototype.text=function(value:any,...args:any[]){if(!attached){attached=true;this.on('pageAdded',()=>{page++;});}texts.push({text:String(value),page,y:this.y});return(original as any).call(this,value,...args);};
 try{const writer=new ContractPdfArtifactWriterService({storedFile:{findMany:async()=>[]}} as any);const captured=await captureBoxes(()=>(writer as any).renderHandover({id:'synthetic-checklist',orderId:'synthetic-order',manifestHash:'a'.repeat(64),confirmedAt:new Date('2026-10-26T00:00:00Z'),readingKm:0,checklist,fileIds:[]},{version:1,content:'合成测试交接记录，仅核对实际事实，不代表真实签署。'},{name:'合成客户',idCardNo:'SYNTHETIC-ONLY'},fontPath));return{...captured,texts};}finally{PDFDocument.prototype.text=original;}
}

test('handover checklist renders Chinese human rows instead of stored JSON without altering facts or slots',{skip:!font},async()=>{
 const checklist=[{label:'actualTimeAndPlace',value:'2026年10月26日，合成测试停车场'},{label:'batteryLevel',value:'90%'},{label:'accessoriesChecklist',value:'主钥匙、备用钥匙各一把'},{label:'conditionChecklist',value:'左侧车门有一道细痕\n照片见证据附件'},{label:'openItems',value:''},{label:'resolutionPlan',value:'已约定现场拍照并注明'},{label:'staffName',value:'合成工作人员'},{label:'人工补充清单',value:'纸质车辆资料已随车交付'},{label:'车辆身份',value:'合成测试车辆，不用于真实交易'}],before=JSON.stringify(checklist);
 const {result,texts,boxes}=await drawHandoverChecklist(checklist);assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-');const content=texts.map(row=>row.text).join('\n');
 for(const label of ['实际交接时间与地点','交接时电量','随车物品核对','车辆状况核对','未结事项','处理方案','现场工作人员','人工补充清单','车辆身份'])assert.ok(content.includes(label),`missing readable label ${label}`);
 for(const value of checklist.map(row=>row.value).filter(Boolean))assert.ok(content.includes(value),`missing persisted fact ${value}`);
 assert.match(content,/未填写/);assert.doesNotMatch(content,/"(?:label|value)"\s*:|actualTimeAndPlace|batteryLevel|accessoriesChecklist|conditionChecklist|openItems|resolutionPlan|staffName/);assert.equal(JSON.stringify(checklist),before);assert.equal(result.slotCoordinates.length,2);assertContained(result.slotCoordinates,boxes);assert.equal(boxes[0].page,boxes[1].page);
});

test('handover checklist preserves object history, empty and long facts through normal page flow',{skip:!font},async()=>{
 const long=Array.from({length:90},(_,i)=>`合成长段${String(i+1).padStart(3,'0')}：这一事实说明必须完整保留，涵盖交接证据、车辆状况和双方确认的安排。`).join('\n');const checklist={actualTimeAndPlace:'合成测试地点',batteryLevel:0,accessoriesChecklist:false,conditionChecklist:long,openItems:null,resolutionPlan:'现场记录全部保留',staffName:'历史合成人员','历史人工中文项':'全部事实不丢弃'};const before=JSON.stringify(checklist),{result,texts,boxes}=await drawHandoverChecklist(checklist);
 const content=texts.map(row=>row.text).join('\n');assert.match(content,/实际交接时间与地点/);assert.ok(content.includes(long));assert.match(content,/历史人工中文项/);assert.ok(texts.some(row=>row.text==='0'));assert.ok(texts.some(row=>row.text==='否'));assert.match(content,/未填写/);assert.doesNotMatch(content,/actualTimeAndPlace|batteryLevel|accessoriesChecklist|"conditionChecklist"\s*:/);assert.equal(JSON.stringify(checklist),before);assertContained(result.slotCoordinates,boxes);assert.equal(boxes[0].page,boxes[1].page);assert.ok(result.slotCoordinates[0].pageNumber>=2,'long facts flow to additional pages before the signature sheet');
});

test('handover checklist retains nested notes in actual extracted PDF text',{skip:!font},async(t)=>{
 const checklist=[{label:'车辆状况',value:{label:'右后门',value:'划痕',note:'长度5厘米'}}],before=JSON.stringify(checklist);const {result}=await drawHandoverChecklist(checklist);const {spawnSync}=await import('node:child_process');const extracted=spawnSync(process.env.PDF_TEXT_PYTHON||'python',['-c','import io,sys; from pypdf import PdfReader; sys.stdout.reconfigure(encoding="utf-8"); print("\\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:result.buffer,encoding:'utf8'});if(extracted.error&&(extracted.error as NodeJS.ErrnoException).code==='ENOENT'||extracted.stderr?.includes("No module named 'pypdf'")){t.skip('Python pypdf is unavailable; set PDF_TEXT_PYTHON to the bundled runtime');return;}assert.equal(extracted.status,0);const text=extracted.stdout.replace(/\s+/g,'');assert.ok(text.includes('右后门：划痕'));assert.ok(text.includes('note：长度5厘米'),'nested stored note must be in the actual PDF');assert.doesNotMatch(text,/"label":|"value":/);assert.equal(JSON.stringify(checklist),before);
});
