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

## PDF and branding assets

The generated PDF is a functional placeholder using built-in Helvetica and a simple landscape border. Before production branding, receive and review the issuer-approved A4 landscape backgrounds, logo, and licensed font files. Validate font embedding, page dimensions, text overflow, contrast, recipient-consent behavior, and Unicode names against the approved assets. Do not use unlicensed fonts or invent final brand artwork.

## Incident response and key rotation

- If the private signing key may have been exposed, disable issuance, preserve logs, generate a replacement key in a trusted environment, update the public DID/JWK publication and `issuer_keys`, and document the affected key IDs and credentials. Do not overwrite or delete historical public keys needed to verify old credentials.
- If Resend credentials are exposed, revoke and rotate the API key, return sending to sandbox, then review provider logs and email events.
- If a recipient management link is disclosed, resend the message to revoke active links/sessions. If the recipient account/email itself is compromised, revoke affected credentials through the normal owner/admin workflow.
- Preserve the append-only audit log. Investigate suspected tenant access, signing, email delivery, or PII disclosure incidents before restoring issuance.
