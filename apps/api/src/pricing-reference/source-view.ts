import {validRegistration} from '../insurance/registration-facts';
const pick=(row:any,fields:string[])=>row?Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])):null;
/** Explicit projection: source domains also contain private parties, bank accounts
 * and original files which pricing-reference permission does not expose. */
export function financialSourceView(source:{asset:any,contracts:any[],plans:any[],insurance:any[]}){
 return {
  asset:pick(source.asset,['vehicleId','revision','purchaseAmount','purchaseDate','firstRegistrationDate','batteryOwnership','batteryCapacityKwh']),
  baasContracts:source.contracts.map(row=>pick(row,['id','revision','effectiveFrom','effectiveTo','status','billingCycle','rentalAmount','firstCostPeriod','paymentDayOfMonth','taxIncluded','currency','termsHash'])),
  baasPlans:source.plans.map(row=>pick(row,['id','revision','baasContractId','periodStart','periodEnd','amount','sourceRevision','sourceHash','status'])),
  insuranceVersions:source.insurance.map(row=>({...pick(row,['id','policyId','version','revision','policyType','premiumAmount','startAt','endAt','effectiveAt','status','changeKind','vehicleIds','createdAt']),registrationVerified:row.status==='REGISTERED'?validRegistration(row):null})),
 };
}
