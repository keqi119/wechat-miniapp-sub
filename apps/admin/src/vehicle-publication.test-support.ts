import {createHash} from 'node:crypto';
/** Synthetic server projection for fixtures whose basic facts, partner, active product,
 * photos, BaaS facts and condition decisions have already been registered. */
export function publicationReadyFixture(vehicleId:string,vehicleRevision:number,goods?:{id:string;revision:number}){
 const entries=[['VEHICLE_INFO','车辆基本信息','overview'],['PARTNER_INFO','合作商信息','documents'],['PRODUCT','生效匹配产品','listing'],['PHOTOS','车辆照片与商品封面','photos'],['BAAS','电池 BaaS 信息','battery-baas'],['CONDITION','火烧、泡水与结构性损伤基础判断','inspection']];
 return{vehicleId,vehicleRevision,...(goods?{goodsId:goods.id,goodsRevision:goods.revision}:{}),checkedAt:'2026-11-04T04:00:00Z',publicationDate:'2026-11-04',ready:true,checks:entries.map(([key,label,targetView])=>({key,label,targetView,passed:true,required:key!=='BAAS',messages:[] as string[]}))};
}
export const publicationPhoto=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==','base64');
export function publicationGalleryFixture(vehicleId:string,vehicleRevision:number){const file={id:'publication-photo',name:'本地合成车辆封面.png',mimeType:'image/png',size:publicationPhoto.length,sha256:createHash('sha256').update(publicationPhoto).digest('hex'),url:`/api/admin/vehicles/${vehicleId}/photos/publication-photo`};return{vehicleId,vehicleRevision,coverFileId:file.id,mediaFileIds:[file.id],items:[file]};}
export function conditionFixture(vehicleId:string,vehicleRevision:number){return{vehicleId,vehicleRevision,revision:1,registered:true,fireDamage:false,floodDamage:false,structuralDamage:false,assessedBy:'synthetic-condition-staff',assessedAt:'2026-11-04T01:00:00Z'};}
