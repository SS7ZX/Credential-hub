# Operations and deployment

## Architecture and trust boundaries

- The React/Vite SPA is deployed as static assets on Vercel. Supabase hosts Postgres, Auth, and the Edge Functions.
- The browser receives only the Supabase project URL and anon key. Never expose the Supabase service-role key, Resend API key, issuer private key, owner allowlist configuration, or rate-limit secret in a `VITE_*` variable.
- Issuance, revocation, serial allocation, owner bootstrap, and recipient management state changes are performed by Postgres RPCs. Edge Functions authenticate and validate requests before invoking them.
- Resend traffic is sent only by `send-emails`; the browser never contacts the email provider.
- Public credential and OG metadata responses use the explicit projection from `get-credential`. Do not add recipient email, identity hashes, salts, private JWS content, or other internal fields to this projection.

## Local release gate

Use Docker Desktop with the local Supabase stack running. These commands target only `127.0.0.1:54322`:

```powershell
npm ci
npm run build
npm run lint
npm test
npx supabase db reset
npx supabase test db
npx deno task --config deno.json test:functions
npx deno task --config deno.json check:functions
```

`db reset` destroys and recreates the local Supabase database. It does not update a hosted project. Never add `--remote` to these checks.

## Vercel static SPA

1. Import the repository into Vercel and select the Vite preset. Use `npm ci` as the install command, `npm run build` as the build command, and `dist` as the output directory.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel's Production, Preview, and Development environments as appropriate. For older Supabase projects, `VITE_SUPABASE_ANON_KEY` remains a supported fallback. Both keys are public client values, not authorization secrets. Set the matching `PUBLIC_SITE_URL` as a build-time public origin.
3. Keep the root `middleware.ts` matcher restricted to `/c/:id`. It returns static `index.html` for normal visitors and uses only `get-credential`'s public projection to add crawler metadata. The Vercel Routing Middleware Node.js runtime is selected explicitly.
4. `vercel.json` rewrites SPA deep links to `index.html`. Test `/`, `/admin`, `/manage`, `/verify/<uuid>`, and `/c/<uuid>` on a preview deployment.
5. Confirm the Vercel build recognizes the Vite preset and the root Routing Middleware entrypoint. A local Vite build cannot validate Vercel's deployment routing; run and inspect a Vercel preview before promoting it.

Vercel documentation:

- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Routing Middleware](https://vercel.com/docs/routing-middleware)
- [Routing Middleware JavaScript reference](https://vercel.com/docs/routing-middleware/js-reference)
- [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)

## Supabase preparation

1. Review the migration diff, ADRs, and full behavioral pgTAP suite before applying schema changes to any hosted database. A local reset is not approval to modify a hosted database.
2. Have the database owner apply the reviewed migration to the intended Supabase project. This repository task must not run `supabase db push --remote` or request/store the hosted database password.
3. In Supabase Auth, configure the production Site URL and exact redirect allowlist. The repository config requires email confirmation. Bootstrap the owner account through Supabase Auth, verify its email, and set the matching `ISSUER_OWNER_EMAIL` secret. Public signup is not organization authorization: only that verified owner can bootstrap an organization.
4. Set the application-specific Edge Function values in Supabase: `ISSUER_OWNER_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_DAILY_PLAN_LIMIT`, `RESEND_SANDBOX`, `RESEND_SANDBOX_TO`, `PUBLIC_SITE_URL`, `RATE_LIMIT_HASH_SECRET`, `CREDENTIAL_SIGNING_KID`, `CREDENTIAL_SIGNING_ALGORITHM`, `CREDENTIAL_SIGNING_KEY_PKCS8`, and `CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI`. Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; do not copy the service-role key into Vercel or a local frontend env file.
5. Keep `RESEND_SANDBOX=true` until the configured inbox, sending domain, SPF, DKIM, and DMARC are verified. Test throttling before enabling live sending.
6. Deploy the Edge Functions after the reviewed database schema is available. Require gateway JWT verification for `create-organization`, `send-emails`, and `accept-organization-invitation`; each function also validates the caller token and its authorization requirements. Public credential endpoints and `manage-recipient-credential` intentionally accept anonymous requests but apply input validation, rate limiting, and narrowly scoped output/RPCs.
7. Generate the issuer key locally using the reviewed script, in a secure environment. Preserve an offline backup. Configure the private and public PEM values as server secrets; store only the public JWK and matching `kid` in `issuer_keys`. Never paste private key material into Git, Vercel client variables, logs, or chat.
8. Use a staging Supabase project and a non-production signing key to run end-to-end issuance, verification, revocation, email, PDF, and recipient-link checks. Do not reuse the production private key in staging.

## Recipient link operations

- Each credential email carries a cryptographically random, single-use 30-minute link. Its raw token is placed in the URL fragment and is not sent in the initial HTTP request; Postgres stores only a SHA-256 token hash.
- Redeeming the link exchanges it for a credential-scoped, 15-minute management session. A recipient can change visibility for that credential only; each successful change is audited.
- Resending revokes prior unused links and sessions. Credential revocation and recipient anonymization invalidate outstanding links/sessions. Avoid including raw links or tokens in application logs, analytics, support tickets, or screenshots.
- Sandbox email redirects to `RESEND_SANDBOX_TO`; use a test-only recipient and never treat sandbox delivery as proof of production domain readiness.
- The database serializes organization send reservations under an advisory lock, counting reserved, successful, and failed provider attempts from the preceding 24 hours. The cap is conservative: a failed provider attempt still consumes quota for the window. Resend requests carry the unique reservation UUID as an idempotency key.
- Organization invitations are sent only by `send-emails` after an owner check. Supabase Auth generates a sign-in/verification action link, but delivery uses the configured Resend sender. The recipient must sign in with the invited, verified email and explicitly accept within seven days; owners can invalidate an outstanding link by resending to that address.

## Drive stamping operations

- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` is a Supabase Edge Function secret. Never add it to Vercel,
  a `VITE_*` variable, a migration, or a browser bundle.
- `MAX_STAMP_PDF_PAGES` is a server-side Edge Function setting with a conservative default of 50
  and an allowed range of 1–100.
- Drive requests may use only fixed `oauth2.googleapis.com` and `www.googleapis.com` endpoints.
  Folder and file IDs are validated; URLs and arbitrary hosts are rejected.
- Source PDFs are read transiently, never written to Drive, and never persisted as originals.
  Only stamped output is retained in the private Storage bucket.
- Stamp processing uses one PDF per Edge Function call, browser concurrency no greater than 2,
  403/429 backoff, 5-minute processing leases, idempotent retries, and short-lived signed URLs.
- Downloaded ZIPs and reports are copied outside Supabase; their lifecycle is governed by the
  organization's retention policy. Browser ZIP assembly is memory-intensive and should be used
  achievement-by-achievement.

## Monitoring, logs, and alerts

### Required signals

- **Public uptime:** probe `/verify` and `/.well-known/did.json` from an external uptime monitor at
  one-minute intervals. The root `/verify` probe checks availability only; it must not submit
  real credential data. The DID probe must validate HTTP 200, JSON content type, and a parseable
  DID document. Probe `/.well-known/jwks.json` as a separate key-publication check.
- **Vercel:** monitor deployment health, middleware/function errors, request failures, and latency
  for `/c/:id`. Keep request logs free of credential IDs where possible; never record JWTs,
  recipient link fragments, emails, or complete query strings.
- **Supabase:** review Edge Function logs and Postgres logs in the Supabase Dashboard. Alert on
  repeated invocation failures, authorization denials that materially exceed baseline, database
  connection saturation, failed migrations, and Storage upload/delete failures. Use sanitized
  request IDs or function names for correlation, not request bodies.
- **Email:** track `send-emails` sent/failed/throttled totals and Resend provider delivery/bounce/
  complaint events where webhook support is configured. A 2xx provider response means accepted,
  not delivered.
- **Storage and privacy:** track private stamped bucket bytes, object count, failed deletion
  retries, signed-URL creation failures, and anonymization tasks not finalized. Do not retain
  object names that contain PII; current paths are UUID-based.
- **Error aggregation:** configure Sentry or an equivalent server-side error aggregator for
  Vercel and Edge Function failures only after verifying PII scrubbing. Disable request-body,
  authorization-header, cookie, URL-fragment, and full-URL capture. Do not upload source maps
  publicly unless access is restricted and reviewed.

### Initial alert thresholds (owner must review)

These are proposed operational starting points, not measured service-level objectives. Confirm
monitor capabilities and approve thresholds before production:

| Signal | Proposed alert |
|---|---|
| `/verify` or `/.well-known/did.json` / JWKS availability | Page after 2 consecutive failed one-minute probes. |
| Vercel or Edge Function 5xx rate | Alert when >= 5% of requests over 5 minutes, with at least 20 requests; page if sustained for 15 minutes. |
| Public endpoint latency | Alert if p95 exceeds 2 seconds for 10 minutes; exclude deliberately slow/invalid test requests after review. |
| Supabase database saturation | Alert at >= 80% of the configured connection or CPU limit for 10 minutes; page at >= 90% or on repeated connection failures. |
| Email failures | Alert if >= 3 consecutive provider failures or >= 5% failure across 20+ attempts in 15 minutes; keep daily-plan throttling a separate expected metric. |
| Stamping failures | Alert on any repeated `storage_upload_failed` or deletion failure; alert if a run's failed-file rate exceeds 10% after at least 10 files. |
| Storage capacity | Warn at 70%, alert at 85%, and page at 95% of the configured bucket/project quota. |
| Anonymization | Alert on any request pending beyond the operator-approved processing window; do not infer a retention period from this operational SLA. |

Set a clear owner for acknowledging each alert. Tune thresholds using staging traffic before enabling paging. Alert contents and incident tickets must contain no names, emails, raw Drive filenames, signed URLs, access tokens, or credential JWTs.

### Incident contacts and escalation

Fill in and verify these channels before any production pilot. Do not put personal phone numbers or private contact details in this public repository; store them in the restricted incident contact system and link its identifier here.

| Role | Primary contact / restricted-system reference | Backup |
|---|---|---|
| Service owner / go-no-go | **TODO — owner to fill** | **TODO** |
| Supabase/database operator | **TODO — restricted contact reference** | **TODO** |
| Vercel/web operator | **TODO — restricted contact reference** | **TODO** |
| Privacy/legal incident lead | **TODO — restricted contact reference** | **TODO** |
| Email/Drive provider operator | **TODO — restricted contact reference** | **TODO** |

For suspected key exposure, PII disclosure, cross-tenant access, or unexpected public credential
data: disable the affected workflow first, preserve sanitized evidence, notify the owner and
privacy lead through the restricted channel, and follow [runbook.md](./runbook.md). Do not
investigate using production recipient records unless the authorized incident lead approves the
minimum necessary access.

## PDF and branding assets

The generated PDF is a functional placeholder using built-in Helvetica and a simple landscape border. Before production branding, receive and review the issuer-approved A4 landscape backgrounds, logo, and licensed font files. Validate font embedding, page dimensions, text overflow, contrast, recipient-consent behavior, and Unicode names against the approved assets. Do not use unlicensed fonts or invent final brand artwork.

## Incident response and key rotation

- If the private signing key may have been exposed, disable issuance, preserve logs, generate a replacement key in a trusted environment, update the public DID/JWK publication and `issuer_keys`, and document the affected key IDs and credentials. Do not overwrite or delete historical public keys needed to verify old credentials.
- If Resend credentials are exposed, revoke and rotate the API key, return sending to sandbox, then review provider logs and email events.
- If a recipient management link is disclosed, resend the message to revoke active links/sessions. If the recipient account/email itself is compromised, revoke affected credentials through the normal owner/admin workflow.
- Preserve the append-only audit log. Investigate suspected tenant access, signing, email delivery, or PII disclosure incidents before restoring issuance.
