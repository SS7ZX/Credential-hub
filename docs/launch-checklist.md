# Production launch checklist

**Status: NOT APPROVED.** This checklist is evidence collection and owner sign-off, not deployment
authorization. Complete on the reviewed release commit. Keep production credentials and private
contact information out of this file.

## Release identity and approvals

- [ ] Release commit SHA recorded: `________________________________`
- [ ] Staging deployment IDs and Supabase project reference recorded in the restricted release
      record: `________________________________`
- [ ] Production Supabase project reference independently checked by a second operator:
      `________________________________`
- [ ] Vercel project/environment and canonical `PUBLIC_SITE_URL` verified by a second operator.
- [ ] No unreviewed migration, generated secret, or unrelated worktree change is in the release.
- [ ] **Service owner go/no-go sign-off:** name/role `________________` date `____________`
- [ ] **Second reviewer sign-off:** name/role `_____________________` date `____________`

## Security and application gates

- [ ] Local `supabase db reset` and full `supabase test db` passed on the reviewed commit.
- [ ] Deno Edge Function tests and checks passed.
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
      `npm run verify:client-bundle` passed.
- [ ] RLS coverage and SECURITY DEFINER `search_path` checks passed against the intended staging
      database.
- [ ] DID/JWKS documents agree with staging `issuer_keys`; retired keys needed for old credentials
      remain published.
- [ ] Per-function CORS, `verify_jwt`, rate limits, private Storage policies, and admin/issuer role
      restrictions verified in staging.
- [ ] Error aggregation and logs are scrubbed of PII, tokens, credential JWTs, request bodies,
      source filenames, and signed URLs.
- [ ] axe WCAG A/AA and 360 px checks cover public routes, authenticated issuance wizard,
      authenticated `/manage`, and stamping review.
- [ ] Lighthouse reports captured for representative working public credential/verification routes;
      no backend-disabled synthetic score is represented as production performance.

## Data, privacy, and recovery gates

- [ ] Data owner approves retention and deletion decisions for stamped Storage PDFs, downloaded
      ZIP/report copies, verification events, redacted audit/consent records, batch metadata,
      credential/revocation evidence, backups, and provider-side email events. **No periods are
      preselected by this checklist.**
- [ ] Privacy notice, [service terms draft](./privacy/terms-draft.md), and
      [stamping terms draft](./privacy/drive-stamping-terms-draft.md) reviewed by qualified counsel;
      both drafts remain **NEEDS LEGAL REVIEW** until signed off.
- [ ] Owner recovery, signing-key compromise, rollback, backup, and restore procedures rehearsed
      using staging/synthetic data.
- [ ] Current database and separate Storage backup/recovery point verified by the authorized
      operator.
- [ ] Incident contacts are filled in and tested in the restricted contact system.
- [ ] Signing-key owner confirms offline backup and `kid`; production and staging keys are distinct.
- [ ] SPF, DKIM, and DMARC are verified by the domain owner; Resend sandbox/quota behavior is tested.

## Issuance and stamping pilot

- [ ] Event, achievement/category, serial prefix, and owner-approved serial format reviewed.
- [ ] Synthetic issuance, duplicate policy, recipient consent, revocation, and anonymization tested.
- [ ] Read-only Google service account access verified against a dedicated staging folder.
- [ ] Random sample approval is mandatory; the full match list has no missing, duplicate, extra,
      case-collision, or wrong-recipient errors.
- [ ] Ten-file pilot completed; QR decoded on a phone to the expected public verification URL.
- [ ] Output page size/rotation and PDF Info/XMP checked; no recipient name/email appears in
      metadata.
- [ ] Anonymization deletes stamped Storage objects; injected deletion failure leaves anonymization
      pending and a retry succeeds.
- [ ] Run report formula-injection sanitization and ZIP contents reviewed.
- [ ] **Data owner pilot sign-off:** name/role `________________` date `____________`

## Monitoring and go/no-go

- [ ] Uptime probes for `/verify`, `/.well-known/did.json`, and `/.well-known/jwks.json` alert and
      notify the assigned owner.
- [ ] Proposed operational thresholds in [operations.md](./operations.md) have an owner-approved
      disposition (accepted or adjusted).
- [ ] Rollout followed the exact staging-first order in [deploy.md](./deploy.md).
- [ ] Owner confirms: **do not push to `main` or deploy until the rollout order and every required
      go/no-go gate above are completed and approved.**

**Final owner decision:** [ ] GO  [ ] NO-GO

**Owner name/role:** `____________________________`

**Date:** `________________`

**Restricted change/incident reference:** `____________________________`

If any mandatory item is unchecked or unverified, record **NO-GO** and stop. A completed checklist
does not itself perform or authorize database changes, deployment, email activation, or a push.
