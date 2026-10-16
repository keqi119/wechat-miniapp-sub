import { usageRules } from '../src/usage/policy';
import { hash } from '../src/common/data';
export const fixtureUsagePolicy={...usageRules,documentId:'synthetic-usage-policy',documentVersion:1,content:'合成测试用完整条款：基础每月清零、包本订阅期结转、退订失效及退款依法处理。',hash:hash('合成测试用完整条款：基础每月清零、包本订阅期结转、退订失效及退款依法处理。')};
export async function seedUsageLegal(db:any){const max=await db.legalDocument.aggregate({where:{type:'usage-policy'},_max:{version:true}});return db.legalDocument.create({data:{type:'usage-policy',version:(max._max.version||0)+1,title:'合成里程规则',content:fixtureUsagePolicy.content,status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:'test-fixture'}});}
