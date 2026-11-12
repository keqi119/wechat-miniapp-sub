import {termSwapFixture} from './term-swap-fixture';
import {stageSwapSourceFixture} from './stage-swap-source-fixture';
export async function stageCreditFixture(count=2){
 const f=termSwapFixture(2,50000,true),s=await stageSwapSourceFixture(count);Object.assign(f.order,s.order);Object.assign(f.account,s.account);Object.assign(f.tx,{orderServiceStage:s.tx.orderServiceStage,orderTermsVersion:s.tx.orderTermsVersion,delayQuote:s.tx.delayQuote});f.tx.orderChange.findMany=async()=>[];
 return{...f,stage:s,now:new Date('2027-02-01T00:00:00+08:00')};
}

