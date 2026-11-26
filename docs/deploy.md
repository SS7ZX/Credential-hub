# Deployment and production rollout

> **STOP: Do not push this branch to `main` or deploy until you have completed and approved the Production rollout order below.**

This document describes a controlled rollout for an operator who has explicitly approved the target. It does not authorize a deployment. Do not use this procedure until local and staging checks have passed and the data owner has approved the production change.

## Production rollout order

1. **Approve the release and target.** Record the release commit, change approval, production Supabase project reference, Vercel project, and rollback owner. Confirm the working tree and the exact migration/function diff. Never infer the target from an existing CLI link.
2. **Back up and rehearse.** Confirm a recent recoverable database backup and a separate Storage backup/retention plan. Rehearse the same release against an isolated staging project with synthetic recipients. Confirm the staging project reference before any CLI command.
3. **Run local gates.** On the local Supabase stack, run `npx supabase db reset`, `npx supabase test db`, Deno function tests, `npm test`, `npm run lint`, `npm run build`, and `npm run verify:client-bundle`. Do not use a remote flag for local checks. The predeploy check reads dotenv configuration; run it only in an explicitly approved environment with reviewed values and without printing secrets.
4. **Review and apply database migrations first.** Review every new timestamped migration, RLS policy, `SECURITY DEFINER` function, and test. Verify the production project reference in a separate authorized operator session. Apply the reviewed migrations to that project using the approved Supabase workflow. Do not reset a hosted database.
5. **Configure server secrets.** Set Supabase Edge Function secrets through the Supabase secret manager, including the Drive service-account JSON, signing key, rate-limit secret, and email-provider settings. Never put these in Vercel, a `VITE_*` variable, source control, or browser-readable configuration. Keep email in sandbox until the owner has independently completed SPF, DKIM, DMARC, and quota checks.
6. **Deploy Edge Functions.** Deploy the matching function revision after schema changes are present. Verify gateway JWT requirements, owner/admin/issuer authorization, Storage bucket privacy, Drive host allowlists, and function health before enabling UI access.
7. **Deploy the web app.** Set only the public Supabase URL/key and canonical `PUBLIC_SITE_URL` in the matching Vercel Production environment. Deploy the reviewed web revision. Confirm the generated credential/verification origin and middleware routes.
8. **Run a controlled pilot.** Follow [stamping-manual-test.md](./stamping-manual-test.md) with a 10-file pilot, test recipients, one approved achievement, and sandbox email. Verify matching, sample approval, stamped output, phone QR scan, report sanitization, and anonymization/Storage deletion.
9. **Observe before expanding.** Review sanitized audit events, function failures, Storage usage, and database health. Do not increase the pilot size until the owner has reviewed the evidence and resolved all discrepancies.
10. **Record and close.** Record deployment identifiers, migration version, test evidence, reviewer approval, and any rollback decision. Do not record recipient names/emails, Drive filenames, signed URLs, access tokens, private keys, or full credential JWTs in the release record.

## Rollback

- Before migrations are applied, stop and revert the deployment plan.
- After migrations are applied, prefer a forward fix. Do not reset production or drop credential, revocation, audit, recipient, or stamp data as a rollback shortcut.
- If the app or function deploy fails, disable the affected workflow and redeploy the last compatible application/function revision. Preserve schema unless a reviewed migration proves rollback safe.
- If signing keys or provider credentials may be exposed, disable the affected operation and rotate through the approved secret/key procedure.
- If stamped PDFs are exposed or retained unexpectedly, restrict access, preserve the incident evidence, and follow the approved privacy incident and retention process.
