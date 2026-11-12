import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Db} from '../src/common/db';
import {validateBackfillTarget} from '../src/operations/seven-module-migration';

test('database rejects a duplicate VIN across case and surrounding whitespace without leaving partial vehicles',{skip:process.env.NODE_ENV!=='test'},async()=>{
 validateBackfillTarget(process.env);
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
 const vin='L'+randomBytes(8).toString('hex').toUpperCase();
 const data={brand:'合成VIN测试',model:'EV',title:'仅本地回滚测试',year:2026,city:'上海',mileageKm:0};
 try{
  await assert.rejects(db.$transaction(async tx=>{
   await tx.vehicle.create({data:{...data,vin}});
   await tx.vehicle.create({data:{...data,vin:` ${vin.toLowerCase()} `}});
  }), (error:any)=>error.code==='P2002');
  assert.equal(await db.vehicle.count({where:{vin:{in:[vin,` ${vin.toLowerCase()} `]}}}),0);
  const rollback=new Error('SYNTHETIC_VIN_ROLLBACK');
  await assert.rejects(db.$transaction(async tx=>{
   await tx.vehicle.create({data:{...data,vin:null}});
   await tx.vehicle.create({data:{...data,vin:null}});
   throw rollback;
  }),error=>error===rollback);
 }finally{await db.$disconnect();}
});
