# Partner Identity and Signing Progress Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** Show accurate enterprise identity and selected-seal facts across partner list/detail, with clear signing progress and a persistent profile action.

**Architecture:** Read-only API projection reuses owner identity evidence. Existing partner UI uses the same projection; optional generic workspace toolbar keeps editing context.

**Tech Stack:** NestJS/Prisma, React/TypeScript, Vite, existing Node/Playwright checks.

**Spec:** `docs/superpowers/specs/2026-11-10-partner-identity-progress-design.md`

## Constraints and review focus

- New project only; no old database, credential output, supplier calls, real signing or payment.
- Preserve RBAC, subject binding, version conflicts, command idempotency and transactional behavior.
- Identity completion is distinct from certificate freshness, seal selection and authorization.
- Changed/incomplete proofs cannot yield a verified badge; individual partners cannot be marked as unverified enterprises.
- Preserve the corrected production admin API origin and the current H5 copy release.
- Changes in record/session and failed detail refresh must not expose stale writable forms.

## Tasks

- [ ] API: add `partners/enterprise-verification.ts`, integrate `simple-agreements.ts` list/detail, prove states/privacy/batching/role boundaries with `test/partner-enterprise-verification.test.ts` before implementation. Run protected local database regressions where needed.
- [ ] Workspace: add optional Manager column value/render and detailToolbar, optional DetailFrame toolbar and responsive styles. First prove drawer context and refresh disabling in `manager-toolbar.test.ts`; existing unconfigured workspaces remain unchanged.
- [ ] Partner UI: update `partner-simple.tsx`, `company-legal-entry.tsx`, `electronic-source-forms.tsx`; add focused progress model/workspace/CSS and state/UI tests. Verify completed identity/seal, missing/reauth, unavailable electronic path and independent authorization.
- [ ] Review actual deployed enterprise using a read-only minimal projection, inspect desktop/mobile screenshots, and run typechecks plus scoped regressions.
- [ ] Freeze only named changes against the current published baseline, build admin with the correct absolute API origin and API with unchanged migrations; preserve H5 artifacts. Independently review, deploy with existing pinned target/rollback procedure, and verify real compiled login routes and safe partner reads.
