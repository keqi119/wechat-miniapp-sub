import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handoverChecklistRows} from '../src/contract/handover-checklist-view';

test('handover rows translate stored fact keys and preserve manual labels without mutating input',()=>{
 const input=[{label:'actualTimeAndPlace',value:'合成时间地点'},{label:'batteryLevel',value:0},{label:'accessoriesChecklist',value:false},{label:'conditionChecklist',value:'两行\n完整保留'},{label:'openItems',value:''},{label:'resolutionPlan',value:null},{label:'staffName',value:'合成人员'},{label:'人工中文条目',value:'现场原始记录'},{label:'车辆身份',value:'合成车辆'}],before=JSON.stringify(input);
 assert.deepEqual(handoverChecklistRows(input),[{label:'实际交接时间与地点',value:'合成时间地点'},{label:'交接时电量',value:'0'},{label:'随车物品核对',value:'否'},{label:'车辆状况核对',value:'两行\n完整保留'},{label:'未结事项',value:'未填写'},{label:'处理方案',value:'未填写'},{label:'现场工作人员',value:'合成人员'},{label:'人工中文条目',value:'现场原始记录'},{label:'车辆身份',value:'合成车辆'}]);assert.equal(JSON.stringify(input),before);
});
test('legacy object history preserves order, blank values and full long facts',()=>{const long='长文本与全部事实\n'.repeat(1000),input={actualTimeAndPlace:'旧版地点',batteryLevel:0,openItems:undefined,'旧版人工条目':long};const rows=handoverChecklistRows(input);assert.deepEqual(rows,[{label:'实际交接时间与地点',value:'旧版地点'},{label:'交接时电量',value:'0'},{label:'未结事项',value:'未填写'},{label:'旧版人工条目',value:long}]);});
test('nested historical facts and unlabeled entries remain readable without serializer syntax',()=>{const input=[{label:'额外核对',value:{batteryLevel:0,'备用钥匙':true,'照片说明':['前部清晰','后部清晰']}},{factKey:'conditionChecklist',value:'旧投影事实'},'未命名历史事实'];const rows=handoverChecklistRows(input);assert.deepEqual(rows,[{label:'额外核对',value:'交接时电量：0\n备用钥匙：是\n照片说明：1. 前部清晰\n2. 后部清晰'},{label:'车辆状况核对',value:'旧投影事实'},{label:'条目 3',value:'未命名历史事实'}]);assert.doesNotMatch(rows.map(row=>row.value).join('\n'),/"label"\s*:|"value"\s*:|batteryLevel/);});
test('empty collections do not invent facts and primitive zero remains a recorded value',()=>{for(const input of [undefined,null,[],{}])assert.deepEqual(handoverChecklistRows(input),[]);assert.deepEqual(handoverChecklistRows(0),[{label:'条目 1',value:'0'}]);});

test('unknown manual labels matching object prototype names are preserved literally',()=>{const input=['constructor','toString','__proto__'].map(label=>({label,value:'合成人工事实'}));assert.deepEqual(handoverChecklistRows(input),input);});

test('nested labeled objects preserve all additional saved facts recursively',()=>{const input=[{label:'车辆状况',value:{label:'右后门',value:'划痕',note:'长度5厘米',more:{label:'部位',value:'上缘',extra:'已现场拍照'},empty:null,count:0,checked:false,factKey:'conditionChecklist'}}];const before=JSON.stringify(input);assert.deepEqual(handoverChecklistRows(input),[{label:'车辆状况',value:'右后门：划痕\nnote：长度5厘米\nmore：部位：上缘\nextra：已现场拍照\nempty：未填写\ncount：0\nchecked：否'}]);assert.equal(JSON.stringify(input),before);});
