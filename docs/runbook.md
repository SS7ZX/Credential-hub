# Staging operations runbook

This runbook is for a dedicated **staging** Supabase project and Vercel Preview deployment. It does not authorize or describe a production deployment. Never paste production credentials into a staging environment, and verify the Supabase project reference and Vercel environment before every operation.

## 1. Key generation and secret setup

### Generate a staging signing key

1. Use a trusted, offline-capable workstation. Do not generate keys in a browser, CI log, shared terminal, or repository directory.
2. From the repository root, run `npm run keygen`. The script prints PKCS#8 private-key and SPKI public-key PEM material, a `kid`, and the algorithm. Its output is sensitive.
3. Capture the output directly into an approved secrets manager or password manager. Do not redirect it to a file in the repository, commit it, paste it into chat/tickets, or leave it in shell history or terminal recordings.
4. Make an encrypted offline backup of the staging private key and record its `kid`. Keep the backup separate from the workstation. The production key must be generated and backed up separately; do not reuse this staging key.
5. Add the staging public key to the staging `issuer_keys` data using the existing owner workflow. Before issuing, verify that the DID derived from the staging `PUBLIC_SITE_URL` resolves to a DID document/JWKS containing this exact staging key and `kid`. Never pair a staging key with the production domain or publish the staging key through production.

If the key output may have been exposed, do not use it. Generate a replacement and remove the exposed copy according to the organization's secret-handling policy.

### Configure environments

Use the Supabase Dashboard's Edge Function secrets for server-side values. Use Vercel's **Preview** environment for the staging front end. Do not set staging values in Vercel Production. Set the following in the staging Edge Function environment:

- Required: `ISSUER_OWNER_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_DAILY_PLAN_LIMIT`, `RESEND_SANDBOX`, `RESEND_SANDBOX_TO`, `PUBLIC_SITE_URL`, `RATE_LIMIT_HASH_SECRET`, `CREDENTIAL_SIGNING_KID`, `CREDENTIAL_SIGNING_ALGORITHM`, `CREDENTIAL_SIGNING_KEY_PKCS8`, and `CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI`.
- `PUBLIC_SITE_URL` is the single canonical origin. Credential and achievement URLs and the `did:web` identifier are derived from it; there is no separate issuer-domain setting.
- Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for Edge Functions. Do not copy the service-role key into Vercel or a `VITE_` variable.
- Keep `RESEND_SANDBOX=true` and set `RESEND_SANDBOX_TO` to a staging-controlled mailbox. Do not enable live sending until the owner has configured and verified the sending domain and tested the daily quota.

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (or the legacy `VITE_SUPABASE_ANON_KEY`), and the environment's `PUBLIC_SITE_URL` in Vercel. The Supabase URL and publishable/anon key are public client configuration; database RLS and function authorization must protect data. `PUBLIC_SITE_URL` is also public: Vite injects only the site origin so generated links and the DID use the same host. Locally, use the local Supabase URL and key in ignored `.env.local`; never put server secrets there or prefix them with `VITE_`.

The local credential-validation script takes `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_PROJECT_REF`, `STAGING_CREDENTIAL_ID`, and `STAGING_ACKNOWLEDGEMENT` from the process environment. These values are for that one staging validation invocation, not Vite build variables. The anon key is public by design; the acknowledgement is a guard, not a credential.

### Environment-variable and secret inventory

“Browser bundle” means files emitted under `dist/`. `No` means neither the variable value nor its server-side configuration belongs in the bundle. Public metadata may still be returned by an endpoint or appear inside an issued credential.

| Variable | Where it lives / purpose | Who can read it | May it reach browser bundle? |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Vercel Preview environment; local ignored `.env.local`; browser API endpoint | Anyone who can load the site | **Yes**; public endpoint |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel environment; local ignored `.env.local`; Supabase client key | Anyone who can load the site | **Yes**; public key, not authorization |
| `VITE_SUPABASE_ANON_KEY` | Legacy alias accepted for older Supabase projects | Anyone who can load the site | **Yes**; public key, not authorization |
| `SUPABASE_URL` | Supabase-injected Edge Function runtime value | Edge Functions and Supabase project operators | No as a server variable; the same URL is public through `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | Supabase-injected Edge Function runtime value | Edge Functions and Supabase project operators | No as a server variable; the anon-key value is public if separately configured as `VITE_SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase-injected Edge Function runtime value | Edge Functions and privileged Supabase project operators | **Never** |
| `ISSUER_OWNER_EMAIL` | Supabase Edge Function secret; owner bootstrap allowlist | Functions that enforce owner bootstrap; authorized project operators | **Never** |
| `RESEND_API_KEY` | Supabase Edge Function secret | `send-emails` runtime and authorized project operators | **Never** |
| `RESEND_FROM_EMAIL` | Supabase Edge Function configuration | Email function and authorized project operators | No; it is server-side configuration |
| `RESEND_DAILY_PLAN_LIMIT` | Supabase Edge Function configuration | Email function and authorized project operators | **Never** |
| `RESEND_SANDBOX` | Supabase Edge Function configuration | Email function and authorized project operators | **Never** |
| `RESEND_SANDBOX_TO` | Supabase Edge Function configuration | Email function and authorized project operators | **Never** |
| `PUBLIC_SITE_URL` | Vercel build configuration and Supabase Edge Function configuration; canonical credential origin and `did:web` host | Public origin is visible to site visitors; function configuration is visible to authorized operators | **Yes, origin only**; it is not a secret |
| `RATE_LIMIT_HASH_SECRET` | Supabase Edge Function secret | Functions that hash rate-limit identifiers; authorized project operators | **Never** |
| `CREDENTIAL_SIGNING_KID` | Supabase Edge Function configuration | Issuance functions and authorized project operators | No as an environment variable; the `kid` is public in signed JWT headers/public key metadata |
| `CREDENTIAL_SIGNING_ALGORITHM` | Supabase Edge Function configuration | Issuance functions and authorized project operators | No as an environment variable; the algorithm is public metadata |
| `CREDENTIAL_SIGNING_KEY_PKCS8` | Supabase Edge Function secret; private signing key | Issuance functions and authorized project operators with secret access | **Never** |
| `CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI` | Supabase Edge Function configuration; public-key encoding | Functions and authorized project operators | No as an environment variable; the public key may be published as a JWK |
| `STAGING_SUPABASE_URL` | One-off local validation process | Operator running the validation | No |
| `STAGING_SUPABASE_ANON_KEY` | One-off local validation process | Operator running the validation; public key by design | No |
| `STAGING_PROJECT_REF` | One-off local validation process; target guard | Operator running the validation | No |
| `STAGING_CREDENTIAL_ID` | One-off local validation process; selected credential | Operator running the validation | No |
| `STAGING_ACKNOWLEDGEMENT` | One-off local validation process; explicit staging guard | Operator running the validation | No |
| `OPENAI_API_KEY` | Optional local Supabase Studio AI setting in `supabase/config.toml` | Local Studio process and the operator | No; leave unset unless Studio AI is deliberately enabled |
| `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` | Optional local Supabase Auth SMS provider setting; SMS provider is disabled in config | Local Auth service and the operator | **Never** |
| `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | Optional local Supabase Apple OAuth setting; provider is disabled in config | Local Auth service and the operator | **Never** |
| `S3_HOST`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Optional Supabase experimental S3 settings; configure only if enabling that storage backend | Supabase storage service and authorized operators; access/secret keys are sensitive | **Never** |
| `SENDGRID_API_KEY` | Commented-out local SMTP placeholder in `supabase/config.toml`; not active | No runtime reader unless the optional SendGrid configuration is deliberately enabled | **Never** |

The disabled SendGrid and placeholder secret entries in `supabase/config.toml` are comments, not active configuration. Do not configure unused integrations just because a placeholder exists. If enabling an optional provider/storage feature, document its secret owner and rotation process before setting it.

## 2. Staging deploy order

1. **Verify the target.** Confirm the Supabase project reference and Vercel Preview project/environment are the dedicated staging resources. Check `git status` and review the exact migration and test diff. Do not use production values in any step.
2. **Validate locally first.** Start the local Supabase stack (Docker is needed only for these local database checks; no VPS is required), then run `npx supabase db reset`, `npx supabase test db`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. A local reset is destructive to the local Supabase database only; never use `db reset` against a hosted project.
3. **Configure Supabase Auth.** Set staging Site URL and exact redirect URLs. Keep email confirmation enabled. Create/verify the staging owner account; use a staging-only owner email and `ISSUER_OWNER_EMAIL`.
4. **Configure staging secrets.** Set Edge Function values in the staging Supabase project. Keep email sandbox mode on. Confirm the staging `PUBLIC_SITE_URL` and `RESEND_SANDBOX_TO`.
5. **Validate the site identity.** Export the same staging `PUBLIC_SITE_URL` into the deployment shell and run `npm run predeploy:check`. The script rejects missing, placeholder, canary, invalid, non-HTTPS, or mismatched DID/site-host configuration.
6. **Apply schema to staging only.** Link explicitly to the staging project (`npx supabase link --project-ref <STAGING_PROJECT_REF>`), inspect the linked project identity, and review `npx supabase db push --linked --dry-run`. Only if the target and migration list are correct, apply with `npx supabase db push --linked`. This command changes the linked hosted project. Do not run `db push --remote`; do not proceed if the ref is ambiguous or production.
7. **Initialize the staging issuer key.** Generate a separate staging key, store the private key in the staging Edge Function secrets, register only its public key through the owner workflow, then verify the DID/JWKS public key and `kid`.
8. **Deploy Edge Functions.** Deploy the functions from this revision to staging after the schema and secrets are ready. Keep the existing per-function JWT settings; verify owner/member checks and public-endpoint rate limits.
9. **Deploy the web app as a Vercel Preview.** Set the staging `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy anon key), and `PUBLIC_SITE_URL` in Preview, then deploy. Do not change Vercel Production variables or promote the Preview deployment.
10. **Run the E2E checklist.** Use only test identities and a sandbox-controlled inbox. Complete the credential validation script against the staging URL after issuing a credential.
11. **Record evidence.** Record commit/deployment identifiers, staging project ref, test outcomes, and any defects. Do not record private keys, auth tokens, recipient PII, raw recipient links, or full credential JWTs.

### Browser bundle leak check

The repeatable check is `npm run verify:client-bundle` after a build. To verify the build-time boundary, use a fresh PowerShell process and set long, synthetic canary strings for server-only variables from the inventory, plus clearly fake `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values. Run `npm run build` and `npm run verify:client-bundle` in that same process. The checker scans every file under `dist/` for the supplied server-side canary values, server-side variable names, and private-key PEM markers. Do not read, print, or source a real `.env` file to perform this check. Only public Supabase client settings, `PUBLIC_SITE_URL` as public origin, and intentionally public credential/DID/JWK metadata may be present in browser-delivered output.

## 3. Owner account recovery

There is no owner transfer UI. Use this procedure only when the organization owner account is inaccessible and an authorized project/database operator has independently verified the recovery request.

1. Create or identify the replacement Supabase Auth user and confirm its email is verified.
2. Obtain the exact organization UUID, replacement user's verified email, former owner's Auth UUID (if that account should be demoted), and an approved incident/change reference. Use a separate authorized operator as the reviewer.
3. Connect to the **staging** database first to rehearse. For an approved hosted recovery, connect only to the explicitly identified target database; this runbook task does not perform that operation.
4. Run this SQL as a trusted database owner/operator in a transaction. Replace the organization ID, replacement email, change reference, and optionally the former-owner UUID. Leave `v_former_owner_id` as `NULL` only when there is no former owner to demote. The block aborts if the organization or a verified replacement account is not found.

```sql
begin;

do $recovery$
declare
  v_organization_id uuid := '00000000-0000-0000-0000-000000000000';
  v_recovery_email text := lower(trim('new-owner@example.org'));
  v_former_owner_id uuid := null; -- Set to the former owner's auth.users UUID when demoting them.
  v_change_reference text := 'REPLACE-WITH-APPROVED-INCIDENT-OR-CHANGE-ID';
  v_recovery_user_id uuid;
  v_rows_updated integer;
begin
  if v_change_reference = 'REPLACE-WITH-APPROVED-INCIDENT-OR-CHANGE-ID' then
    raise exception 'Set an approved incident/change reference before recovery';
  end if;

  select u.id
    into v_recovery_user_id
    from auth.users as u
   where lower(u.email) = v_recovery_email
     and u.email_confirmed_at is not null;

  if v_recovery_user_id is null then
    raise exception 'No verified Auth user found for the recovery email';
  end if;

  perform 1
    from public.organizations as o
   where o.id = v_organization_id
   for update;

  if not found then
    raise exception 'Organization not found';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_recovery_user_id, 'owner')
  on conflict (organization_id, user_id)
  do update set role = 'owner';

  if v_former_owner_id is not null
     and v_former_owner_id <> v_recovery_user_id then
    update public.organization_members
       set role = 'admin'
     where organization_id = v_organization_id
       and user_id = v_former_owner_id;

    get diagnostics v_rows_updated = row_count;
    if v_rows_updated <> 1 then
      raise exception 'Former owner membership was not found; recovery rolled back';
    end if;
  end if;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    v_organization_id,
    null,
    'owner_recovered',
    'organization_member',
    v_recovery_user_id,
    jsonb_build_object(
      'formerOwnerUserId', v_former_owner_id,
      'changeReference', v_change_reference,
      'method', 'manual_operator_sql'
    )
  );
end
$recovery$;

commit;
```

5. Verify the replacement owner membership, former-owner role (if applicable), and audit row. Confirm the owner can sign in and complete the normal owner workflow. If any statement fails, do not continue; roll back the failed transaction and investigate. Keep the reviewed SQL and change reference in the restricted incident record, not in this repository.

The SQL intentionally grants only the owner membership on one organization, records an audit event, and does not change Auth credentials. It does not revoke the former owner's Supabase session. Separately disable/recover that Auth account through the approved identity incident procedure. Never leave an inaccessible or compromised owner account active.

## 4. Rollback

- **Before schema deployment:** stop the rollout; do not apply the migration.
- **After web deployment but before data-changing use:** redeploy the previous known-good Vercel Preview build and matching Edge Function revision. Keep schema changes in place unless a reviewed, safe forward migration is available.
- **After credentials or data have been created:** do not delete/rewrite issued credentials or audit records as a rollback shortcut. Disable issuance/email as appropriate, preserve evidence, and deploy a backward-compatible fix or a reviewed forward migration.
- **Schema changes:** there is no safe generic down migration for the initial schema. Do not use `supabase db reset` against hosted staging or production. Restore from a known-good backup only under the recovery plan below, with the data owner approving the exact recovery point and consequences.
- **Signing key exposure:** stop issuance, rotate to a new key, publish the new public key, retain old public keys needed to verify prior credentials, and document affected `kid` values.
- **Email issue:** set `RESEND_SANDBOX=true` or remove/rotate the affected API key while investigating. Review provider and `email_events` records before resuming.

Production promotion requires a separate explicit review and approval. A successful staging run is not production authorization.

## 4a. Signing-key compromise response

Treat suspected private-key exposure as an active signing incident, even if misuse is not yet
confirmed:

1. Stop issuance and any workflow that can create new signed credentials. Keep public verification
   available if it can safely report the known key/status state.
2. Notify the service owner and privacy/security incident lead using the restricted contacts in
   [operations.md](./operations.md). Open an incident record; do not put key material, recipient
   data, or full signed JWTs in it.
3. Preserve relevant Supabase/Vercel audit and function logs, key IDs (`kid`), deployment
   revisions, and time window. Never copy the private key into the incident ticket or chat.
4. Generate a replacement Ed25519 key on a trusted machine with `npm run keygen -- <new-kid>`.
   Store the private PKCS#8 key only in the approved secret manager and an encrypted offline
   backup. Verify the public key matches before enabling issuance.
5. Register the new public JWK and publish its `kid` through DID/JWKS. Retain the compromised
   public key as a retired verification key while relying credentials may exist; do not publish
   its private material or reuse the old key for signing.
6. Determine the affected credential set using restricted database/operator procedures. Revoke
   credentials only after issuer-owner approval and preserve their revocation evidence. Do not
   silently mass-revoke or delete history.
7. Test a new synthetic credential in staging, verify new and historical public keys, and have a
   second operator review before resuming issuance. Record the decision, affected `kid` values,
   rotation evidence, and follow-up actions.

If exposure is unconfirmed but credible, keep issuance disabled until the owner/security lead
explicitly accepts the evidence and recovery plan.

## 5. Backup and restore

### Back up staging

1. Use the Supabase Dashboard's supported database backup/PITR facilities for the staging project and confirm retention and recovery-point timestamps.
2. Export storage objects separately if staging uses Supabase Storage; database backups do not necessarily include object bytes.
3. Preserve the source revision, migration history, project ref, deployed function/web revisions, and configuration inventory alongside the backup record.
4. Back up signing keys only as encrypted secret-manager/offline copies with restricted access. Never put private key material in a database dump or repository. Back up Resend and other provider credentials through their secret manager/rotation procedures, not in a dump.
5. Test restoration into an isolated staging recovery project before relying on the backup. Verify database migrations, auth configuration, storage objects, public-key publication, and a test credential.

### Restore staging

1. Declare the incident and select the target recovery point with the data owner. Identify possible loss of credentials, revocations, invitation state, audit history, and email quota/event data after that point.
2. Restore into an isolated staging recovery project using the Supabase-supported restore process; do not overwrite production or the original staging database without explicit approval.
3. Reapply/verify migrations and required RLS/RPC behavior. Restore storage objects separately as needed.
4. Reconfigure environment secrets through the secret manager. Rotate credentials suspected of compromise; do not restore an exposed signing key or provider key merely because it was in the backup.
5. Verify the intended issuer DID/JWKS and key IDs, run local DB tests against a local database, then execute the staging E2E checklist against the recovery project.
6. Only switch a staging deployment to the recovered project after validation and owner approval. Retain the original environment and incident evidence until the data owner approves cleanup.

Never use a production backup to populate a staging environment containing real recipient PII. Use synthetic staging data or an approved, minimized, anonymized dataset.

## 6. Drive import and stamping operations

### Required staging secrets

- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`: full read-only Google service-account key JSON as a
  Supabase Edge Function secret. It must never be in Vercel, a `VITE_*` variable, logs, or Git.
- `MAX_STAMP_PDF_PAGES`: positive integer no greater than 100. A conservative staging default is
  50. This controls server-side PDF validation; the 15 MB PDF limit is also enforced.

Create a dedicated Google service account, enable only the APIs required for read-only Drive
access, and share each source folder with that account as Viewer. Folder/file IDs must match the
strict 10–255 character identifier format. A source URL or arbitrary hostname must be rejected.
Only fixed Google API HTTPS hosts may be contacted.

### Local and staging validation

1. Use synthetic recipient rows and synthetic PDFs. Issue credentials before creating a stamping
   run. Never test with real names or emails.
2. Upload no source PDF to Supabase Storage. Source PDFs remain transient in Edge Function memory.
3. Confirm the achievement layout first. The layout must be for 25–30 mm at 25.4/72 points per
   millimeter, with page number, lower-left x/y, size, expected page dimensions/tolerance, and
   zero rotation.
4. Load the top-level folder and confirm every Event > Achievement folder mapping. Every exact
   CSV/Drive match must pass; missing, duplicate, extra, case-collision, MIME, folder, and wrong-
   recipient matches stop the run.
5. Approve all random sample previews and inspect the full matching list. Stamp one PDF per Edge
   Function call, at browser concurrency no higher than 2.
6. Verify a downloaded output: PDF opens, its QR decodes to the exact
   `{PUBLIC_SITE_URL}/verify/{credentialUuid}` URL, dimensions are unchanged, and metadata contains
   no recipient name or email. QR decode of the output remains a manual or automation check; do
   not claim it passed until the decoded URL is recorded.
7. For a 403 or 429 response, stop and use exponential backoff plus the Google `Retry-After`
   header. Resume by run ID; completed files must not be stamped twice.

### Failure handling

- `pdf_signed`, `pdf_encrypted`, `pdf_rotated`, `page_limit`, `page_size_mismatch`, and
  `invalid_mime` are terminal file errors. Fix the source or layout, then create a corrected
  review-only run or retry according to the retained source hash policy.
- `storage_upload_failed` and transient `other` failures are retryable. The 5-minute processing
  lease prevents concurrent claim. A worker that expires must be retried rather than marked
  completed.
- No run should be reported as successful until every file is either completed or has a sanitized
  terminal failure. Never expose filenames or provider response bodies in application logs.

### Storage quota

For 300 PDFs, estimate:

- Assumed average: 15 MB * 300 = 4.50 GB
- Conservative 20 MB (while source limit remains 15 MB): 6.00 GB
- Working estimate: 5 GB staged quota plus 2× free headroom for retry/replacement objects

The download output contains originals plus stamped objects; do not assume Storage is the only
retained copy. Set a reviewed retention period and monitor bucket bytes, 300-object operations,
signed-URL use, and failed upload/delete retries. Browser-side ZIP assembly is memory-intensive;
process one achievement at a time and split batches if browser memory or zip runtime limits are
observed.
