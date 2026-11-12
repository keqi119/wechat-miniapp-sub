# V31 Task6 cooperation and enterprise authority integration

Synthetic tests do not constitute real provider acceptance.

## Independent cooperation / seal-grant documents

Existing `POST /admin/electronic-documents/prepare` accepts `kind: COOPERATION_GRANT`, `resourceId: <main cooperation version id>`, current agreement `revision`, optional approved grant `templateId`, and `idempotencyKey`. Main `COOPERATION` remains uniquely bound to its own task. Grant has its own immutable source, PDF/task/archive and manual OWNER then PLATFORM signatures. It copies the main frozen V31 source/full01 templates and renders exact main number/body hash/attachment-one facts. Completing grant never activates cooperation or an order. Existing authorized file/sign/start/sync paths serve it. Main and grant legal signing/archival facts stay separate.

Grant versions are append-only `(cooperationVersionId, version)` with `previousGrantId`. After the owner revokes a prior grant, prepare can create a new independent grant referencing the same unchanged main cooperation. Original signed PDF, scope, signatures and revocation facts remain. Regrant requires original task archived, never dispatched, or provider-close proof; UNKNOWN/NEEDS_REVIEW is not released by a local revoked/withdrawn label. Scope changes still require proper source/version approval; there is no arbitrary JSON scope editor.

`POST /owner-h5/owners/:ownerId/electronic-documents/:id/revoke-grant` accepts `{revision,idempotencyKey,reason}`. Only the current real OWNER actor can revoke the grant; PLATFORM acceptance cannot revoke the partner's authority. This does not erase valid signatures, activate a relationship or cancel old accepted transactions. Query and authorized archived-file retrieval remain available. New automatic dispatch stops; only unissued pending enterprises may change to manual, with audit. Already accepted/unknown transactions remain on original IDs and use Task4 recovery/closing.

Cooperation amendment/termination preparation returns `V31_COOPERATION_TEMPLATE_UNAVAILABLE` until corresponding approved V31 text exists; old text cannot substitute.

## Business authority maintenance

Owner endpoints under `/owner-h5/owners/:ownerId/electronic-documents`:

- `GET authorities/list`: own authority records and configuration reasons; `automaticReady:null` means actual order/subject/channel checks are required, never a success flag.
- `POST authorities/confirm`: `{revision:<grant revision>,idempotencyKey,grantId,sourceHash,providerAuthorityId,internalEvidenceFileId?,internalEvidenceHash?,internalApplicability?}`. Real current enterprise legal actor only. Scope is copied server-side from archived independent grant. Partner basis is the signed grant. Ningda requires its own original internal authorization/decision evidence file and exact hash, plus its current verified legal actor's explicit `internalApplicability: {kind:'EXACT_FROZEN_SCOPE',sourceHash,signingValidFrom,signingValidUntil}` confirmation. Both times are UTC ISO timestamps (`Z`), with `signingValidFrom < signingValidUntil`. The separately submitted sourceHash must equal the full frozen grant sourceHash; the server does not default this confirmation from the partner grant. It cannot derive its own authority from accepting attachment3. No unsigned local checkbox is a grant.
- `POST authorities/:id/switch`: `{revision,idempotencyKey,scopeHash,enabled}`. Only the actual confirming enterprise actor can enable after review; disabling works while new requests are closed.

Admin endpoints under `/admin/electronic-documents`:

- `GET authorities/:ownerId` reads maintained records for current ADMIN/OPERATIONS.
- `POST authorities/:id/review`: `{revision,idempotencyKey,channelEvidenceFileId,channelEvidenceHash,granteeName:'上海宁达信息科技有限公司',noticeOwnerId,archiveOwnerId,identityIsolated:true,manualIsolated:true,internalBasisVerified:boolean}`. Checks original admin-owned evidence, actual Ningda subject IDs and internal-basis verification; records real reviewer/time. Requires disabled record. It does not enable on behalf of an enterprise.
- `POST authorities/:id/switch` with `enabled:false` pauses immediately under the same enterprise lock used by dispatch. Admin cannot enable.

Internal applicability is deliberately exact-scope-only: the real Ningda actor confirms that the uploaded original independently permits **all** vehicles, product/template versions, prices, service-period commitments and rights in that frozen source. Staff verifies that exact mapping and original evidence; staff cannot create or enable the permission. Missing applicability, another sourceHash, unsupported narrower/partial declarations or malformed periods are rejected. If an original authorizes only part of the frozen scope, Task10 must state **“原始内部依据仅覆盖部分范围，当前须逐份手签”**; do not widen it or preselect a confirmation. A changed basis requires a new actor confirmation record; the original basis/source/period and evidence hashes remain immutable.

`signingValidFrom <= current dispatch time < signingValidUntil` is Ningda's own window for **new automatic signing**, independent of the partner cooperation period. The confirmed exact source separately bounds the service commitments being signed, and the existing actual-order evaluator checks the entire service date range and terms against it. An internal signing permission need not remain valid for the whole future service term. Its expiry/pause does not invalidate signed contracts, terminate performance or block original query/archive. Configured `enabled:true` is not readiness: expired or future permissions may be retained as evidence but the current reader/dispatch refuses automatic use. Existing records without explicit internalApplicability fail closed and require fresh real-actor confirmation, never a backfill inferred from attachment 3.

Authority list/confirm responses expose `internalApplicability` and `internalEvidence:{fileId,sha256}` references for authorized actor/staff review; file contents remain behind existing protected-file access. Staff review binds the immutable actor-confirmed record via authority ID/revision and requires `internalBasisVerified:true`; it cannot submit replacement applicability or dates.

Confirmation/review/switch are authorized, audited, versioned and idempotent. Generic DTOs contain references/hashes, not certificate secrets, identity numbers, bank numbers or file bytes. Full files use existing protected file permissions.

## Automatic signing and fallback

Only SUBSCRIPTION is eligible; customer always manual. Actual current order `agreedFeeComponents`, monthly total, deposit and credit-rule version/band, real product version/minimum/actual months, rights/mileage/BaaS/swap, template ID/version/content, current vehicle/owner/cooperation binding and period are checked against the independently signed immutable scope. Missing/null lists are not unlimited future permission. Current real account, seal, certificate, manager, provider grant and reviewed Ningda channel recipient/notification/archive evidence remain mandatory for both enterprises. Ningda additionally requires its own independently confirmed internal basis. Ordinary price adjustments cannot silently enlarge the signed exact scope.

Any deficient company makes both unissued enterprises manual. Historical signed-party identity/proof is preserved separately from current bilateral authority facts: even a completed OWNER is reread through the production authority resolver under shared enterprise locks before remaining automatic dispatch. The reservation-to-dispatch interval has a second bilateral check; current identity bindings must still match the original task. After partial signatures, preserve every accepted/signed transaction and change only unissued pending enterprise actions; do not recreate or erase proof. Reserved-but-unconfirmed operations remain on their original transaction for recovery/Task4 review rather than being reissued as a new manual transaction.

Free-text commercial exceptions require per-document manual signing because they do not establish machine-readable price/rights bounds. Disclosed vehicle restrictions are handled by exact current/frozen disclosure and independent rental-authority evidence matching; UNKNOWN, missing evidence or changed disclosure cannot authorize automation. Disclosure itself is not proof of permission to lease.

## Technical provider onboarding

ELECTRONIC identity/seal onboarding has a separate gate from legacy per-document issuance. PROVIDER_AUTO_GRANT remains technical permission only; its template readiness uses approved ELECTRONIC_V31_SUBSCRIPTION and current scope v2. Business authority uses the separate workflow above. UNILATERAL_LETTER new request/resume does not become a V31 grant path. Existing technical refresh/revocation and original-result query retain their recovery semantics when new requests are disabled. Legacy order/handover issuance guards remain.

Task10 must mount actual fields, grant preview/sign/revoke/regrant, owner confirmation of original internal basis, explicit complete applicability and independent signing-validity timestamps, staff evidence review/pause, and truthful missing-authority reasons. Task11 must validate current actual generated provider authorization recipient/notice route, real separate accounts/seals/certificates, Ningda internal authority evidence and channel stop/recovery. No real provider sample or real authority has been accepted by these local tests.

The authorized electronic-document detail returns a sanitized `grant` object for grant tasks: `id, version, revision, sourceHash, cooperationVersionId, previousGrantId, signedAt, archivedAt, revokedAt`. Task10 uses these exact values for confirmation and shows the protected PDF for scope review; no raw sourceSnapshot or private rendered content is returned.

Shared Task3 live source comparison ignores only the outer OWNER/PLATFORM row revision when the record ID and complete validated content/hash are identical. It validates both frozen/current hashes and never mutates persisted snapshots or signed PDF. This accommodates technical grant refresh bookkeeping; real enterprise contact/identity/legal-authority changes still block new signing. Product/template/business versions remain strict.
