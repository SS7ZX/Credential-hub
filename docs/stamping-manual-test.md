# Drive stamping manual test

This checklist is for an explicitly approved staging environment with synthetic test recipients. Live Drive behavior remains **UNVERIFIED** until an operator completes the live steps below. Do not use production, real recipient data, or a 300-file batch for this pilot.

## Before starting

- Confirm the Supabase project is the dedicated staging project and the web app is a staging/preview deployment.
- Use a Drive folder shared as **Viewer** with the configured service account. Do not grant write access.
- Use a dedicated test event/achievement and synthetic CSV rows with `full_name,email,category,file_name`.
- Issue the credentials through the existing credential wizard before opening stamping.
- Use one PDF per test recipient. Do not include real recipient names, emails, or private documents.
- Keep email in sandbox. Do not send PDFs by email.
- Keep the original Drive files unchanged. Stamped output should be in the private Storage bucket only.

## Live Drive verification (manual; currently UNVERIFIED)

1. Create a test folder and subfolder in the staging Drive account. Add a small number of synthetic PDFs, including one valid PDF and one copy with an unsupported condition if safe to test.
2. Share only the test folder with the service-account email as Viewer. Confirm the service account cannot upload, rename, or delete files.
3. In the staging UI, enter the folder ID (not a URL), map each subfolder to the intended achievement, upload the synthetic CSV, and list the folder.
4. Confirm non-Google hosts and a full folder URL are rejected; confirm only Google Drive PDFs appear. Do not paste a service-account key into the UI.
5. Compare the returned file list to the Drive folder manually. Confirm no source file changed and no file was created in Drive.
6. Record pass/fail without copying recipient values or Drive filenames into logs or this report. These steps do not count as verified until completed by the operator against live Drive.

## Mandatory review and matching gate

1. Confirm the UI groups files as Event > Achievement > files and requires confirmation of each folder-to-achievement mapping.
2. Confirm the complete matched list is visible, each preview is paired with its CSV identity, and a randomly selected sample is shown.
3. Before approval, deliberately check that missing, extra, duplicate, case-collision, and wrong-recipient mappings are treated as hard errors and cannot proceed.
4. Approve only after inspecting the sample and confirming the full list. Verify the processing action stays disabled until sample approval is explicit.
5. Do not bypass the review gate with direct database edits or function calls.

## Ten-file pilot

1. Select one achievement with exactly 10 synthetic CSV rows and 10 matching Drive PDFs. Keep each PDF within the configured page and size limits.
2. Save the QR layout for that achievement. Confirm the preview dimensions and rotation match every source PDF and the QR fits without covering essential content.
3. Process the run. Confirm per-file progress, resume behavior after a browser refresh, and that retries do not create duplicate output objects.
4. Download the achievement ZIP and report CSV. Open several PDFs, verify the short credential ID/serial text, and scan the QR to confirm it opens the intended verification page.
5. Confirm report cells beginning with `=`, `+`, `-`, and `@` are neutralized before opening the CSV in spreadsheet software.
6. Confirm the source Drive PDFs remain unchanged and output PDFs are served only from short-lived signed URLs or the authorized UI.
7. In staging, anonymize one synthetic recipient as an owner/admin. Verify the stamped Storage object is removed, recipient PII is cleared, credential/revocation evidence is retained, and the audit log contains no recipient name/email or filename.
8. Review sanitized run results and Storage quota usage with the owner. Stop on any mismatch, failed deletion, unexpected metadata, or unapproved output.

Do not run a 300-file batch until the owner signs off on the 10-file evidence, the live Drive checks, and the printed QR scan below.

## Printed QR phone scan

1. Print one stamped synthetic credential at 100% scale with no “fit to page” rescaling.
2. Scan the printed QR with a phone camera. Confirm the decoded URL is the configured public verification origin followed by `/verify/{credential-uuid}` and that the credential shown is the intended test credential.
3. Repeat under ordinary indoor lighting and from a modest angle. Confirm the QR remains readable and the short ID/serial beside it is legible.
4. Do not photograph or share a credential that contains real recipient information. Record only pass/fail and the non-sensitive release/test reference.
