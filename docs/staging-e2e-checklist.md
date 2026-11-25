# Staging end-to-end checklist

Run this checklist only against the dedicated staging Supabase project and a Vercel Preview deployment. Use synthetic recipient data, a staging-only owner and issuer, and an inbox controlled by the staging operator. Keep `RESEND_SANDBOX=true`. Do not use production accounts, signing keys, recipients, or email configuration.

## Preconditions

- [ ] Confirm the Vercel URL is a Preview deployment and its Supabase URL/project ref match staging.
- [ ] Confirm staging schema and Edge Functions are deployed from the reviewed revision.
- [ ] Confirm `RESEND_SANDBOX=true`, `RESEND_SANDBOX_TO` is controlled, and the staging daily send limit is low enough for a test.
- [ ] Confirm staging signing `kid` is present in the issuer public-key/DID publication and no production private key is configured.
- [ ] Prepare a verified staging owner, a second user for invitation, a synthetic recipient, and an inbox that can receive sandbox mail.
- [ ] Record the commit, Preview deployment, Supabase project ref, test date, and test operator. Do not record tokens, full JWTs, raw management links, or real PII.

## 1. Invite a member

1. Sign in as the staging organization owner.
2. Invite the second verified test user's email with the **issuer** role.
3. Confirm the UI reports the invitation request as accepted for sending, and the corresponding email event/reservation is recorded without exposing a raw invitation token in the UI or logs.
4. Confirm the invitation email is delivered only to the configured sandbox inbox/recipient, not to an arbitrary real address.
5. As a negative check, sign in as a non-owner and verify that the invitation action is unavailable or rejected.
6. Confirm a duplicate pending invitation is handled safely and does not create multiple active memberships.

**Pass:** owner can invite, non-owner cannot, email remains in sandbox, and the invitee is not a member before acceptance.

## 2. Accept invitation and log in

1. Open the invitation email in the controlled inbox and follow the sign-in/verification link.
2. Sign in using the invited email address and complete any required verification.
3. Accept the invitation explicitly.
4. Confirm the account joins the intended organization with the invited issuer role, and only that organization appears in the application.
5. Sign out and sign in again to check the session persists correctly.
6. Try an expired, revoked, or already accepted invitation link if one is available in staging; it must not grant membership a second time.

**Pass:** only the invited verified identity can accept, acceptance is organization-scoped and idempotent, and login/redirect returns to the staging site.

## 3. Issue a credential

1. As the invited issuer, create a small staging issuance batch with one synthetic recipient and one staging achievement.
2. Use the default duplicate policy (`skip`) and confirm an existing duplicate recipient/credential is not issued twice.
3. Submit the batch and wait for its terminal status. Confirm a credential is persisted once, its ID and serial are stable, and the batch result matches the row result.
4. Confirm the initial visibility is `unlisted`.
5. As a viewer (if configured), verify the read path works but batch/credential creation is denied.
6. Confirm server-side issuance stores a valid signed VC-JWT using the staging `kid`; do not copy the full JWT into logs or evidence.

**Pass:** issuer can issue; duplicate policy and initial visibility are respected; no partial/duplicate record is created on retry.

## 4. Check sandbox email

1. Trigger the credential email action for the synthetic recipient.
2. Confirm the message arrives only at `RESEND_SANDBOX_TO`, regardless of the entered recipient address.
3. Check that the message has the expected staging issuer name, credential link, and recipient-management link.
4. Confirm the configured daily limit blocks/rejects additional sends once the test quota is reached; do not lower or alter production settings.
5. Check application logs and email events for errors without copying raw links or recipient addresses into test notes.

**Pass:** sending occurs only through the Edge Function, the sandbox recipient override is effective, and throttling is enforced.

## 5. Verify via QR and recipient link

1. Open the issued credential's staging detail/PDF view and scan its QR code using a test device or browser camera.
2. Confirm the QR resolves to the staging credential page, displays the expected public/unlisted projection, and does not disclose recipient email or other private fields.
3. Open the unlisted URL in a signed-out/private browser session. It should work by link without making the credential publicly discoverable in listings.
4. Open the recipient-management link from the sandbox email. Confirm it is scoped to this credential and expires according to the configured short lifetime.
5. Use the recipient action to change visibility to `public` (or test the supported visibility control) and confirm the change is audited.
6. Confirm the public projection includes the recipient name only if the consent flag is set; toggle consent only if that feature is exposed in the staging flow.
7. Confirm a different credential cannot be managed with the same link/session, and replaying a single-use link does not mint another session.

**Pass:** QR, unlisted URL, and recipient link resolve only to the intended staging credential; the public projection honors visibility and consent.

## 6. Check PDF

1. Download the credential PDF from staging.
2. Confirm it opens, has A4 landscape dimensions, and contains the expected placeholder background/fonts rather than unapproved production branding.
3. Check text wrapping, recipient name rendering, credential title, issuer, issue date, credential ID, and QR readability.
4. Repeat with a synthetic Unicode name and a long title; note any clipping or missing glyphs.
5. Confirm the PDF respects recipient-name consent and does not expose email or internal fields.

**Pass:** PDF is readable and correctly scoped, with known placeholder branding and no private-field leakage.

## 7. Revoke and re-verify

1. As an issuer, attempt to revoke the credential. The action must be denied.
2. As an organization admin or owner, revoke the credential with a staging reason.
3. Confirm the revocation row and audit entry are created once, and the credential page reports revoked.
4. Scan the same QR/open the same credential URL again and run verification. The result must report revoked and must not present it as valid.
5. Confirm revocation cannot be undone through an issuer or recipient link.
6. Confirm the serialized external `credentialStatus` behavior matches the currently approved ADR decision. The serialized method is explicitly pending; do not infer conformance from internal revocation records or change the format during this test.

**Pass:** issuer cannot revoke; admin/owner can; all first-party verification paths report revoked consistently.

## 8. Anonymize recipient

1. Use the supported recipient self-service/anonymization action on the synthetic recipient, or follow the approved staging operator procedure if the UI does not expose it.
2. Confirm recipient PII is removed/anonymized from recipient records and public views.
3. Confirm the credential ID, signed credential artifact needed for verification, revocation record, and audit history are retained as designed.
4. Confirm outstanding recipient management links/sessions are invalidated.
5. Re-open the credential URL and scan its QR. Confirm it does not disclose the removed name/email and continues to show its correct revoked/valid state.

**Pass:** PII is anonymized, credential/revocation evidence is retained, and old recipient-management access no longer works.

## 9. Validate one downloaded credential against the official OB 3.0 schema

1. Select the synthetic staging credential and note its UUID.
2. In a one-off local PowerShell session, set the staging URL, anon key, project ref, credential UUID, and required acknowledgement. Do not use a Vercel `VITE_` variable for these script inputs:

   ```powershell
   $env:STAGING_SUPABASE_URL = 'https://<STAGING_PROJECT_REF>.supabase.co'
   $env:STAGING_SUPABASE_ANON_KEY = '<STAGING_ANON_KEY>'
   $env:STAGING_PROJECT_REF = '<STAGING_PROJECT_REF>'
   $env:STAGING_CREDENTIAL_ID = '<STAGING_CREDENTIAL_UUID>'
   $env:STAGING_ACKNOWLEDGEMENT = 'I_CONFIRM_THIS_IS_STAGING'
   npm run validate:staging-credential
   ```

3. Confirm the script reports schema validation success and does not print/save the JWT or payload. If it fails, retain only the sanitized error and investigate before continuing.
4. For the official conformance process, open the [1EdTech Verifiable Credentials certification suite](https://certification.imsglobal.org/certification/verifiable-credentials/), choose Open Badges 3.0 certification, and follow the current on-screen instructions to run the selected tests. The 1EdTech Conformance and Certification Guide v1.5 §2.2 says to submit test results after successful tests. Its issuer test procedure (§3.1) specifically calls for issuing a valid badge to `conformance@imsglobal.org`, submitting that badge to the conformance test system, and demonstrating recipient retrieval (video). Do this only with a synthetic staging credential and after the organization authorizes that external submission. Certification also requires qualifying 1EdTech membership and passing the relevant test set; a local JSON Schema pass is not certification. Record the suite version/date and outcome without storing production PII or secrets.

## Completion record

- [ ] All steps passed or each failure has an owner and tracked follow-up.
- [ ] No production database, production environment variables, production signing key, or live email sender was used.
- [ ] No raw link/token, private key, full JWT, or unnecessary recipient PII is present in the evidence.
- [ ] Clean up synthetic test records only through approved staging procedures; preserve revocation/audit evidence where retention rules require it.
