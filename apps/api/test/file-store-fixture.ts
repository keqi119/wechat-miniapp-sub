/** In-memory persistence for file authorization tests; no implicit staff grants. */
export function fileReadStore(overrides:any={}){
 const zero={count:async()=>0};
 return{electronicFileQuarantine:zero,renewalCancellationFact:zero,vehicleInspectionFile:zero,vehicleDocumentFile:zero,assetPrivateFile:{findUnique:async()=>null,count:async()=>0},partnerSettlementFile:{findUnique:async()=>null},archiveFile:zero,archiveVersion:zero,insurancePolicyFile:zero,partnerAgreementVersion:zero,
  partnerCooperationDraft:{findMany:async()=>[]},partnerCooperationSubmission:{findMany:async()=>[]},
  paymentReconciliation:zero,customerQualificationVersion:zero,partnerIdentityBinding:zero,partnerVerification:zero,
  partnerVehicleBindingProposal:zero,ownerVehicle:zero,partnerVehicleBindingHistory:zero,offlineCancellationReview:zero,orderRenewalCancellation:zero,
  contract:zero,ownerSigningTask:zero,handover:zero,vehicleReceiptEvent:zero,adminUser:{findUnique:async()=>null},...overrides};
}
