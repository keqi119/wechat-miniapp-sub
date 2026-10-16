import { ServiceUnavailableException } from '@nestjs/common';
import { IdentityGateway, PaymentGateway, ESignGateway } from './gateways';
const unavailable = (): never => { throw new ServiceUnavailableException({ error: { code: 'PROVIDER_UNAVAILABLE', message: '服务供应商尚未配置或暂不可用，请稍后重试' } }); };
export const unavailableIdentity: IdentityGateway = { wechat: async () => unavailable(), requestSms: async () => unavailable(), verifySms: async () => unavailable() };
export const unavailablePayment = { create: async () => unavailable(), query: async () => unavailable(), refund: async () => unavailable(), close: async () => unavailable(), queryRefund: async () => unavailable() } as PaymentGateway;
export const unavailableESign: ESignGateway = { create: async () => unavailable(), query: async () => unavailable() };
