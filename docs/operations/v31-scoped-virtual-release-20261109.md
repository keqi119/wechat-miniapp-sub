# Scoped virtual release preparation — 2026-11-09

This package is local and awaits independent review and root-controlled activation. No upload, provider call or deployment has occurred. Production miniapp remains 1.2.1; experience and under-review remain 1.2.9. The separately built local candidate is 1.3.0.

## Exact candidate

Release `20261109-v31-scoped-candidate`, image `sha256:e05cdf2a451b6f8794e4e42c92f68cec5338838ee1f6a7bc0925cd156e65b915` (linux/amd64, USER node/UID1000). Local package: `.runtime/task-11c-candidate-20261109/` contains `api-image.tar`, `static-release.tar.gz`, `release/` and local `miniprogram/`. Static manifest SHA256 is `af55ada4a022334535ac26001f45c1c3c513a4f7fbb7dd06d4fc6c25116ab736`. Exact source/artifact hashes, image metadata, actual Linux probe and migration evidence are in `.superpowers/sdd/2026-11-07-ninda-v31-electronic-contracts/task-11c-fix1-artifact-manifest.json and original task-11c-migration-manifest.json`.

Both H5 modes occupy the same signing-h5 tree (index.html, owner.html and their own referenced assets); admin includes index.html and field.html. Keep the existing nginx /owner/ and /miniapp-sign/ aliases, proxy headers and independent SMS/login limits. Do not serve uploads as static content. The Linux probe verifies actual API 404/401 behavior and quarantine controller403; nginx routing is separately source-checked, not claimed as a local nginx deployment test.

## Private candidate environment (root only)

Root freshly reads the pinned new-project host, verifies its known machine ID and all active environment/image pins, and supplies the exact private raw active-environment file. Do not output or version that file. The builder accepts only the exact observed prior transitions: ESIGN_NEW false→true, ELECTRONIC_SIGNING absent→true, FADADA_SIGNING false→true, MINIAPP_SIGNING false→true, MINIAPP_FACE_BRIDGE true→false. BUILD_VERSION/API_IMAGE change to the release identity. Every other decoded key/value, including unrelated and secret bytes, must remain exact. Existing OFFLINE/MANUAL_REVIEW, OWNER_AUTO_SIGNING=false, H5_SIGNING=false, OWNER_LEGAL_H5_ONLY=false, provider identities and all required dependencies stay pinned. If fresh live state differs, stop for review; do not weaken the allowlist.

The exported `buildScopedVirtualCandidateEnv` validates the existing narrow protected dotenv grammar, preserves all unrelated raw entries/comments/line endings and rewrites only the seven allowed ASCII gate/release entries. The protected scoped preflight additionally uses the installed real Compose CLI (`config --format json`, no containers) to compare old/candidate API and database consumer environments in memory. This catches interpolation through changed variables as well as escaping errors; resolved secrets are never logged. The older whole-mode `electronicChanges` is not this profile. Root must use this exact reviewed helper invocation instead of JSON-reserializing decoded secrets:

```sh
node --input-type=module -e 'import fs from "node:fs"; import {buildScopedVirtualCandidateEnv} from "./scripts/ninda/electronic-candidate.mjs"; const raw=fs.readFileSync(process.argv[2],"utf8"); fs.writeFileSync(process.argv[1],buildScopedVirtualCandidateEnv(raw,"20261109-v31-scoped-candidate"),{mode:0o600,flag:"wx"});' "$PRIVATE_CANDIDATE_ENV_PATH" "$PRIVATE_RAW_ACTIVE_ENV_PATH"
```

This command is documentation only; the implementer has not accessed private inputs. Upload the candidate privately under the basename `.env.candidate-v31-scoped` only after review. Secret material remains outside this package.

## Root activation gate

On host 8.133.232.213, freshly revalidate exact database state against the explicit 39 pending names/raw hashes in task-11c-migration-manifest.json. Root's read-only inventory was 77 applied, 39 pending, zero mismatches/unfinished. Six pending names predate the latest applied name: a date/name cutoff is invalid. Candidate contains exactly116 source-matching migrations. Do not migrate here or connect to the old business database.

Check all archive hashes, load the exact image archive, confirm `docker image inspect` ID matches the immutable ID above, and install only the static release tree under `/opt/ninda-platform/releases/20261109-v31-scoped-candidate`. Keep SHA256SUMS beside admin/signing-h5 and put no additional files in that tree. Root must verify actual private host/machine, active decoded configuration, immutable old image, environment hash, nginx source and existing backup/restore prerequisites before the following command. Root supplies the real values for placeholders:

```sh
bash /opt/ninda-platform/deploy/activate-mvp-release.sh \
  20261109-v31-scoped-candidate .env.candidate-v31-scoped \
  '<FRESH_ACTIVE_ENV_SHA256>' '<FRESH_OLD_IMAGE_SHA256_ID>' \
  af55ada4a022334535ac26001f45c1c3c513a4f7fbb7dd06d4fc6c25116ab736 \
  sha256:e05cdf2a451b6f8794e4e42c92f68cec5338838ee1f6a7bc0925cd156e65b915 \
  '<PINNED_MACHINE_ID>' preserve scoped-virtual
```

Use the reviewed uploaded protected script. Generic activate-release.sh is not a bypass. scoped-virtual rejects fresh mode before any host mutation. The existing deployment lock, exact environment/static/image pins, all-origin/callback maintenance503, encrypted backup and verified restore execute before migrations. Both preflight and live runtime assert the scoped matrix. Before opening traffic, public identity/signing capability fields must retain the complete ordinary baseline (including newEsign/newElectronic/electronicEnabled, fallback and ownerPortal), and compiled ordinary provider/signing/identity/onboarding guards must refuse new operations. Authenticated/native checks later use users' own sessions, never borrowed or minted live customer credentials.

Before migration begins, failure restores exact previous environment, image and nginx routing; current static target is not switched before runtime checks. If migration has begun, failure stops API and retains maintenance; there is no automatic schema/data downgrade. Recovery must preserve signature/payment query, callbacks, archives and reconciliation. Never erase history or parent records to make release pass.

## Remaining real acceptance

The durable wrapper-only approval is `docs/legal/versions/ninda/v31-virtual-wrapper-20261109/approval.json`; it preserves the exact three user-approved review-v1 sample hashes. All five original initial-template artifacts and frozen PDFs remain unchanged. It does not authorize/establish identity, signing, payment or delivery results.

Actual Ningda provider customerID/sealID remain independent pinned values. Configuration presence proves neither account identity nor seal ownership. Existing electronic-documents/identities.ts real receipt comparison must reject a mismatch; never substitute the test lessor or bypass it. Root must verify real platform/lessor/representative identities, user claims, consent, native WeChat and provider channels, exact scope/product/template/hash freeze, approved address input and manual enterprise signing; then obtain actual signing/archive and the two authorized100-fen payment results. Formal03–06, financial lifecycle work, cleanup and any miniapp upload/publication remain outside this task.
