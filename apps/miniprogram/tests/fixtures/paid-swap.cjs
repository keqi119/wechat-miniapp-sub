const { account } = require('./b2.cjs');
const terms = { version: 'SWAP_CREDIT_V1', documentId: 'swap-legal', documentVersion: 1, hash: 'b'.repeat(64), content: '合成购买全文：800元一次，仅本订阅有效，退订或到期失效且未用不退，例外依法处理。' };
const product = { id: 'SWAP_CREDIT_1', quantity: 1, amount: 80000, currency: 'CNY' };
const purchase = (extra = {}) => ({ id: 'sp1', orderId: 'o1', quantity: 1, amount: 80000, currency: 'CNY', status: 'PENDING_PAYMENT', billId: 'bill1', creditId: null, paymentId: null, acceptedAt: '2026-10-16T02:00:00Z', createdAt: '2026-10-16T02:00:00Z', paidAt: null, expiresOn: '2028-09-15', terms, bill: { id: 'bill1', type: 'SWAP_CREDIT', amount: 80000, paidAmount: 0, status: 'PENDING' }, refunds: [], reservedChangeId: null, consumedChangeId: null, canPay: true, canClose: true, canRequestRefund: false, manualReviewRequired: false, statusMessage: '尚未支付，未发放次数', ...extra });
const paidAccount = (extra = {}) => account({ product, purchaseTerms: terms, purchases: [], paidAvailable: 0, paidReserved: 0, paidConsumed: 0, paidFrozen: 0, paidExpired: 0, canPurchase: true, purchaseBlockers: [], ...extra });
const input = () => ({ productId: product.id, termsVersion: terms.version, termsDocumentId: terms.documentId, termsDocumentVersion: terms.documentVersion, termsHash: terms.hash, accepted: true });
module.exports = { terms, product, purchase, paidAccount, input };
