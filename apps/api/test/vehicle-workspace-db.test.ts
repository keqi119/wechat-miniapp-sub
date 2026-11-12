import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {assertNotAssetFiles} from '../src/files/asset-files';
import {VehicleInspectionsController} from '../src/vehicle-inspections/controller';
import {access} from 'node:fs/promises';

test('private inspection uploads and per-goods snapshots round-trip through HTTP and revoke every public file route',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();
  const car=await h.post('/admin/vehicles',{brand:'合成',model:'EV',title:'查验-'+h.prefix,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,conditionDisclosure:'仅本地合成资料',mediaFileIds:[],...command()});
  const other=await h.post('/admin/vehicles',{brand:'合成',model:'EV',title:'另一车-'+h.prefix,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,conditionDisclosure:'仅本地合成资料',mediaFileIds:[],...command()});
  const path=`/admin/vehicles/${car.id}`,otherPath=`/admin/vehicles/${other.id}`;
  for(const role of [h.finance,h.support,h.field])assert.equal((await h.raw(path+'/inspections',undefined,role)).status,403);
  const fileKey=randomUUID(),bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
  const form=()=>{const f=new FormData();f.set('idempotencyKey',fileKey);f.set('file',new Blob([bytes],{type:'image/png'}),'检测.png');return f;};
  const [file,replay]=await Promise.all([h.post(path+'/inspection-files',form()),h.post(path+'/inspection-files',form())]);assert.deepEqual(file,replay);
  assert.equal((await h.get(path+'/inspection-files')).items.length,1);assert.equal((await h.get('/admin/vehicles/'+car.id)).revision,car.revision);
  let checkedPath='';await new VehicleInspectionsController(h.db).image(car.id,file.id,{admin:await h.db.adminUser.findUnique({where:{id:h.maker.id}})},{setHeader(){},sendFile(path:string){checkedPath=path;}});await access(checkedPath);
  assert.equal((await fetch(h.base+file.url,{headers:h.maker.headers})).status,200,'authenticated file streaming after binding/path checks');
  assert.equal((await h.raw(otherPath+'/inspection-files/'+file.id)).status,404);
  assert.equal((await h.raw('/admin/files/'+file.id)).status,403);assert.equal((await fetch(h.base+'/api/public/media/'+file.id)).status,404);
  const input={...command(),title:'第三方查验',provider:'合成检测机构',inspectedAt:'2026-11-03',description:'冻结时车况',imageFileIds:[file.id]};
  let report=await h.post(path+'/inspections',input);const report2=await h.post(path+'/inspections',{...input,...command(),title:'第二条查验'});
  assert.notEqual(report.id,report2.id);assert.equal((await h.get(path+'/inspections')).items.length,2);
  assert.equal((await h.raw(otherPath+'/inspections',{...input,...command()})).status,409);
  const listings:any[]=[];
  for(const months of [12,24]){
   const product=await h.post('/admin/products',{...command(),name:'合成产品'+months,months,monthlyFeeAmount:198000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充换电自付',conditions:'仅本地',vehicleIds:[car.id],modelDefinitionIds:[],items:[{kind:'BASE_SUBSCRIPTION'}]});
   await h.post(`/admin/products/${product.productId}/publish`,{...command(product.revision),versionId:product.id});
   const draft=await h.post('/admin/goods',{...command(),vehicleId:car.id,productVersionId:product.id,visible:true,recommended:false,sortOrder:months});assert.deepEqual(draft.inspectionSelections,[]);
   listings.push(await h.post(`/admin/goods/${draft.id}/publish`,command(draft.revision)));
  }
  await h.post(path+'/publish',command(car.revision));
  let listing=await h.post('/admin/goods/'+listings[0].id,{...command(listings[0].revision),inspectionSelections:[{id:report.id,revision:report.revision}]},h.maker,'PATCH');
  const publicUrl=`/api/public/goods/${listing.id}/inspection-images/${file.id}`;
  let catalog=await h.get('/public/vehicles/'+car.id);assert.equal(catalog.plans.find((p:any)=>p.listingId===listing.id).inspections[0].description,'冻结时车况');assert.deepEqual(catalog.plans.find((p:any)=>p.listingId===listings[1].id).inspections,[]);assert.ok(!JSON.stringify(catalog.report).includes(file.id));
  let response=await fetch(h.base+publicUrl);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.match(response.headers.get('cache-control')||'',/no-store/);
  const update={...input,...command(report.revision),description:'编辑后未重新公开的车况'};report=await h.post(path+'/inspections/'+report.id,update,h.maker,'PATCH');
  catalog=await h.get('/public/vehicles/'+car.id);assert.equal(catalog.plans.find((p:any)=>p.listingId===listing.id).inspections[0].description,'冻结时车况');
  const concurrent=await Promise.all([h.raw(path+'/inspections/'+report.id,{...update,...command(report.revision),description:'并发A'},h.maker,'PATCH'),h.raw(path+'/inspections/'+report.id,{...update,...command(report.revision),description:'并发B'},h.maker,'PATCH')]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  assert.equal((await h.raw('/admin/goods/'+listing.id,{...command(listing.revision),inspectionSelections:[{id:report.id,revision:0}]},h.maker,'PATCH')).status,409);
  for(const [model,id,patch,restore]of [['vehicleListing',listing.id,{visible:false},{visible:true}],['vehicleListing',listing.id,{status:'WITHDRAWN'},{status:'PUBLISHED'}],['vehicle',car.id,{status:'UNPUBLISHED'},{status:'PUBLISHED'}],['productVersion',listing.productVersionId,{status:'RETIRED'},{status:'PUBLISHED'}]] as const){await(h.db as any)[model].update({where:{id},data:patch});assert.equal((await fetch(h.base+publicUrl)).status,404);await(h.db as any)[model].update({where:{id},data:restore});}
  listing=await h.post('/admin/goods/'+listing.id,{...command(listing.revision),inspectionSelections:[]},h.maker,'PATCH');assert.equal((await fetch(h.base+publicUrl)).status,404);
  await h.db.storedFile.update({where:{id:file.id},data:{purpose:'vehicle'}});
  const current=await h.get('/admin/vehicles/'+car.id);assert.equal((await h.raw('/admin/vehicles/'+car.id,{...command(current.revision),mediaFileIds:[file.id],coverFileId:file.id},h.maker,'PATCH')).status,403);
  await h.db.vehicle.update({where:{id:car.id},data:{mediaFileIds:[file.id],coverFileId:file.id}});
  assert.equal((await fetch(h.base+'/api/public/media/'+file.id)).status,404);assert.equal((await h.raw('/admin/files/'+file.id)).status,403);await assert.rejects(h.db.serial(tx=>assertNotAssetFiles(tx,[file.id])));
  assert.equal((await h.raw(path+'/photos')).status,403);
  assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();}
});

test('gallery upload/cover/CAS and original category change preserve vehicle facts in the real database',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const car=await h.post('/admin/vehicles',{brand:'合成',model:'EV',title:'相册-'+h.prefix,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:100,mediaFileIds:[],...command()}),path=`/admin/vehicles/${car.id}`;
  const first=await h.post(path+'/photos',h.form({...command(car.revision)},'照片1',true));assert.equal(first.mediaFileIds.length,1);assert.equal(first.coverFileId,first.mediaFileIds[0]);
  const second=await h.post(path+'/photos',h.form({...command(first.vehicleRevision)},'照片2',true));assert.equal(second.coverFileId,first.coverFileId);
  const ordered=await h.post(path+'/photos',{...command(second.vehicleRevision),mediaFileIds:[...second.mediaFileIds].reverse(),coverFileId:second.mediaFileIds[1]},h.maker,'PATCH');assert.equal(ordered.coverFileId,second.mediaFileIds[1]);assert.equal(ordered.items[0].id,ordered.coverFileId);
  assert.equal((await h.raw(path+'/photos',{...command(second.vehicleRevision),mediaFileIds:[],coverFileId:null},h.maker,'PATCH')).status,409);
  const original=await h.post(path+'/documents',h.form({revision:0,vehicleRevision:ordered.vehicleRevision,idempotencyKey:randomUUID(),category:'PURCHASE',sourceRelativePath:'购车.pdf'}));
  const before=await h.db.storedFile.findUniqueOrThrow({where:{id:original.id}}),request={revision:original.revision,vehicleRevision:ordered.vehicleRevision,idempotencyKey:randomUUID(),category:'PURCHASE_CONTRACT'};
  const changed=await h.post(path+'/documents/'+original.id+'/category',request,h.maker,'PATCH');assert.equal(changed.category,'PURCHASE_CONTRACT');assert.deepEqual(await h.post(path+'/documents/'+original.id+'/category',request,h.maker,'PATCH'),changed);
  assert.deepEqual(await h.db.storedFile.findUniqueOrThrow({where:{id:original.id}}),before);assert.equal((await h.get('/admin/vehicles/'+car.id)).revision,ordered.vehicleRevision);
  await h.db.vehicle.update({where:{id:car.id},data:{holdId:randomUUID()}});assert.equal((await h.raw(path+'/photos',h.form({...command(ordered.vehicleRevision)},'占用照片',true))).status,409);
 }finally{await h.close();}
});
