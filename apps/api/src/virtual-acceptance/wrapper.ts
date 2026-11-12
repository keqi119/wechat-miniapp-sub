import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
import {VIRTUAL_NOTICE,VIRTUAL_NOTICE_HASH} from './scope';
export const VIRTUAL_WRAPPER_VERSION='NINDA_INITIAL_VIRTUAL_WRAPPER_V1';
export const VIRTUAL_PRECEDENCE='本测试说明适用于完整文书、全部附件及签署页；与固定正文中的真实车辆租赁、交付、起租、驾驶资格、保险或向出租方分润付款义务不一致时，以本说明为准。本次仅验证身份、电子签署、支付及归档，实际签署和支付记录仍如实留痕。虚拟车辆不对应真实车辆，VIN、登记权属、保险和交接证明均不适用，不应据此办理真实交付、续期、换车或起租。本测试文书及其中用印授权仅适用于本次指定虚拟车辆、指定当事人及测试订单，不适用于其他车辆、客户、订单或正式交易。';
export const VIRTUAL_WRAPPER_HASH=canonicalHash({version:VIRTUAL_WRAPPER_VERSION,notice:VIRTUAL_NOTICE,precedence:VIRTUAL_PRECEDENCE});
const id=z.string().min(1).max(128),digest=z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema=z.object({schema:z.literal('NINDA_VIRTUAL_ACCEPTANCE_V1'),scopeId:id,configurationHash:digest,ownerId:id,customerId:id,platformId:id,templateHash:digest,noticeHash:z.literal(VIRTUAL_NOTICE_HASH),wrapperHash:z.literal(VIRTUAL_WRAPPER_HASH)}).strict();
export type VirtualPrintProof=z.infer<typeof proofSchema>;
/** Pure integrity check, not authorization. Live preparation must resolve and approve the persisted scope first. */
export function validateVirtualPrintProof(raw:unknown,input:{kind:string;template:any;parties:any[]}){
 const proof=proofSchema.parse(raw);
 ensure(['SUBSCRIPTION','COOPERATION','COOPERATION_GRANT'].includes(input.kind)&&input.template.type?.startsWith('ELECTRONIC_V31_')&&hash(input.template.content)===proof.templateHash,409,'VIRTUAL_TEMPLATE_MISMATCH','虚拟验收仅适用冻结的初始文书');
 ensure(input.parties.every(p=>p.partyId===({OWNER:proof.ownerId,PLATFORM:proof.platformId,CUSTOMER:proof.customerId} as any)[p.role]),409,'VIRTUAL_PARTIES_MISMATCH','测试说明与实际文书主体不一致');
 ensure(proof.ownerId!==proof.platformId&&proof.customerId!==proof.ownerId&&proof.customerId!==proof.platformId,409,'VIRTUAL_PARTIES_MISMATCH','测试主体必须分别绑定');
 return proof;
}
