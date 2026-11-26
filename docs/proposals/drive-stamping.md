# Drive certificate stamping proposal

## Scope and phases

This proposal covers the approved Drive import and QR stamping workflow. Work is gated by phase;
the current implementation scope is P1 only.

- **P1 — backend foundation:** add a timestamped migration for `qr_layouts`, `stamp_runs`, and
  `stamp_files`; create a private PDF bucket and tenant-scoped policies; add authenticated
  `SECURITY DEFINER` RPCs with an empty `search_path`; and ensure recipient anonymization removes
  stamped objects.
- **P2 — QR placement editor:** configure a per-achievement layout by clicking a preview and
  entering page, x/y/size in points, expected page dimensions and tolerance. Show a sample QR and
  reject rotated or mismatched pages.
- **P3 — Drive pipeline:** use a read-only Google service account, shared as Viewer. Keep its JSON
  key in a Supabase secret, never in Vercel or the browser. Strictly validate folder IDs and only
  fetch from `googleapis.com`. Use one PDF per Edge Function invocation, low browser concurrency,
  idempotent retries, resume support, and backoff for Drive 403/429 responses. Do not write to
  Drive and do not add a queue. Verify each generated QR decodes to the expected URL, page size is
  unchanged, and PDF Info/XMP metadata contains no recipient name or email.
- **P4 — review and delivery:** require a full CSV-to-file review, approval of 10 random
  name/file pairs (or all pairs when there are fewer than 10), and a complete list before
  processing. Treat missing, duplicate, extra, and case-collision files as hard errors. Provide a
  ZIP per achievement and a sanitized report CSV; never email PDFs.
- **P5 — hardening:** enforce size/time/page limits and failure handling, update operational and
  privacy documentation, draft privacy/terms language for stored PDFs and retention, and estimate
  Storage quota for 300 files.

## Approved behavior

- CSV columns are `full_name`, `email`, `category`, and `file_name`; missing email is rejected.
  Matching is exact; v1 has no fuzzy matching or OCR.
- Credentials are issued through the existing wizard before stamping. A row without an issued
  credential cannot be stamped. Signed credentials never include recipient names.
- QR codes encode only `{PUBLIC_SITE_URL}/verify/{credential-uuid}`. Print a short ID and serial
  beside each QR for human matching.
- PDFs are accepted only as `application/pdf`, up to 15 MB each and a configurable page limit.
  Reject encrypted, digitally signed, rotated, and unexpected-size PDFs. Parse with `pdf-lib`;
  do not render PDFs server-side.
- Use error correction Q, a 25–30 mm QR, and a white quiet-zone box. Originals are never modified.
- A Drive subfolder suggests an event/achievement mapping; the issuer confirms it. Display files
  grouped by Event > Achievement with per-section progress.
- Store stamped outputs in a private Storage bucket. Signed URLs are short-lived. Anonymization
  must remove all stamped objects for the recipient.
- Only owner/admin/issuer roles can access stamping data or manage the workflow. Audit metadata and
  logs must contain no names, emails, or filenames.
- Save layouts per achievement: x/y/size in points, page number, expected page size and tolerance,
  and a zero-rotation check.

## P1 data and security design

- A layout is keyed by organization and achievement and is constrained to fit the expected page.
  QR size is constrained to the approved 25–30 mm range.
- A run stores only organization/achievement IDs, a validated Drive folder ID, counts, status,
  idempotency key, creator, and review approval metadata. A file row stores opaque Drive file ID,
  credential/recipient IDs, hashes, status, a sanitized error code, and a generated UUID-only
  Storage path. CSV names and source filenames are not persisted.
- Each file maps to one issued credential in the same organization and achievement. Unique
  constraints make run/file registration idempotent and prevent duplicate file or credential
  mappings.
- Direct client writes are revoked. RLS exposes stamping records only to issuer+ members, and the
  private bucket has no anonymous access. Storage paths contain UUIDs, never names or filenames.
- Storage object deletion cannot participate in a Postgres transaction. Owner/admin anonymization
  therefore uses a retryable two-step flow: mark the recipient as pending and return only object
  paths; delete those objects with the Storage API; then atomically clear recipient/credential data
  and mark file records deleted. If Storage deletion fails, final anonymization does not run; a
  retry can safely repeat the delete. The direct database anonymization RPC is service-role-only
  and the caller is authenticated and role-checked by the Edge Function.
- No remote database, deployment, or environment file is used for P1 validation.

## Risks and mitigations

- **Storage/Postgres are not one transaction.** Use the pending state and idempotent Storage API
  deletion above. A failed cleanup leaves the request pending and retryable rather than claiming
  anonymization succeeded.
- **Wrong-person mapping can produce a valid QR on the wrong PDF.** Exact matching, hard errors,
  full review, and explicit random-sample approval are mandatory before stamping.
- **PII can leak through paths, logs, or metadata.** Generate UUID-only storage paths, persist no
  filenames, use bounded error codes, and keep PDF metadata handling in P3.
- **Drive access could be abused as an SSRF vector.** Validate folder/file identifiers and restrict
  outbound Drive requests to Google APIs; never accept arbitrary URLs.
- **Large batches can exceed edge/storage limits.** Process one PDF per invocation, cap each input
  at 15 MB and a configurable page limit, and estimate total Storage use in P5.
- **External downloads remain outside our control.** Anonymization removes stored copies but
  cannot recall PDFs previously downloaded from the private workflow.

## P1 files

- `docs/proposals/drive-stamping.md`
- `supabase/migrations/20261126094500_drive_stamping_p1.sql`
- `supabase/tests/drive_stamping_rls.sql`
- `supabase/tests/credential_hub_rls.sql`
- `supabase/functions/anonymize-recipient/index.ts`
- `supabase/functions/_shared/anonymize-stamped-pdfs.ts`
- `supabase/functions/_shared/anonymize-stamped-pdfs_test.ts`
- `deno.json`
- `src/Admin.tsx`
- `docs/ADRs/0004-recipient-data-deletion.md`
