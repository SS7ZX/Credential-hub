# Production readiness audit — H1–H5 evidence and blockers

**Scope:** local repository, local Supabase stack, and a production-mode frontend build made in an isolated temporary copy. No hosted database, deployment, or `.env` file was accessed. The supplied public origin was passed as a process environment value to the predeploy check.

**Status meanings:** `PROVEN` means the cited local command/source check produced the stated result. `PROVEN — GAP` means local evidence confirms a requirement is not met. `UNVERIFIED` means it requires operator checks against the intended staging deployment or its live configuration; exact steps are included.

## Findings

### DID document, JWKS, and `issuer_keys`

**PROVEN — local implementation and tests:** `vercel.json` rewrites `/.well-known/did.json` and `/.well-known/jwks.json` to a Vercel API proxy. The proxy calls only the fixed `did-document` or `public-keys` Supabase Function path, using server runtime `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`); it never exposes a service-role key. Deno tests verify both rewrites, the fixed upstream path, HTTPS restriction, and that the DID/JWKS projections agree for the same `issuer_keys` rows.

Both documents publish keys with status `active` or `retired`. Retired public keys remain published so previously issued credentials remain verifiable; retirement prevents new signing but is not key-removal approval. Do not remove a retired key until the owner has decided that no retained credential requires it. The shared projection test verifies that the DID verification methods and JWKS contain the same public keys and `kid` values.

**UNVERIFIED — staging steps:** request `/.well-known/did.json` and `/.well-known/jwks.json` at the staging origin; confirm the DID equals the configured issuer DID, then compare `kid` and public JWK values with the staging `issuer_keys` rows. Confirm retired keys remain discoverable. Verify Vercel has the required server runtime URL and publishable/anon key configured. Do not use production signing keys for this check.

### `PUBLIC_SITE_URL`

**PROVEN — local validation:** `npm run predeploy:check`, with `PUBLIC_SITE_URL=https://credential-hub-gules.vercel.app/` set in the process environment, passed and derived `did:web:credential-hub-gules.vercel.app`. The script uses the process value without calling Vite dotenv loading.

**UNVERIFIED — deployment configuration:** this does not prove that the Vercel build environment, Supabase Function secrets, Supabase Auth Site URL, redirect allowlist, and public origin all match. In the staging consoles, compare those values to the approved staging origin; do not copy secret values into this report.

### Vercel security headers and CSP

**PROVEN — source configuration:** `vercel.json` now declares a global header rule; the file parses as valid JSON. The policy is:

```text
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; media-src 'self' blob:; upgrade-insecure-requests
```

Directive rationale:

| Directive | Reason / limitation |
|---|---|
| `default-src 'self'` | Same-origin fallback for resource types without a more specific directive. |
| `base-uri 'self'` | Prevents injected `<base>` elements from changing relative-link destinations. |
| `object-src 'none'` | Blocks legacy plugin/embed content. |
| `frame-ancestors 'none'` and `X-Frame-Options: DENY` | Prevents the portal being framed; both are deliberately set for modern and older clients. |
| `frame-src 'none'` | The application does not intend to embed third-party frames; verify any future auth/embed flow before relaxing it. |
| `form-action 'self'` | Keeps browser form submissions on the portal origin. |
| `script-src 'self'` | Allows bundled same-origin scripts only; no inline script or `eval` exception is granted. |
| `style-src 'self' 'unsafe-inline'` | Required by current React inline style attributes. This is a CSP compromise; replacing inline styles with classes would allow tightening it. |
| `img-src 'self' data: blob: https:` | Supports bundled images, generated QR/previews, and issuer/achievement images. `https:` is broad; restrict to approved asset hosts if practical. |
| `font-src 'self' data:` | Supports bundled fonts and data-URL font resources. |
| `connect-src 'self' https://*.supabase.co wss://*.supabase.co` | Allows same-origin requests and Supabase HTTPS/WebSocket APIs. A custom Supabase hostname would need an explicit addition. No browser-side email-provider connection is permitted. |
| `worker-src 'self' blob:` | Supports the bundled PDF and QR scanner workers, including blob workers. |
| `media-src 'self' blob:` | Allows same-origin/blob media used by local previews. |
| `upgrade-insecure-requests` | Upgrades insecure resource requests in HTTPS deployments. |
| `Permissions-Policy: camera=(self)` | Camera access is permitted only to this origin for QR scanning. Microphone, geolocation, and payment are denied. |
| `Referrer-Policy: strict-origin-when-cross-origin` | Avoids sending full paths/query data to other origins while retaining same-origin referrers. |
| `Strict-Transport-Security: max-age=31536000` | Requires HTTPS for this host after a successful HTTPS response. It intentionally does not include subdomains. |
| `X-Content-Type-Options: nosniff` | Prevents MIME sniffing. |

**UNVERIFIED — staging steps:** run `curl.exe -sSI https://<staging-origin>/` and repeat for `/c/<synthetic-uuid>`; confirm all configured headers appear on both normal and middleware responses. Load QR scanning and PDF preview in a staging browser with the console open; confirm camera works only on the staging origin and CSP does not block required resources. Confirm the configured Supabase hostname matches `connect-src`. Vercel routing behavior is not established by a local JSON parse.

### Edge Function CORS

**PROVEN — code and Deno tests:** `did-document`, `public-keys`, and `get-credential` use `Access-Control-Allow-Origin: *` because they are read-only public discovery/projection operations. They do not set `Access-Control-Allow-Credentials`; wildcard CORS is not used for authenticated or state-changing requests. All other Functions derive their exact allowed origin from normalized `PUBLIC_SITE_URL`.

| Function | CORS | Justification |
|---|---|---|
| `did-document` | `*`, no credentials | Public DID discovery document. |
| `public-keys` | `*`, no credentials | Public verification keys. |
| `get-credential` | `*`, no credentials | Read-only public credential projection/JWT; no recipient PII absent consent. |
| `verify-credential` | `PUBLIC_SITE_URL` | Public verification accepts submitted proof data; limit browser origins to the first-party verifier. |
| `manage-recipient-credential` | `PUBLIC_SITE_URL` | Token-scoped recipient changes; not a public cross-origin read. |
| `issue-batch` | `PUBLIC_SITE_URL` | Authenticated issuer writes. |
| `generate-pdf` | `PUBLIC_SITE_URL` | Authenticated issuer PDF generation. |
| `create-organization` | `PUBLIC_SITE_URL` | Owner bootstrap writes. |
| `send-emails` | `PUBLIC_SITE_URL` | Authenticated email side effect. |
| `accept-organization-invitation` | `PUBLIC_SITE_URL` | Authenticated invite acceptance. |
| `list-drive-folder` | `PUBLIC_SITE_URL` | Authenticated Drive browsing. |
| `preview-drive-file` | `PUBLIC_SITE_URL` | Authenticated Drive preview. |
| `stamp-one-file` | `PUBLIC_SITE_URL` | Authenticated Storage writes and stamping. |
| `finalize-run` | `PUBLIC_SITE_URL` | Authenticated run status and signed downloads. |
| `anonymize-recipient` | `PUBLIC_SITE_URL` | Owner/admin-only destructive operation. |

The Deno test asserts the exact wildcard allowlist, the site-origin policy for the remaining configured Functions, and absence of credentialed wildcard CORS. This proves source behavior, not deployed Function secrets or gateway behavior.

**UNVERIFIED — staging checks:** test preflight and actual responses for every Function with the staging origin and an untrusted origin. Confirm only the three named public read endpoints return wildcard CORS, none returns `Access-Control-Allow-Credentials`, and every other response allows only the configured staging origin. Verify the Vercel discovery proxy calls work with staging runtime configuration.

### `verify_jwt` configuration

**PROVEN — source configuration:** all 15 `Deno.serve` Functions now have explicit entries in `supabase/config.toml`.

| Function | `verify_jwt` | Reason |
|---|---:|---|
| `did-document` | false | Public DID discovery endpoint. |
| `public-keys` | false | Public key discovery endpoint. |
| `get-credential` | false | Public credential lookup; only public projection/JWT is returned. |
| `verify-credential` | false | Public proof verification endpoint. |
| `manage-recipient-credential` | false | Recipient link/session flow authenticates with its own single-use opaque token, not a Supabase user JWT; rate-limited and credential-scoped. |
| `issue-batch` | true | Issuer workflow. |
| `generate-pdf` | true | Authenticated issuer PDF generation. |
| `create-organization` | true | Owner bootstrap workflow. |
| `send-emails` | true | Organization-role checked mail operation. |
| `accept-organization-invitation` | true | Requires a verified signed-in invitee. |
| `list-drive-folder` | true | Issuer Drive workflow. |
| `preview-drive-file` | true | Issuer Drive workflow. |
| `stamp-one-file` | true | Issuer stamping workflow. |
| `finalize-run` | true | Issuer run status and signed download workflow. |
| `anonymize-recipient` | true | Owner/admin-only destructive workflow. |

**UNVERIFIED — hosted gateway:** for each protected Function in staging, send a request without a bearer token and confirm the gateway rejects it before business logic. For the five public/token-scoped endpoints, confirm the expected public behavior and handler-level restrictions. Do not run these checks against production.

### Public endpoint rate limits

**PROVEN — code review:** all five `verify_jwt = false` endpoints call the shared database-backed HMAC rate limiter before doing endpoint work. `did-document`, `public-keys`, `get-credential`, and `verify-credential` use the default 60 requests per 60 seconds per hashed IP bucket. `manage-recipient-credential` uses 30 per 60 seconds. Missing rate-limit configuration fails closed.

**UNVERIFIED — observed 429:** H2 smoke tests must reach 429 on each public endpoint against staging and capture the response without using production or recipient data.

### Storage policies

**PROVEN — local query and pgTAP:** local `storage.objects` has one policy: authenticated owner/admin/issuer `SELECT` for completed files whose recipient is neither anonymized nor pending anonymization. There are no authenticated insert/update/delete policies; uploads and deletion use the server-side service role. The final local pgTAP rerun passed 268 tests.

**UNVERIFIED — hosted policy parity:** compare the staging `storage.objects` policies and bucket configuration with the checked-in migration. Do not infer hosted policy state from the local database.

### RLS coverage

**PROVEN — local database:** the new `scripts/check-rls-coverage.sql` checks all ordinary/partitioned tables in `public` and `private`, plus `storage.objects`; it raises an exception listing any table without RLS. After `db reset`, the local query counted **26 checked tables, 26 with RLS, 0 without RLS**. A temporary RLS-disabled local probe caused the script to fail with the table name, and the probe was dropped afterward.

**UNVERIFIED — hosted database:** an authorized operator must execute the script using the staging SQL Editor and record its output. This task did not query any hosted database.

### `SECURITY DEFINER` search paths

**PROVEN — local database catalog query:** 32 application `SECURITY DEFINER` functions in `public`/`private`; 32 have a pinned `search_path`; 0 are missing it.

**UNVERIFIED — hosted schema parity:** re-run the catalog check against staging after migrations are applied by the authorized operator.

### Client environment variables and bundle scan

**PROVEN — source check:** client `VITE_*` variables are limited to the public Supabase URL, publishable key, and legacy anon-key name. No service-role key, signing private key, email-provider key, rate-limit secret, or other server secret is configured as a `VITE_*` variable. `.env.example` has an empty publishable-key value.

**PROVEN — real production build and scan:** build, lint, test, and bundle scan ran in a temporary copy of tracked project files with dotenv-named files excluded; `node_modules` was linked to the installed local dependencies. The build transformed 286 modules and emitted 11 files. The final client-bundle scan passed. An initial scan flagged the public `PUBLIC_SITE_URL` identifier as if it were a secret; that public identifier was removed from the scanner’s server-secret list, then the scanner passed on a fresh build. Actual Vercel environment values were not inspected.

### Dependency audit and pinning

**PROVEN — package/source analysis:** the advisory is on the root `ajv@8.17.1` dev dependency. The production `@hookform/resolvers` package declares AJV only as an optional peer; application source imports neither Ajv nor a resolver, and the real client build is checked for bundled AJV code. The advisory is therefore not reachable through current application code in the production bundle, but remains in the developer dependency installation and should be resolved for build/CI hygiene. `npm audit` previously reported 0 high, 0 critical, and 1 moderate; it exits 1 on that finding. The Supabase CLI is exactly pinned to `3.3.0`.

**UNVERIFIED — release disposition:** decide whether to update the AJV development dependency and re-run the audit before release. Confirm all resolved dependency changes in the lockfile.

### Anonymization coverage

**PROVEN — implemented and locally exercised:**

- `recipients`: full name, email, email hash, and salt are cleared; anonymization timestamp is retained.
- Credentials: associated credentials are revoked, their stored credential JSON/JWS/content hash/PDF path are cleared, and revocation-list IDs are retained.
- Access tokens and management sessions: deleted.
- Consent: active consent is withdrawn with a system notice event. Historical consent events retain IDs, scope, and timestamps, not the name/email.
- Stamped files/Storage: Storage paths are deleted before final database anonymization; stamp rows clear Drive ID, hashes, Storage path, and error state. Local integration/pgTAP tests previously exercised deletion and retry behavior.
- `email_events`: payload is replaced with a redaction marker for associated credential IDs.
- `verification_events`: `credential_id` and `ip_hash` are cleared when the recipient is anonymized; method, result, and timestamp remain for aggregate history.
- `revocations.reason`: replaced with the fixed non-PII text `Recipient data anonymized`; credential ID and revocation evidence remain.
- Credential-linked `audit_logs.metadata`: replaced with `{"redacted": true}` through a private, one-row redaction permit. The append-only trigger still rejects all other updates and all deletes.
- `issuance_batches.source_filename`: historical values are cleared by the new migration; a database trigger discards filenames on future insert/update, and the browser no longer sends the CSV filename to `issue-batch`.
- `finalize-run`: service-role RPCs return a download path or run-file status only while the recipient is neither pending anonymization nor anonymized. Deno tests prove no signed URL is created when the path lookup is denied; pgTAP covers eligible, pending, and anonymized states.

**PROVEN — residual privacy limitations:**

- Credential, revocation, audit entity, consent, and anonymized stamp identifiers remain linkable. This is pseudonymous retained evidence, not complete unlinkability.
- Previously issued signed URLs are not recalled by the database guard. Storage deletion during anonymization removes the underlying object; staging must verify the actual Storage behavior and the configured URL TTL.

**Retention decisions still required from the owner (no new retention period was selected):**

1. How long to retain unlinkable verification event method/result/timestamp records, and whether to delete them after a chosen period.
2. How long credential IDs, revocation-list entries, and revocation evidence must remain for verification/legal obligations.
3. How long to retain redacted audit events and their pseudonymous actor/entity identifiers.
4. How long to retain batch metadata, consent history, and other pseudonymous issuance records.
5. Resend/provider-side email event retention and deletion requests, which the application cannot control.
6. Stamped PDFs in Storage, downloaded ZIP/report files, backups, and deletion/restore behavior. No scheduled expiry is implemented.

No hosted data was inspected. The owner must approve those retention choices, then execute synthetic anonymization cases in staging and confirm every store.

## H1 blockers

1. Verify the DID/JWKS rewrites, proxy runtime environment, and retired-key publication against staging; local tests cannot prove deployed Vercel/Supabase behavior.
2. Verify the signed URL guard and Storage deletion behavior against staging, including any URLs created before anonymization.
3. Verify Vercel headers/CSP, per-function CORS, gateway `verify_jwt`, rate-limit 429s, and hosted RLS against staging.
4. Approve the listed retention/deletion decisions and operational procedures.
5. Complete live Drive, phone scan, and 10-file pilot checks; H2 local evidence is below, with the live local endpoint smoke and Storage quota still unverified.

No deployment or push is authorized by this audit.

## Raw command output

The commands below targeted only the local database or an isolated build copy. The build copy excluded `.env*` files. H2 smoke tests have not run in H1.

### Local database reset

```text
Warning: --local isn't needed (local is the default) and will be removed in v4
Target: local stack (127.0.0.1:54322)
Resetting local database...
Recreating database...
Initialising schema...
Seeding globals from roles.sql...
Applying migration 20261124133357_initial_credential_schema.sql...
Applying migration 20261126094500_drive_stamping_p1.sql...
Applying migration 20261126104500_drive_stamping_p3_pipeline.sql...
Applying migration 20261126110000_drive_stamping_p3_failure_lease.sql...
Applying migration 20261126111500_drive_stamping_p5_serial_prefix.sql...
Seeding data from supabase/seed.sql...
Restarting containers...
Finished supabase db reset on branch main.
{"version":"","message":"Reset local database.","target":{"kind":"local","host":"127.0.0.1","port":54322}}
A new version of Supabase CLI is available: v3.4.0 (currently installed v3.3.0)
```

### Local pgTAP

```text
Warning: --local isn't needed (local is the default) and will be removed in v4
Target: local stack (127.0.0.1:54322)
psql:/Users/MyBook Hype AMD/credential-hub/supabase/tests/credential_hub_rls.sql:3: NOTICE:  extension "pgtap" already exists, skipping
/Users/MyBook Hype AMD/credential-hub/supabase/tests/credential_hub_rls.sql .. ok
psql:/Users/MyBook Hype AMD/credential-hub/supabase/tests/drive_stamping_rls.sql:3: NOTICE:  extension "pgtap" already exists, skipping
/Users/MyBook Hype AMD/credential-hub/supabase/tests/drive_stamping_rls.sql .. ok
All tests successful.
Files=2, Tests=258,  1 wallclock secs ( 0.09 usr  0.06 sys +  0.03 cusr  0.17 csys =  0.35 CPU)
Result: PASS
A new version of Supabase CLI is available: v3.4.0 (currently installed v3.3.0)
```

### Deno tests with the configured site origin

```text
Task test:functions deno test --allow-read=supabase/functions/_shared --allow-env=PUBLIC_SITE_URL supabase/functions/_shared supabase/functions/anonymize-recipient
Check supabase/functions/_shared/anonymize-stamped-pdfs_test.ts
Check supabase/functions/_shared/credential_test.ts
Check supabase/functions/_shared/google-drive_test.ts
Check supabase/functions/_shared/http_test.ts
Check supabase/functions/_shared/owner_test.ts
Check supabase/functions/_shared/pdf-metadata_test.ts
Check supabase/functions/_shared/public-credential_test.ts
Check supabase/functions/_shared/recipient-access_test.ts
Check supabase/functions/_shared/signer_test.ts
Check supabase/functions/_shared/site-config_test.ts
Check supabase/functions/_shared/stamping-pdf_test.ts
Check supabase/functions/_shared/verify_test.ts
Check supabase/functions/anonymize-recipient/handler_test.ts
running 5 tests from ./supabase/functions/_shared/anonymize-stamped-pdfs_test.ts
removes stamped PDFs in bounded Storage API batches ... ok (780µs)
does not call Storage when there are no stamped PDFs ... ok (279µs)
surfaces Storage deletion failures without exposing provider details ... ok (1ms)
does not finalize anonymization until all Storage deletions succeed ... ok (578µs)
does not finalize anonymization after a Storage failure ... ok (628µs)
running 6 tests from ./supabase/functions/_shared/credential_test.ts
buildCredential validates OB 3.0 and never includes recipient names ... ok (36ms)
maskRecipientName uses the documented long-name format ... ok (14ms)
maskRecipientName reveals initials only for short or single-word names ... ok (514µs)
maskRecipientName preserves Unicode grapheme initials ... ok (478µs)
buildCredential never includes a recipient name, independent of consent ... ok (775µs)
hashRecipientEmail normalizes email and uses the supplied salt ... ok (1ms)
running 5 tests from ./supabase/functions/_shared/google-drive_test.ts
Drive API URL allowlist accepts only fixed Google API hosts and paths ... ok (1ms)
folder identifiers are strictly validated before an API request ... ok (482µs)
service-account OAuth always posts to the fixed token endpoint ... ok (150ms)
Drive listing constructs a fixed-host request and rejects an attacker URL ... ok (1ms)
file access remains within the selected folder and its first-level subfolders ... ok (1ms)
running 4 tests from ./supabase/functions/_shared/http_test.ts
Edge Function CORS allows only the configured public site origin ... ok (20ms)
readJson parses a bounded JSON request body ... ok (9ms)
readJson rejects oversized bodies even without Content-Length ... ok (1ms)
readJson reports malformed JSON as a client error ... ok (674µs)
running 2 tests from ./supabase/functions/_shared/owner_test.ts
owner allowlist compares normalized verified email addresses ... ok (710µs)
owner allowlist rejects unverified and non-matching accounts ... ok (231µs)
running 1 test from ./supabase/functions/_shared/pdf-metadata_test.ts
credential PDF metadata contains no recipient PII and no XMP packet ... ok (29ms)
running 2 tests from ./supabase/functions/_shared/public-credential_test.ts
public credential projection hides names without active consent ... ok (17ms)
public credential projection applies masked and full consent independently ... ok (521µs)
running 1 test from ./supabase/functions/_shared/recipient-access_test.ts
recipient access tokens are random hex values stored only as a digest ... ok (1ms)
running 2 tests from ./supabase/functions/_shared/signer_test.ts
EnvKeySigner signs VC-JWTs with the matching configured public key ... ok (6ms)
EnvKeySigner rejects mismatched private and public keys ... ok (2ms)
running 2 tests from ./supabase/functions/_shared/site-config_test.ts
public site origin is the sole source for the issuer DID ... ok (1ms)
public site URL rejects non-HTTPS non-loopback origins ... ok (503µs)
running 4 tests from ./supabase/functions/_shared/stamping-pdf_test.ts
stamping preserves page dimensions, strips Info/XMP metadata, and hashes both PDFs ... ok (96ms)
stamping rejects signed, encrypted, rotated, oversized-page-count, and unexpected-size PDFs ... ok (12ms)
stamps a realistic flattened single-image A4 certificate ... ok (25ms)
rejects realistic digitally signed, encrypted, rotated, and non-A4 PDFs ... ok (4ms)
running 3 tests from ./supabase/functions/_shared/verify_test.ts
parseVcJwtHeader accepts a conforming VC-JWT header ... ok (23ms)
parseVcJwtHeader rejects missing content type and unsupported algorithms ... ok (3ms)
parseVcJwtHeader rejects malformed encoded headers ... ok (413µs)
running 3 tests from ./supabase/functions/anonymize-recipient/handler_test.ts
anonymization handler allows owner and admin ... ok (41ms)
anonymization handler denies issuer and viewer ... ok (1ms)
anonymization handler returns 401 when unauthenticated ... ok (823µs)
ok | 40 passed | 0 failed (4s)
```

### Deno type-check

```text
Task check:functions deno check supabase/functions/did-document/index.ts supabase/functions/public-keys/index.ts supabase/functions/get-credential/index.ts supabase/functions/verify-credential/index.ts supabase/functions/issue-batch/index.ts supabase/functions/send-emails/index.ts supabase/functions/generate-pdf/index.ts supabase/functions/create-organization/index.ts supabase/functions/manage-recipient-credential/index.ts supabase/functions/accept-organization-invitation/index.ts supabase/functions/anonymize-recipient/index.ts supabase/functions/list-drive-folder/index.ts supabase/functions/preview-drive-file/index.ts supabase/functions/stamp-one-file/index.ts supabase/functions/finalize-run/index.ts
Check supabase/functions/did-document/index.ts
Check supabase/functions/public-keys/index.ts
Check supabase/functions/get-credential/index.ts
Check supabase/functions/verify-credential/index.ts
Check supabase/functions/issue-batch/index.ts
Check supabase/functions/send-emails/index.ts
Check supabase/functions/generate-pdf/index.ts
Check supabase/functions/create-organization/index.ts
Check supabase/functions/manage-recipient-credential/index.ts
Check supabase/functions/accept-organization-invitation/index.ts
Check supabase/functions/anonymize-recipient/index.ts
Check supabase/functions/list-drive-folder/index.ts
Check supabase/functions/preview-drive-file/index.ts
Check supabase/functions/stamp-one-file/index.ts
Check supabase/functions/finalize-run/index.ts
```

### RLS coverage script and failure-path probe

```text
Target: local stack (127.0.0.1:54322) · default; pass --remote for Credential-hub (nvmnxhxlottahxonkjwv)
DO
```

```text
{"app_tables":26,"rls_disabled":0,"rls_enabled":26}
```

```text
CREATE TABLE
Target: local stack (127.0.0.1:54322) · default; pass --remote for Credential-hub (nvmnxhxlottahxonkjwv)
{"target":{"kind":"local","host":"127.0.0.1","port":54322},"_tag":"Error","error":{"code":"DbQueryExecError","message":"failed to execute query: error: RLS is disabled on application table(s): public.h1_rls_probe_2e9f97b6676f4a1194442a124177c712"}}
Expected fail-closed result observed (exit code 1).
DROP TABLE
```

### SECURITY DEFINER catalog check

```text
{"definer_functions":32,"missing_search_path":0,"with_search_path":32}
```

### Predeploy URL check

```text
> credential-hub@0.0.0 predeploy:check
> node scripts/predeploy-check.mjs

Pre-deploy site configuration passed for https://credential-hub-gules.vercel.app
Derived issuer DID: did:web:credential-hub-gules.vercel.app
```

### npm build, lint, tests, and client bundle scan

```text
=== npm run build (isolated copy; dotenv files excluded) ===
> credential-hub@0.0.0 build
> tsc -b && vite build

vite v8.3.8 building client environment for production...
transforming...
✓ 286 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                                      0.67 kB │ gzip:   0.41 kB
dist/assets/ibm-plex-sans-latin-ext-wght-normal-CIII54If.woff2      30.96 kB
dist/assets/source-serif-4-latin-ext-wght-normal-BVZ5su8S.woff2     42.21 kB
dist/assets/ibm-plex-sans-latin-wght-normal-IvpUvPa2.woff2          45.71 kB
dist/assets/source-serif-4-latin-wght-normal-DMe4EKeb.woff2         50.93 kB
dist/assets/pdf.worker.min-CIqJB0yW.mjs                          1,271.91 kB
dist/assets/index-BvyvsVI9.css                                      33.78 kB │ gzip:   8.52 kB
dist/assets/qr-scanner-worker.min-CJaXo3yu.js                       43.95 kB │ gzip:  10.37 kB
dist/assets/index-DYNwW20V.js                                    1,218.48 kB │ gzip: 422.31 kB
✓ built in 690ms

=== npm run lint (isolated copy; dotenv files excluded) ===
> credential-hub@0.0.0 lint
> eslint .

=== npm test (isolated copy; dotenv files excluded) ===
> credential-hub@0.0.0 test
> vitest run

 RUN  v4.1.12 C:/Users/MyBook Hype AMD/AppData/Local/Temp/credential-hub-h1-final-f510e3de78714cd58f09079c9026fc36

 Test Files  7 passed (7)
      Tests  34 passed (34)
   Start at  12:32:10
   Duration  1.27s (transform 640ms, setup 0ms, import 2.21s, tests 435ms, environment 1ms)

=== npm run verify:client-bundle (real isolated build) ===
Client bundle check passed (11 built files).
```

### `npm audit --json` — summarized fields, not the complete raw JSON

The following captures the finding and totals used in this audit; it is not a byte-for-byte transcript of the full npm JSON report.

```json
{
  "vulnerabilities": {
    "ajv": {
      "name": "ajv",
      "severity": "moderate",
      "isDirect": true,
      "title": "ajv has ReDoS when using `$data` option",
      "url": "https://github.com/advisories/GHSA-2g4f-4pwh-qvx6",
      "range": "7.0.0-alpha.0 - 8.17.1",
      "fixAvailable": {
        "name": "ajv",
        "version": "8.20.0",
        "isSemVerMajor": false
      }
    }
  },
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 1,
      "high": 0,
      "critical": 0,
      "total": 1
    },
    "dependencies": {
      "prod": 124,
      "dev": 174,
      "optional": 72,
      "peer": 0,
      "peerOptional": 0,
      "total": 361
    }
  }
}
```

`npm audit` exits 1 due to the moderate finding. H2 local-only smoke/load evidence is recorded below.

## Final H1 blocker-fix rerun

These are the final post-change local results. The reset and test commands use the repository-pinned Supabase CLI (`3.3.0`); no remote target, deployment, or `.env` file was accessed.

### Database reset

```text
Target: local stack (127.0.0.1:54322)
Resetting local database...
Recreating database...
Initialising schema...
Applying migration 20261124133357_initial_credential_schema.sql...
Applying migration 20261126094500_drive_stamping_p1.sql...
Applying migration 20261126104500_drive_stamping_p3_pipeline.sql...
Applying migration 20261126110000_drive_stamping_p3_failure_lease.sql...
Applying migration 20261126111500_drive_stamping_p5_serial_prefix.sql...
Applying migration 20261126125500_h1_anonymization_redactions.sql...
Applying migration 20261126125600_h1_finalize_run_download_guards.sql...
Finished supabase db reset on branch main.
{"version":"","message":"Reset local database.","target":{"kind":"local","host":"127.0.0.1","port":54322}}
```

### Database tests

```text
credential_hub_rls.sql .... ok
drive_stamping_rls.sql .... ok
stamped_download_rls.sql .. ok
All tests successful.
Files=3, Tests=268
Result: PASS
```

### Deno tests and type-check

```text
deno task test:functions
ok | 47 passed | 0 failed (5s)

deno task check:functions
Check api/issuer-discovery.ts
Check supabase/functions/did-document/index.ts
Check supabase/functions/public-keys/index.ts
Check supabase/functions/get-credential/index.ts
Check supabase/functions/verify-credential/index.ts
Check supabase/functions/issue-batch/index.ts
Check supabase/functions/send-emails/index.ts
Check supabase/functions/generate-pdf/index.ts
Check supabase/functions/create-organization/index.ts
Check supabase/functions/manage-recipient-credential/index.ts
Check supabase/functions/accept-organization-invitation/index.ts
Check supabase/functions/anonymize-recipient/index.ts
Check supabase/functions/list-drive-folder/index.ts
Check supabase/functions/preview-drive-file/index.ts
Check supabase/functions/stamp-one-file/index.ts
Check supabase/functions/finalize-run/index.ts
```

### Isolated frontend validation and real-build scan

```text
=== npm run build (isolated copy; dotenv files excluded) ===
✓ 286 modules transformed.
dist/assets/index-DRl5BpPc.css                                      33.80 kB │ gzip:   8.53 kB
dist/assets/index-Dnq8XzU3.js                                    1,218.45 kB │ gzip: 422.28 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 837ms

=== npm run lint (isolated copy; dotenv files excluded) ===
> eslint .

=== npm test (isolated copy; dotenv files excluded) ===
Test Files  7 passed (7)
Tests       34 passed (34)

=== npm run verify:client-bundle (real isolated build) ===
Client bundle check passed (11 built files).
```

## H2 local smoke and load evidence

No hosted URL, remote database, deployment, or dotenv file was used. `scripts/smoke-test.mjs` accepts a base URL and known test credential but rejects non-loopback hosts. It checks DID/JWKS and key agreement, verification of the known credential, crawler OG metadata, security headers, unknown-credential 404, and a verification-endpoint 429. It does not mutate business data; its rate-limit probe intentionally consumes local rate-limit counters.

**Smoke runner test:** a local HTTP test harness exercises all seven checks, including successful credential verification, unknown-ID 404, 429, and refusal of a hosted target. This verifies the runner behavior, not the live app deployment.

**Live local endpoint smoke: UNVERIFIED.** The local seed is intentionally empty (`supabase/seed.sql` contains no credential), so there is no known test credential UUID to pass to the read-only runner. The app's dynamic `/c/:id` crawler metadata is implemented in Vercel middleware, which the plain local Vite server does not execute. Do not substitute the production URL. To complete this check locally, create a synthetic credential and key in the local database, start the local Vercel-compatible runtime with explicit local Supabase process variables (not dotenv), then run:

```text
node scripts/smoke-test.mjs http://127.0.0.1:<local-vercel-port> --credential-id <local-synthetic-credential-uuid> --supabase-url http://127.0.0.1:54321 --anon-key <local-anon-or-publishable-key>
```

`RATE_LIMIT_HASH_SECRET` and a forwarding IP must also be configured in the local Functions runtime or the rate-limit probe will fail closed (HTTP 503 rather than 429). The runner's unit harness returns PASS; live local endpoint results remain unverified.

### 300-credential issuance dry run

`deno run scripts/h2-load-dry-run.ts` validates, signs with a newly generated ephemeral Ed25519 key, and discards 300 synthetic OB 3.0 VC-JWTs in memory. It performs no database or Storage writes.

| Metric | Result |
|---|---:|
| Credentials | 300 |
| Elapsed | 361.3 ms |
| Throughput | 830.43 credentials/s |
| Mean VC-JWT size | 1,473 bytes |

This measures local credential construction/schema validation/signing only; it does not measure Postgres RPC latency, credential persistence, or concurrent users.

### 300-file stamping dry run

The same script creates a flattened A4-landscape synthetic certificate with a noisy 1400 × 990 RGB background, then stamps 300 distinct credential URLs serially. Source and output PDFs remain in process memory; no Storage objects are written. Storage estimate is the sum of the actual 300 output byte lengths, excluding object metadata, versioning, backups, and replication.

| Metric | Result |
|---|---:|
| Source PDF | 1,210,938 bytes |
| Stamped PDFs | 300 |
| Stamping elapsed | 9,697.7 ms |
| Throughput | 30.94 PDFs/s |
| Mean stamped PDF | 1,215,397 bytes |
| Estimated output total | 364,619,220 bytes (0.365 GB / 0.34 GiB) |
| Peak process RSS | 277.08 MiB |
| Peak JS heap | 88.73 MiB |
| Final RSS / heap | 267.03 / 88.73 MiB |

The runtime retained most of its peak RSS at completion; the dry run is serial and does not model the browser's configured concurrency, Edge Function memory limits, or actual Storage quota. Measure the Storage quota separately before the pilot.

### Bundle sizes and route-splitting proposal

Fresh production build in an isolated copy with dotenv files excluded; raw emitted asset sizes:

| Chunk / asset | Bytes | Approx. size |
|---|---:|---:|
| `pdf.worker.min-CIqJB0yW.mjs` | 1,271,915 | 1,242.1 KiB |
| `index-ivW5u9Ys.js` | 1,218,450 | 1,189.9 KiB (gzip 422.28 kB) |
| `source-serif-4-latin-wght-normal-DMe4EKeb.woff2` | 50,936 | 49.7 KiB |
| `ibm-plex-sans-latin-wght-normal-IvpUvPa2.woff2` | 45,712 | 44.6 KiB |
| `qr-scanner-worker.min-CJaXo3yu.js` | 43,951 | 42.9 KiB |
| `source-serif-4-latin-ext-wght-normal-BVZ5su8S.woff2` | 42,212 | 41.2 KiB |
| `index-HC-0VRWf.css` | 33,964 | 33.2 KiB |
| `ibm-plex-sans-latin-ext-wght-normal-CIII54If.woff2` | 30,964 | 30.2 KiB |

The production build reports a chunk-size warning above 500 kB. No splitting changes were made in H2. Proposed follow-up: lazy-load `Admin` at the `/admin` route; move the share credential page into its own lazy route; dynamically import `qr-scanner` only when the camera control is opened and `qrcode` only for pages that render QR images; load PDF preview/stamping code only inside the stamping workflow. Keep the 1.27 MB PDF worker as a separately fetched worker asset and verify the resulting route chunks with the real-build scan and Lighthouse before approval.

### H2 failure modes and evidence

- **Observed build warning:** the main JavaScript chunk is 1.218 MB minified, with a 422.28 kB gzip size; the PDF worker is a separate 1.272 MB asset. Route-level splitting is proposed above, not implemented.
- **Observed memory consideration:** the 300 sequential stamps peaked at 277.08 MiB RSS, with 267.03 MiB RSS still resident at completion.
- **Storage capacity is not verified:** the measured output estimate is approximately 0.365 GB for 300 synthetic files; actual quota, Storage metadata, and backup overhead were not queried.
- **Smoke implementation verified only by local HTTP harness:** it covers the expected HTTP 404 and 429 behavior; no seeded test credential or Vercel-compatible local runtime was available to prove those responses against live local app services.
- **Rate-limit configuration failure behavior:** the shared limiter rejects missing IP/`RATE_LIMIT_HASH_SECRET` configuration; the smoke runner will show that as an unexpected service response rather than falsely reporting a 429.

### H2 raw output

```text
node --test scripts\tests\smoke-test.node.mjs
✔ smoke runner checks discovery, verification, OG, security, 404, and 429 locally (169.667ms)
✔ smoke runner refuses hosted targets (4.7737ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 615.0952
```

```json
{
  "result": "PASS",
  "mode": "in-memory dry run; no database or Storage writes",
  "credentialCount": 300,
  "issuance": {
    "elapsedMs": 361.3,
    "credentialsPerSecond": 830.43,
    "averageVcJwtBytes": 1473
  },
  "stamping": {
    "elapsedMs": 9697.7,
    "filesPerSecond": 30.94,
    "sourcePdfBytes": 1210938,
    "sourceRaster": "1400x990 RGB synthetic certificate artwork",
    "averageStampedPdfBytes": 1215397,
    "totalStampedBytesFor300": 364619220,
    "storageEstimateDecimalGB": 0.365,
    "storageEstimateGiB": 0.34
  },
  "memory": {
    "initialRssMiB": 104.28,
    "peakRssMiB": 277.08,
    "peakHeapUsedMiB": 88.73,
    "finalRssMiB": 267.03,
    "finalHeapUsedMiB": 88.73
  },
  "totalElapsedMs": 10999.1
}
```

```text
=== production build (dotenv-excluded isolated copy) ===
✓ 286 modules transformed.
dist/assets/pdf.worker.min-CIqJB0yW.mjs                          1,271.91 kB
dist/assets/index-HC-0VRWf.css                                      33.96 kB │ gzip:   8.55 kB
dist/assets/qr-scanner-worker.min-CJaXo3yu.js                       43.95 kB │ gzip:  10.37 kB
dist/assets/index-ivW5u9Ys.js                                    1,218.45 kB │ gzip: 422.28 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 723ms
=== npm run lint ===
> eslint .
=== npm test ===
Test Files  7 passed (7)
Tests       34 passed (34)
=== npm run verify:client-bundle ===
Client bundle check passed (11 built files).
```

H2 is complete to the extent proven locally. Do not proceed to H3 until review; live endpoint smoke and Storage quota remain explicitly unverified.

## H3 failure modes

**Scope:** local source, mocked provider calls, local Deno/Vitest tests, and local pgTAP only. No live Resend, Drive, hosted database, deployment, or `.env` values were used. This phase did not start H4.

### Results and remaining uncertainty

| Failure mode | Evidence and observed behavior | Status |
|---|---|---|
| Resend network outage / HTTP rejection | `submitResendEmail` converts transport errors and non-2xx responses into failed attempts; the stored reservation id is sent as Resend's idempotency key. Deno tests cover a thrown transport error and HTTP 503. A 2xx records provider acceptance and a provider message ID, not delivery. | **PROVEN locally** for network/HTTP handling. |
| Resend bounce / complaint | There is no Resend webhook handler or bounce/complaint state transition in the app. A provider-accepted message can still bounce or receive a complaint after this request completes. | **UNVERIFIED** delivery/bounce/complaint tracking; live provider behavior was not tested. |
| Drive 403 / 429 | Mocked Deno tests distinguish ordinary permission 403, quota-related 403, and 429 with `Retry-After`. Frontend retry tests prove at most three calls, exponential delays, honoring the larger provider retry hint, and propagation after exhaustion. | **PROVEN locally** with mocks; live Drive quota behavior remains unverified. |
| Storage failure during stamping | `stamp-one-file` marks upload failure as `storage_upload_failed`, releases the processing lease through the failure RPC, and returns 503. pgTAP simulates this persisted failure, reclaims the same file with the same source hash, and records another failure. This tests the database state transition, not an injected failure from a running Storage service. | **PROVEN locally** for state/retry logic; **UNVERIFIED** as a full Storage fault-injection integration. |
| Browser closes during a batch | Run and file state is stored in the database. The batch detail/run history offers **Open / resume** and **Resume pending or failed files**; reloading the run re-reads stored statuses before processing. | **Documented behavior; UNVERIFIED** by an automated browser-close/resume test. |
| Duplicate issuance submit | The pgTAP case submits the same successful row key twice and asserts `replayed`, one issuance row, and an unchanged processed count. The stamping pgTAP suite also tests idempotent run creation and Drive-file registration. | **PROVEN locally**. |
| Used / expired recipient access link | pgTAP asserts a redeemed token cannot be redeemed again and an expired token is rejected. The handler returns 400 for invalid/expired/reused access links; an expired management session returns 401. | **PROVEN locally** by pgTAP and handler behavior; hosted Auth timing is not exercised. |
| Revoked credential verification | `verifyCredentialJwt` returns failed `revocation` and `registered` checks when a revocation row exists or the credential status is revoked. | **Source behavior proven; UNVERIFIED** as a database-backed verification endpoint test. |
| Expired credential verification | Verification's `validUntil` check fails for an expired database status or a `validUntil` earlier than the current time. | **Source behavior proven; UNVERIFIED** as a database-backed verification endpoint test. |
| Unknown `kid` | A missing issuer-key lookup is rejected as `Unknown signing key`; the unit test covers that rejection path. | **PROVEN locally** for the missing-key guard; **UNVERIFIED** against a live database lookup. |
| Tampered VC-JWT | A locally generated EdDSA VC-JWT verifies before tampering and rejects a modified signature with `Credential signature is invalid`. | **PROVEN locally** cryptographically; no hosted verification request was made. |
| Download while anonymization is pending/done | Deno tests assert no signed URL is issued unless the database returns an eligible path. pgTAP covers pending/anonymized recipient visibility and the download-path guard. | **PROVEN locally**; hosted Storage URL invalidation/TTL remains unverified as noted in H1. |
| UI handling of 429 / 503 | The shared request-message mapper shows retry guidance for either a `Response` context with 429 or an error status of 503. It is wired to verification, credential detail, Admin, and stamping errors. Vitest covers both status paths. | **PROVEN locally** for mapping; no deployed UI/gateway was exercised. |

### Stamping request and memory bounds

**PROVEN from the local request contract/source:** `stamp-one-file` accepts one `stampFileId`, loads and processes that one file, and returns one file result; it has no loop over a run or PDF collection. The browser orchestrates separate invocations with concurrency 2. Each source PDF is capped at 15 MiB. The page limit defaults to 50 and may be configured up to 100 pages.

**UNVERIFIED numeric memory bound:** neither the repository nor the local function configuration sets a per-invocation memory ceiling, and no per-invocation peak-memory measurement was captured. A 15 MiB source cap is not a memory bound: PDF parsing and output buffers can expand beyond source size. Do not infer the browser's two-request concurrency as an Edge Function memory guarantee.

### Raw local verification output

```text
deno task test:functions
Check supabase/functions/_shared/google-drive_test.ts
Check supabase/functions/_shared/resend-provider_test.ts
Check supabase/functions/_shared/verify_test.ts
Drive distinguishes forbidden access from quota-related 403 and 429 responses ... ok
Resend transport outage is recorded as a failed submission ... ok
Resend HTTP rejection is failed and preserves the reservation idempotency key ... ok
Resend acceptance records provider message id but is not a delivery receipt ... ok
missing key lookup rejects an unknown VC-JWT kid ... ok
verifyCredentialProof accepts valid signatures and rejects tampered VC-JWTs ... ok
ok | 53 passed | 0 failed (8s)
```

```text
deno task check:functions
Check supabase/functions/send-emails/index.ts
Check supabase/functions/stamp-one-file/index.ts
Check supabase/functions/finalize-run/index.ts
Exit code: 0
```

```text
npm test
Test Files  9 passed (9)
Tests       39 passed (39)
Duration    3.59s
```

```text
npm run lint
> eslint .

npm run typecheck
> tsc -b
Exit code: 0
```

```text
npm exec vitest -- run src/features/stamping/service.test.ts src/lib/request-error.test.ts
Test Files  2 passed (2)
Tests       5 passed (5)
Duration    920ms
```

```text
npm exec supabase -- test db --local
Target: local stack (127.0.0.1:54322)
credential_hub_rls.sql .... ok
drive_stamping_rls.sql .... ok
stamped_download_rls.sql .. ok
All tests successful.
Files=3, Tests=276
Result: PASS
```

H3 is complete to the locally verifiable extent above. **Blockers / UNVERIFIED:** Resend bounce/complaint lifecycle; live Drive behavior; an injected real Storage outage and end-to-end resume; browser-close/resume automation; database-backed expired/revoked credential endpoint tests; hosted 429/503 rendering; and a measured/configured Edge Function memory ceiling. Stop here before H4.

## H4 UI and accessibility

**Scope:** local frontend source, an isolated production build, and browser checks against `127.0.0.1`. The isolated copy excluded dotenv files and used `https://h4-project.invalid` with a test-only publishable key; Chrome's host resolver was configured to block non-local hosts during Lighthouse. No remote database, deployment, or live credential was accessed.

### Route, accessibility, and responsive checks

axe-core 4.14.1 was run for WCAG 2.0/2.1 A/AA at a 360 × 800 viewport. After fixing the detected contrast failures, all audited states had zero violations and no horizontal overflow:

| Route/state | axe violations | Document width |
|---|---:|---:|
| `/` | 0 | 348 px |
| `/verify/<synthetic-id>` | 0 | 345 px |
| `/c/<synthetic-id>` loading state | 0 | 360 px |
| `/manage` without a valid recipient link | 0 | 360 px |
| `/invite` without an invitation token | 0 | 360 px |
| `/admin` sign-in | 0 | 360 px |
| `/admin` synthetic local session, dashboard loading/empty state | 0 | 345 px |
| Not Found | 0 | 360 px |

These are route-shell and synthetic states, not proof of every success/error state. The dashboard mock never completed its Supabase-backed organization request, so the authenticated issuance wizard and stamping mandatory-review screen could not be reached without a functioning backend. Their axe coverage and actual narrow-screen behavior are **UNVERIFIED**. `/manage` and `/invite` were checked only without valid tokens; live recipient/invitation flows are **UNVERIFIED**. The 360 px checks do not certify every device width.

The browser confirmed the offline and restored-connection notices appear when the corresponding browser events are dispatched. This verifies the UI transition, not real offline write/retry behavior. New error/network copy is centralized in `src/copy/id.ts`; English interface copy elsewhere has not been fully migrated to a localization module.

### UI changes and tests

**PROVEN locally:** the active portal and Admin shells have skip links and named landmarks; the network notice is announced as status; the stamping preview has a keyboard/numeric positioning alternative; the match list is expressed as a semantic table; loading and empty states are exposed as status; and provider errors are mapped to safe localized guidance rather than rendering raw `Error.message`. Decorative gradients and star glyph decoration were removed in the touched UI; no emoji icon set or invented metric was added.

The public share/loading, verification, invitation, management-link, Admin, and stamping catch paths use safe fallbacks. `src/lib/request-error.test.ts` verifies 429/503 retry guidance and that provider error text is not exposed. `src/features/stamping/service.test.ts` verifies bounded Drive 403/429 retries and backoff. The final Vitest suite passed 41 tests.

The first axe run found contrast failures in the Admin dashboard labels/empty states and the credential loading state. Those colors were darkened in `src/App.css`; the final axe pass above includes the rebuilt versions. The wizard and stamping review still need a deterministic local mock backend or component-level browser harness before those states can be considered audited.

### Lighthouse and bundle measurements

Lighthouse 13.6.0 ran against the isolated production build. These are local, simulated Lighthouse measurements, not staging measurements:

| Route | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | 80 | 100 | 100 | 91 | 775 ms | 775 ms | 823 ms | 0.042 |
| `/verify/<synthetic-id>` | 87 | 100 | 100 | 91 | 764 ms | 764 ms | 494 ms | 0.000 |
| `/c/<synthetic-id>` | 71 | 100 | 96 | 91 | 763 ms | 5,014 ms | 439 ms | 0.000 |
| `/manage` | 90 | 100 | 100 | 91 | 765 ms | 765 ms | 424 ms | 0.001 |

The credential route's request was intentionally unable to reach a backend because the test host is `.invalid`; its 5,014 ms LCP and category scores are not representative of a working credential page. `/manage` was an invalid-link shell, not a recipient-management session. Do not treat these as production performance claims.
These Lighthouse numbers predate the final route-splitting build and are retained as historical measurements only; no post-split Lighthouse run completed in this phase.

The original H4 build measurement below is historical; route splitting was subsequently implemented. The current build and bundle results are recorded in the H4/H5 completion addendum.

The earlier H2 comparison and original bundle-size increase are historical. Route splitting is now implemented and measured below; the large PDF worker and stamping chunk remain deferred rather than part of the initial route load.

### H4 raw local outputs

```text
axe-core 4.14.1, WCAG 2.0/2.1 A/AA, viewport 360 x 800
/                                      0 violations; width 348
/verify/<synthetic-id>                 0 violations; width 345
/c/<synthetic-id> loading state        0 violations; width 360
/manage, no valid recipient link       0 violations; width 360
/invite, no invitation token           0 violations; width 360
/admin sign-in                         0 violations; width 360
/admin mock dashboard loading/empty    0 violations; width 345
Not Found                              0 violations; width 360
```

```text
Browser-dispatched offline event:
Anda sedang offline. Perubahan baru tidak akan tersimpan sampai koneksi pulih.
Browser-dispatched online event:
Koneksi internet pulih.
```

```text
Lighthouse 13.6.0; isolated local production build; DNS blocked except loopback
/                                      80 / 100 / 100 / 91; FCP 775 ms; LCP 775 ms; TBT 823 ms; CLS 0.042
/verify/<synthetic-id>                 87 / 100 / 100 / 91; FCP 764 ms; LCP 764 ms; TBT 494 ms; CLS 0.000
/c/<synthetic-id>                      71 / 100 / 96 / 91; FCP 763 ms; LCP 5014 ms; TBT 439 ms; CLS 0.000
/manage                                90 / 100 / 100 / 91; FCP 765 ms; LCP 765 ms; TBT 424 ms; CLS 0.001
Score order: Performance / Accessibility / Best Practices / SEO
```

```text
npm test
Test Files  9 passed (9)
Tests       41 passed (41)

npm run lint
> eslint .

npm run typecheck
> tsc -b

npm run verify:client-bundle
Client bundle check passed (12 built files).
```

### H4 blockers

1. Provide a deterministic local authenticated fixture/backend, then run axe and 360 px checks on the actual issuance wizard and stamping review, plus authenticated `/manage` and invitation success/error states.
2. The large PDF worker and Drive stamping chunk still exceed Vite's 500 kB advisory threshold; they are lazy-loaded, but should be reduced or accepted against measured device performance before launch.
3. Repeat Lighthouse on a local/staging deployment with representative credential and recipient data paths; synthetic backend-disabled measurements are not production evidence.
4. Consolidate the remaining English interface copy if complete Indonesian localization is required; only the new error/network strings were centralized in this phase.

H4 is complete only to the locally proven extent above. H5 operational documents and launch gates are recorded below; this does not represent production approval.

## H4/H5 completion addendum

**Scope:** local frontend and documentation changes only. No remote database, deployment, push, or `.env` access was performed. The browser session for the prior synthetic preview timed out while navigating, so no additional authenticated UI state is claimed from that attempt.

### H4 implementation and current bundle

Admin and Drive stamping are lazy-loaded; the stamping workspace is imported only after an authorized user opens it. QR scanner and QR generation remain on demand. Current `npm run build` output:

```text
288 modules transformed.
pdf.worker.min-CIqJB0yW.mjs                          1,271.91 kB
index-BurkeuUD.css                                      36.53 kB │ gzip:   9.03 kB
rolldown-runtime-pP25SEvz.js                              0.98 kB │ gzip:   0.56 kB
qr-scanner.min-DXgKb0Y-.js                              15.75 kB │ gzip:   5.58 kB
browser-BImNNX9d.js                                     23.48 kB │ gzip:   8.87 kB
qr-scanner-worker.min-CJaXo3yu.js                       43.95 kB │ gzip:  10.37 kB
Admin-DIx3WGco.js                                       49.37 kB │ gzip:  14.79 kB
index-DkmL_v7R.js                                      430.81 kB │ gzip: 125.33 kB
DriveStamping-BKDZ7q84.js                              995.98 kB │ gzip: 348.59 kB
Client bundle check passed (16 built files).
```

The browser preview route timed out in the integrated browser; HTTP from the local PowerShell client returned 200 for `/admin`. The pre-existing axe results above remain the only browser accessibility evidence: zero violations across eight unauthenticated/shell states at 360 px. Authenticated issuance, stamping review, and recipient-link flows remain **UNVERIFIED**. Indonesian navigation, error, network, and stamping-workspace copy is centralized in `src/copy/id.ts`; most product interface labels are still English.

Current targeted validation raw output:

```text
npm test
Test Files  9 passed (9)
Tests       41 passed (41)

npm run lint
> eslint .

npm run typecheck
> tsc -b

deno task test:functions
ok | 55 passed | 0 failed (16s)

deno task check:functions
Checked all configured Edge Function entrypoints with no reported errors.

npm run verify:client-bundle
Client bundle check passed (16 built files).
```

### H5 operational and privacy deliverables

- `docs/deploy.md` starts with a do-not-push-to-main warning and specifies the staging-first production rollout order.
- `docs/runbook.md` covers separate staging key generation/offline backup, owner-account recovery, signing-key compromise, rollback, backup/restore, and Drive stamping operations. It is explicitly a staging runbook; it does not authorize production operations.
- `docs/operations.md` defines uptime, Vercel, Supabase, email, Storage, anonymization, and error-aggregation signals; proposed thresholds are explicitly pending owner approval. Incident-contact entries are placeholders in a restricted system, not real contacts.
- `docs/privacy-model.md` covers public projection, consent, anonymization, artifacts, and the retention decisions still required. No retention period is silently set.
- `docs/privacy/terms-draft.md` and `docs/privacy/drive-stamping-terms-draft.md` are clearly marked **DRAFT — NEEDS LEGAL REVIEW**; neither is an approved notice or legal advice.
- `docs/launch-checklist.md` provides owner/second-reviewer sign-offs and production go/no-go gates.

### Remaining blockers — H4/H5 and release-wide

1. **Local database verification:** the local Supabase reset/pgTAP run previously failed because Docker Desktop's Linux engine was unavailable. Start Docker Desktop, confirm its Linux engine is ready, then run `npx supabase db reset` followed by `npx supabase test db` using only the local stack. Do not use remote flags. This also leaves migrations and database-backed H4 states unverified.
2. **Authenticated H4 coverage:** run axe and 360 px checks with deterministic synthetic authenticated fixtures for the issuance wizard, stamping review, invitation success/error, and authenticated `/manage`; verify loading, empty, error, offline, 429, and 503 states. The current integrated browser navigation timed out, so do not treat it as passing evidence.
3. **Bundle/device performance:** initial application JS is 430.81 kB (125.33 kB gzip), but the lazily loaded stamping chunk is 995.98 kB (348.59 kB gzip) and the PDF worker is 1,271.91 kB. Repeat Lighthouse with working synthetic data paths and test on target mobile devices before accepting these costs.
4. **Owner retention decision:** approve a retention period and deletion procedure for stamped Storage PDFs, ZIP/report copies, verification events, audit/consent records, batch metadata, credential/revocation evidence, backups, and provider email events. Implement scheduled purge if required by that decision.
5. **Staging/operator checks:** configure and test error aggregation with PII scrubbing; fill and verify incident contacts in the restricted system; rehearse restore; verify Drive 10-file pilot, printed-phone QR, mail sandbox, DNS, production URL, and issuer-key custody in staging. These remain **UNVERIFIED** until an authorized owner/operator completes them.
6. **Legal and product copy:** obtain counsel approval for the privacy/terms draft. If complete Indonesian localization is a release requirement, migrate the remaining English UI copy into the localization module and test all routes.

**Current release decision: NO-GO.** Local frontend and Deno validation passed, but database-backed checks and the staging/owner gates above are not proven. Do not deploy, push, or describe the service as production-ready on this evidence alone.
