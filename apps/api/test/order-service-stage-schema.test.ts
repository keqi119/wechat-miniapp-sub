import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {verifyOrderServiceStageSchema} from './order-service-stage-schema-checks';

test('service-stage relational boundaries and legacy pricing facts are preserved',async()=>{
 const db=new Db();try{const columns=await db.$queryRaw<any[]>`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='OrderServiceStage'`;if(!columns.length)throw Error('missing OrderServiceStage table');
  const vehicle=await db.vehicle.create({data:{vin:'stage-'+randomUUID(),title:'合成续期结构测试车',brand:'测试',model:'测试',year:2026,city:'上海',mileageKm:0}});
  await verifyOrderServiceStageSchema(db,vehicle);
 }finally{await db.$disconnect();}
});
