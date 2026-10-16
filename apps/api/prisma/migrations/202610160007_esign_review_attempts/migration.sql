-- Keep rejected/expired review evidence while allowing a new immutable attempt.
DROP INDEX "ESignApproval_kind_resourceId_documentHash_policyId_key";
CREATE INDEX "ESignApproval_kind_resourceId_documentHash_policyId_idx" ON "ESignApproval"("kind", "resourceId", "documentHash", "policyId");
