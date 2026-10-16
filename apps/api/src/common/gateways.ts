export abstract class IdentityGateway {
  abstract wechat(input: { loginCode: string; phoneCode: string }): Promise<{ mobile: string; openId: string }>;
  abstract requestSms(mobile: string): Promise<void>;
  abstract verifySms(input: { mobile: string; code: string; loginCode?: string }): Promise<{ mobile: string; openId?: string }>;
}
export abstract class PaymentGateway {
  abstract close(paymentId: string): Promise<void>;
  abstract queryRefund(refundId: string): Promise<{ status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED'; providerRefundId?: string; paymentId: string; amount: number; totalAmount: number }>;
  abstract create(input: { paymentId: string; amount: number; openId: string; description: string }): Promise<{ timeStamp: string; nonceStr: string; package: string; signType: string; paySign: string }>;
  abstract query(paymentId: string): Promise<{ status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED'; transactionId?: string; amount: number }>;
  abstract refund(input: { refundId: string; paymentId: string; amount: number; totalAmount: number; reason: string }): Promise<{ status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED'; providerRefundId?: string }>;
}
export abstract class ESignGateway {
  abstract create(input: { contractId: string; customerId: string; documentHash: string; kind: 'SUBSCRIPTION' | 'HANDOVER' | 'AMENDMENT'; returnUrl?:string; customerName: string; mobile: string }): Promise<{ taskId: string; url?: string; miniProgram?: { appId: string; path: string }; status: string }>;
  abstract query(taskId: string): Promise<{ status: 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED'; documentHash: string; signedFileId?: string }>;
}
