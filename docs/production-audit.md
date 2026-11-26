# Production readiness audit — H1

**Scope:** local repository, local Supabase stack, and a production-mode frontend build made in an isolated temporary copy. No hosted database, deployment, or `.env` file was accessed. The supplied public origin was passed as a process environment value to the predeploy check.

**Status meanings:** `PROVEN` means the cited local command/source check produced the stated result. `PROVEN — GAP` means local evidence confirms a requirement is not met. `UNVERIFIED` means it requires operator checks against the intended staging deployment or its live configuration; exact steps are included.

## Findings

### DID document, JWKS, and `issuer_keys`

**PROVEN — GAP: the `did:web` well-known route is not present in the repository.** The site origin derives `did:web:credential-hub-gules.vercel.app`, whose standard DID document URL is `https://credential-hub-gules.vercel.app/.well-known/did.json`. No static `did.json`, `.well-known/did.json`, `jwks.json`, or `.well-known/jwks.json` exists. The Vercel config has only a catch-all SPA rewrite. The application does have separate Supabase Function endpoints: `did-document` returns a DID document, and `public-keys` returns a JWKS-shaped `{ "keys": [...] }` object. Both read `kid` and `public_jwk` from `issuer_keys`; both currently filter with `status != ''`, so retired keys are published as well as active keys. Issuance itself selects `status = 'active'`.

The local database and function sources prove how the endpoints are built, not that a conforming `did:web` resolver can discover them from the site origin. Treat DID interoperability as blocked until the well-known route exists and the active/retired key-publication policy is confirmed.

**UNVERIFIED — staging steps:** after the route is implemented, request `/.well-known/did.json` at the staging site origin and confirm its `id` equals the configured DID. Request the staging `did-document` and `public-keys` endpoints with the staging publishable key, compare all `kid` values and public JWKs, and verify that each key needed to validate historical credentials remains published. Do not use production signing keys for this check.

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

**PROVEN — code and test:** the shared Edge Function response helper now derives `Access-Control-Allow-Origin` from the normalized `PUBLIC_SITE_URL`, with a loopback-only local fallback. The two binary/JWT responses use the same header object; no `Access-Control-Allow-Origin: *` remains in Edge Function source. A Deno test compares the header to the configured origin. With the supplied site origin set in the process, `deno task test:functions` passed **40 tests**.

**UNVERIFIED — deployed secret/runtime:** staging steps: send an `OPTIONS` request to every Function with `Origin: <staging-origin>` and confirm `Access-Control-Allow-Origin` is exactly that origin. Repeat with `Origin: https://untrusted.invalid`; confirm the response does not reflect that origin. Check binary `generate-pdf` and VC-JWT `get-credential` responses as well as JSON responses. Confirm Supabase Function `PUBLIC_SITE_URL` is set to the staging origin.

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

**PROVEN — local query and pgTAP:** local `storage.objects` has one policy: authenticated owner/admin/issuer `SELECT` for completed files whose recipient is neither anonymized nor pending anonymization. There are no authenticated insert/update/delete policies; uploads and deletion use the server-side service role. The local pgTAP suite passed 258 tests.

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

**PROVEN — `npm audit --json`:** 361 dependency entries; **0 high, 0 critical, 1 moderate**. The moderate finding is direct dev dependency `ajv@8.17.1`, GHSA-2g4f-4pwh-qvx6 (ReDoS when `$data` is enabled), with a non-major fix available at `8.20.0`. `npm audit` exits 1 because of this finding. The Supabase CLI is exactly pinned to `3.3.0`; its CLI output notes `3.4.0` is available. `package-lock.json` pins the resolved dependency tree for `npm ci`; most `package.json` ranges still use semver carets, so versions are not all exact in the manifest.

**UNVERIFIED — release disposition:** decide whether to update the AJV development dependency and re-run the audit before release. Confirm all resolved dependency changes in the lockfile.

### Anonymization coverage

**PROVEN — implemented and locally exercised:**

- `recipients`: full name, email, email hash, and salt are cleared; anonymization timestamp is retained.
- Credentials: associated credentials are revoked, their stored credential JSON/JWS/content hash/PDF path are cleared, and revocation-list IDs are retained.
- Access tokens and management sessions: deleted.
- Consent: active consent is withdrawn with a system notice event. Historical consent events retain IDs, scope, and timestamps, not the name/email.
- Stamped files/Storage: Storage paths are deleted before final database anonymization; stamp rows clear Drive ID, hashes, Storage path, and error state. Local integration/pgTAP tests previously exercised deletion and retry behavior.
- `email_events`: payload is replaced with a redaction marker for associated credential IDs.

**PROVEN — gaps requiring correction or an explicit policy:**

- `verification_events` contains `credential_id` and `ip_hash`; the anonymization function does not modify it. No application write path to this table was found in the repository, so current hosted row count/content is **UNVERIFIED**. Decide whether to delete or redact rows on anonymization and add a behavioral test before treating coverage as complete.
- `revoke_credential(p_reason)` accepts free-form text and stores it in both `revocations.reason` and `audit_logs.metadata.reason`. Anonymization does not redact an existing reason or audit metadata. A reason can contain recipient PII; constrain it to non-PII values or add a carefully reviewed redaction strategy and test.
- `issuance_batches.source_filename` is stored as supplied and is not scrubbed during recipient anonymization. Confirm filenames are prohibited from containing recipient PII or remove/replace them under a documented policy.
- Consent/stamp/credential/revocation/audit identifiers remain linkable after anonymization. This is pseudonymous retained evidence, not complete unlinkability.
- `finalize-run` signs completed-file URLs using the service-role client without checking `anonymization_requested_at`. During the interval between anonymization request and Storage deletion, a new five-minute URL may still be minted despite the direct Storage read policy. Add a recipient-state guard and test this race before release.

**UNVERIFIED — hosted data:** no production or staging rows were inspected. The authorized owner must decide retention for verification events, free-form revocation reasons, source filenames, provider records, and pseudonymous audit links; then execute synthetic anonymization cases in staging and confirm all specified stores.

## H1 blockers

1. Implement a standards-resolvable `/.well-known/did.json` path and verify its DID/JWKs against `issuer_keys`; confirm retired-key publication semantics.
2. Fix anonymization gaps for verification events and free-form revocation/audit metadata; decide treatment of stored source filenames.
3. Prevent service-role signed URL issuance while anonymization is pending.
4. Verify Vercel headers/CSP, Supabase CORS origin, gateway `verify_jwt`, rate-limit 429s, and hosted RLS against staging.
5. Resolve the moderate AJV advisory and review the CLI update notice.
6. Approve retention and deletion procedures; live Drive, phone scan, 10-file pilot, deployed configuration, and H2 smoke/load evidence remain outstanding.

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

`npm audit` exits 1 due to the moderate finding. No H2 smoke-test output exists yet; it is deferred until that phase is approved.
