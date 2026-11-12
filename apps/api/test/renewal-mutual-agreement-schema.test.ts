import {test} from 'node:test';
import {Db} from '../src/common/db';
import {verifyRenewalMutualAgreementSchema} from './renewal-mutual-agreement-schema-checks';
test('mutual agreement is an all-or-none separately evidenced fact with real verifier and coherent times',async()=>{const db=new Db();try{await verifyRenewalMutualAgreementSchema(db);}finally{await db.$disconnect();}});
