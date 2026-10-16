import {z} from 'zod';
import {currentDocuments,requireCurrentConsents} from '../auth/consents';
import {ensure} from '../common/errors';
import {audit,hash} from '../common/data';
import {Db} from '../common/db';
export const realnameInput=z.object({name:z.string().trim().min(2).max(50),idCardNo:z.string().regex(/^\d{17}[\dXx]$/),consent:z.object({accepted:z.literal(true),documentId:z.string().min(1),version:z.number().int().positive()}).strict()}).strict();
export async function recordRealnameConsent(db:Db,customerId:string,consent:z.infer<typeof realnameInput>['consent'],source:'MINIAPP'|'H5'){
 await db.serial(async tx=>{await requireCurrentConsents(tx,customerId,['terms','privacy']);const[doc]=await currentDocuments(tx,['privacy']);ensure(consent.documentId===doc.id&&consent.version===doc.version,409,'CONSENT_VERSION','请单独阅读并同意当前隐私政策中的实名信息处理');await audit(tx,customerId,'ESIGN_REALNAME_CONSENT','customers',customerId,{documentId:doc.id,version:doc.version,hash:hash(doc.content),source},'CUSTOMER');});
}
