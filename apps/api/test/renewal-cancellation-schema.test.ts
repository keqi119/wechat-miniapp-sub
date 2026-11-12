import {test} from 'node:test';
import {Db} from '../src/common/db';
import {verifyRenewalCancellationSchema} from './renewal-cancellation-schema-checks';
test('future renewal cancellation, paper and refunds cannot cross source identities',async()=>{const db=new Db();try{await verifyRenewalCancellationSchema(db);}finally{await db.$disconnect();}});
