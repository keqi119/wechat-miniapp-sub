import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { acceptancePricingOffer, finalPlanPricing, assertFinalPricing, acceptancePricingDescription } from '../src/applications/acceptance-pricing';

const application = { id: 'application-one', customerId: 'customer-one', vehicleId: 'vehicle-one' };
const scope = { applicationId: application.id, customerId: application.customerId, vehicleId: application.vehicleId, startDate: '2026-10-17', firstDueDate: '2026-10-17', reference: 'user-approved-one-fen-lease' };
const input = { pricingMode: 'V1_ONE_FEN', monthlyFeeAmount: 1, depositAmount: 1, months: 12, startDate: scope.startDate, firstDueDate: scope.firstDueDate };
const admin = { id: 'admin-one', role: 'ADMIN' };
const previous = process.env.ORDER_ACCEPTANCE_SCOPE_JSON;
after(() => { if (previous === undefined) delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON; else process.env.ORDER_ACCEPTANCE_SCOPE_JSON = previous; });
function enable() { process.env.ORDER_ACCEPTANCE_SCOPE_JSON = JSON.stringify(scope); }

test('acceptance pricing defaults closed and binds the full application/customer/vehicle tuple', () => {
  for (const value of ['', '{bad}', JSON.stringify({ ...scope, customerId: '' }), JSON.stringify({ ...scope, startDate: '2026-02-30' })]) {
    process.env.ORDER_ACCEPTANCE_SCOPE_JSON = value;
    assert.equal(acceptancePricingOffer(application), null);
    assert.throws(() => finalPlanPricing(application, input, 0, admin));
  }
  enable(); assert.equal(acceptancePricingOffer(application)?.depositAmount, 1);
  for (const key of ['id', 'customerId', 'vehicleId']) assert.equal(acceptancePricingOffer({ ...application, [key]: 'different' }), null);
});
test('only a scoped admin can fix exactly twelve one-fen rents and one-fen deposit', () => {
  enable();
  for (const role of ['OPERATIONS', 'FINANCE', 'SUPPORT']) assert.throws(() => finalPlanPricing(application, input, 0, { ...admin, role }));
  for (const patch of [{ monthlyFeeAmount: 2 }, { depositAmount: 0 }, { months: 13 }, { startDate: '2026-10-18' }, { firstDueDate: '2026-10-18' }]) assert.throws(() => finalPlanPricing(application, { ...input, ...patch }, 0, admin));
  for (const standardDeposit of [0, 1, 2]) {
    const result = finalPlanPricing(application, input, standardDeposit, admin);
    assert.equal(result.depositAmount, 1); assert.equal(result.acceptancePricing.standardDepositAmount, standardDeposit);
    assert.equal(result.acceptancePricing.authorizedBy, admin.id);
    assertFinalPricing(application, { ...input, ...result }, standardDeposit);
  }
});
test('ordinary plans retain credit-calculated deposit with no special snapshot', () => {
  delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;
  for (const amount of [0, 1, 2]) {
    const result = finalPlanPricing(application, { ...input, pricingMode: 'STANDARD', depositAmount: undefined }, amount, { ...admin, role: 'OPERATIONS' });
    assert.equal(result.depositAmount, amount); assert.equal(result.acceptancePricing, undefined);
    assertFinalPricing(application, { ...input, ...result }, amount);
  }
  assert.throws(() => finalPlanPricing(application, { ...input, pricingMode: 'STANDARD' }, 0, admin));
});
test('confirmation rejects changed scope or tampered snapshot/amount and historical rendering survives closing the scope', () => {
  enable(); const result = finalPlanPricing(application, input, 0, admin), final = { ...input, ...result };
  assertFinalPricing(application, { ...final, startDate: new Date(scope.startDate), firstDueDate: new Date(scope.firstDueDate) }, 0);
  for (const patch of [{ depositAmount: 2 }, { monthlyFeeAmount: 2 }, { months: 24 }, { acceptancePricing: { ...result.acceptancePricing, standardDepositAmount: 2 } }]) assert.throws(() => assertFinalPricing(application, { ...final, ...patch }, 0));
  assert.throws(() => assertFinalPricing({ ...application, customerId: 'another' }, final, 0));
  process.env.ORDER_ACCEPTANCE_SCOPE_JSON = JSON.stringify({ ...scope, reference: 'changed' }); assert.throws(() => assertFinalPricing(application, final, 0));
  delete process.env.ORDER_ACCEPTANCE_SCOPE_JSON;
  assert.throws(() => assertFinalPricing(application, final, 0));
  assert.match(acceptancePricingDescription(final), /12期.*0.01.*0.12.*押金.*0.01/);
  assert.equal(acceptancePricingDescription({ monthlyFeeAmount: 489900, depositAmount: 0 }), '');
  assert.throws(() => acceptancePricingDescription({ ...final, depositAmount: 0 }));
});
