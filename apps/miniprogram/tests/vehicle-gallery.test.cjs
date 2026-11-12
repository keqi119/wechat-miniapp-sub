const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),{createApi}=require('../src/services/api'),config=require('../src/config');
// Use the actual public API DTO mapper; no database, provider or Mock copy is used.
const apiRoot=fs.realpathSync(fs.existsSync(path.resolve(__dirname,'../../api/package.json'))?path.resolve(__dirname,'../../api'):path.resolve(__dirname,'../../workspace/apps/api')),apiRequire=createRequire(path.join(apiRoot,'package.json'));
const priorTsconfig=process.env.TSX_TSCONFIG_PATH;process.env.TSX_TSCONFIG_PATH=path.join(apiRoot,'tsconfig.json');
let presentCatalogVehicle;try{({presentCatalogVehicle}=apiRequire('tsx/cjs/api').require(path.join(apiRoot,'src/catalog/catalog.ts'),__filename));}finally{if(priorTsconfig===undefined)delete process.env.TSX_TSCONFIG_PATH;else process.env.TSX_TSCONFIG_PATH=priorTsconfig;}
const base='https://api.evsub.ndacar.com',photo=id=>base+'/api/public/media/'+encodeURIComponent(id);
function publicVehicle(extra={}){return presentCatalogVehicle({id:'vehicle',brand:'NIO',model:'ES6',title:'合成公开车辆',city:'上海',year:2024,mileageKm:12000,status:'PUBLISHED',mediaFileIds:[],coverFileId:null,privateDocuments:['/api/admin/baas-contracts/private/files/private'],...extra},false,[],null);}
function setup(initial){let row=initial;const previews=[],toasts=[],calls=[],wx={previewImage:o=>previews.push(o),showToast:o=>toasts.push(o)};
 const api=createApi(config,o=>{calls.push(o);assert.match(o.url,/\/public\/vehicles\/vehicle$/);o.success({statusCode:200,data:{vehicle:row,plans:[],report:{summary:'公开披露',items:[],images:[]}}});},wx);
 const helper={module:{exports:{}},wx,require:createRequire(path.join(__dirname,'../src/utils/page.js'))};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/utils/page.js'),'utf8'),helper);
 let definition;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/pages/vehicle/index.js'),'utf8'),{Page:v=>definition=v,require:p=>p.includes('services')?api:helper.module.exports,wx});
 const page={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};page.onLoad({id:'vehicle'});
 return{api,page,previews,toasts,calls,replace:value=>row=value};
}
test('public vehicle photo IDs become a cover-first ordered shared gallery with duplicates removed',async()=>{
 const row=publicVehicle({coverFileId:'cover',mediaFileIds:['side','cover','rear','side']}),f=setup(row),result=await f.api.getVehicle('vehicle');
 assert.deepEqual(result.vehicle.galleryUrls,['cover','side','rear'].map(photo));assert.equal(result.vehicle.imageUrl,photo('cover'));assert.equal(JSON.stringify(result).includes('privateDocuments'),false);assert.equal(f.calls[0].header.Authorization,undefined);
});
test('empty, cover-only and album-only public records keep truthful zero/single photo behavior',async()=>{
 for(const [extra,expected]of [[{},[]],[{coverFileId:'cover'},[photo('cover')]],[{mediaFileIds:['side']},[photo('side')]]]){const f=setup(publicVehicle(extra)),result=await f.api.getVehicle('vehicle');assert.deepEqual(result.vehicle.galleryUrls,expected);await f.page.refresh();assert.equal(f.page.data.galleryIndex,0);if(!expected.length){assert.equal(typeof f.page.previewGallery,'function');f.page.previewGallery({currentTarget:{dataset:{src:photo('missing')}}});assert.equal(f.previews.length,0);}}
});
test('gallery only uses safe IDs from the public photo fields and never document links or arbitrary URLs',async()=>{
 const row={...publicVehicle({coverFileId:'cover',mediaFileIds:['../private','/api/customer/files/secret','https://foreign.example/image','safe_2-3','',null]}),images:['/api/admin/files/secret'],fileIds:['secret'],galleryUrls:['https://foreign.example/injected']};
 const result=await setup(row).api.getVehicle('vehicle');assert.deepEqual(result.vehicle.galleryUrls,[photo('cover'),photo('safe_2-3')]);
});
test('vehicle hero swiping and clicking preview use the same complete public gallery',async()=>{
 const f=setup(publicVehicle({coverFileId:'cover',mediaFileIds:['side','rear']}));await f.page.refresh();assert.equal(typeof f.page.galleryChanged,'function');assert.equal(typeof f.page.previewGallery,'function');
 f.page.galleryChanged({detail:{current:1}});assert.equal(f.page.data.galleryIndex,1);f.page.previewGallery({currentTarget:{dataset:{src:photo('side')}}});assert.equal(f.previews.length,1);assert.equal(f.previews[0].current,photo('side'));assert.deepEqual(f.previews[0].urls,['cover','side','rear'].map(photo));
 f.previews[0].fail();assert.equal(f.toasts.length,1);assert.match(f.toasts[0].title,/图片/);
});
test('invalid preview targets, stale page state and invalid swipe indices cannot open another file',async()=>{
 const f=setup(publicVehicle({coverFileId:'cover'}));await f.page.refresh();assert.equal(typeof f.page.previewGallery,'function');assert.equal(typeof f.page.galleryChanged,'function');
 f.page.previewGallery({currentTarget:{dataset:{src:'/api/customer/files/secret'}}});assert.equal(f.previews.length,0);
 for(const index of [-1,1,NaN,'0'])f.page.galleryChanged({detail:{current:index}});assert.equal(f.page.data.galleryIndex,0);
 f.page.data.loading=true;f.page.previewGallery({currentTarget:{dataset:{src:photo('cover')}}});f.page.data.loading=false;f.page.data.error='已失效';f.page.previewGallery({currentTarget:{dataset:{src:photo('cover')}}});assert.equal(f.previews.length,0);
});
test('refresh retains the viewed photo only while it remains in this vehicle current album',async()=>{
 const f=setup(publicVehicle({coverFileId:'cover',mediaFileIds:['side','rear']}));await f.page.refresh();assert.equal(typeof f.page.galleryChanged,'function');f.page.galleryChanged({detail:{current:2}});await f.page.refresh();assert.equal(f.page.data.galleryIndex,2);
 f.replace(publicVehicle({mediaFileIds:['side']}));await f.page.refresh();assert.equal(f.page.data.galleryIndex,0);assert.deepEqual(f.page.data.vehicle.galleryUrls,[photo('side')]);
});
