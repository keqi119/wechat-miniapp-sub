import {fail} from './errors';
export abstract class IdentityGateway {
  abstract wechat(input: { loginCode: string; phoneCode: string }): Promise<{ mobile: string; openId: string }>;
  abstract requestSms(mobile: string): Promise<void>;
  abstract verifySms(input: { mobile: string; code: string; loginCode?: string }): Promise<{ mobile: string; openId?: string }>;
  async requestSmsChallenge(_mobile:string):Promise<{challengeId:string}>{return fail(503,'SMS_UNAVAILABLE','短信验证通道暂不可用');}
  async verifySmsChallenge(_input:{challengeId:string;mobile:string;code:string}):Promise<{mobile:string}>{return fail(503,'SMS_UNAVAILABLE','短信验证通道暂不可用');}
}
export type RefundChannelFacts = {channel?:string;userReceivedAccount?:string;receiptDestination?:'CUSTOMER'|'MERCHANT'|'UNKNOWN';nativeStatus?:'SUCCESS'|'PROCESSING'|'CLOSED'|'ABNORMAL';acceptedAt?:string;evidenceSource?:'REQUEST'|'QUERY'|'CALLBACK'};
export abstract class PaymentGateway {
  abstract close(paymentId: string): Promise<void>;
  abstract queryRefund(refundId: string): Promise<RefundChannelFacts & { status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED'; providerRefundId?: string; paymentId: string; amount: number; totalAmount: number; succeededAt?: string }>;
  abstract create(input: { paymentId: string; amount: number; openId: string; description: string }): Promise<{ timeStamp: string; nonceStr: string; package: string; signType: string; paySign: string }>;
  abstract query(paymentId: string): Promise<{ status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED'; transactionId?: string; amount: number; succeededAt?: string }>;
  abstract refund(input: { refundId: string; paymentId: string; amount: number; totalAmount: number; reason: string }): Promise<RefundChannelFacts & { status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED'; providerRefundId?: string; succeededAt?: string }>;
}
/** Parse only a verified provider's RFC3339 success_time; malformed/future values
 * cannot establish historical dates. Callers retain their first confirmation. */
export function parsePaymentSuccessTime(value:unknown,confirmedAt:Date):Date|undefined {
 if(typeof value!=='string')return;
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);if(!m)return;
 const day=new Date(m[1]+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==m[1]||Number(m[2])>23||Number(m[3])>59||Number(m[4])>59)return;
 if(m[5]!=='Z'&&(Number(m[5].slice(1,3))>14||Number(m[5].slice(4,6))>59))return;
 const date=new Date(value);if(!Number.isFinite(date.getTime())||date.getTime()<0||date.getTime()>confirmedAt.getTime()+300000)return;
 return date;
}
export abstract class ESignGateway {
  abstract create(input: { contractId: string; customerId: string; documentHash: string; kind: 'SUBSCRIPTION' | 'HANDOVER' | 'AMENDMENT' | 'TECHNICAL_ACCEPTANCE'; returnUrl?:string; customerName: string; mobile: string }): Promise<{ taskId: string; url?: string; miniProgram?: { appId: string; path: string }; status: string }>;
  abstract query(taskId: string): Promise<{ status: 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED'; documentHash: string; signedFileId?: string }>;
}
