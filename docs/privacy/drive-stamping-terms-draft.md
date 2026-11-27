# NEEDS LEGAL REVIEW — Draft privacy and terms language: existing-certificate stamping

**Status: DRAFT — NEEDS LEGAL REVIEW.** This is not approved policy, a privacy notice, or legal
advice. Do not publish or rely on it until the data owner and qualified counsel have reviewed and
approved the wording, lawful basis, retention schedule, and jurisdiction-specific requirements.

## Data processing

When an organization imports existing certificates from Google Drive, the organization must ensure
it has the authority to process and stamp each source certificate. Drive access is read-only. The
service account can read source files only from explicitly shared folders.

Recipient full name and email are used to map CSV rows to issued credentials and to validate that
the exact certificate belongs to the exact recipient. An optional participant/external ID may be
collected for issuer-side roster matching. It is stored as private recipient data, is not included
in the signed credential or QR, and is cleared during anonymization. Organizations must not upload
NIK or other sensitive official identifiers unless counsel has confirmed necessity, lawful basis,
notice, and safeguards. Signed credential payloads do not include recipient names. The QR contains
only the public credential verification URL.

## Stored artifacts

Stamped PDFs are retained in a private Supabase Storage bucket. The app uses organization/run/file
UUID-only object paths and short-lived signed download URLs. No scheduled expiry or purge is
currently configured; the organization must approve a retention period and deletion procedure
before production use. Source filenames and recipient PII
must not appear in object paths, PDF metadata, audit logs, or application logs.

Downloaded stamped PDFs and per-achievement ZIPs can be copied outside the application. The
organization is responsible for securing those copies and their destruction. Recipients should
be informed that downloaded or shared copies cannot be recalled.

## Consent and deletion

Anonymization removes recipient name and email, revokes associated credentials, and removes
associated stamped objects that are still in Storage. Consent withdrawal may invalidate future
name display but cannot recall social previews or copies already downloaded or shared. A separate
retention schedule should define how long stamped PDFs and run reports remain available.

## Incident and access controls

Only owner, admin, and issuer roles may manage stamping runs. Other organization roles and
anonymous users must not see recipient mapping, layouts, run state, or private objects. Any
suspected tenant, PII, Drive, or Storage disclosure must be escalated and investigated before
resuming issuance or stamping.
