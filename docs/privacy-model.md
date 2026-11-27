# Privacy model

## Signed credentials and public projection

Signed VC-JWT payloads never contain the recipient's name. They carry only the salted hash identity and achievement data. The public JSON endpoint constructs a separate projection from the signed credential and private recipient data. It includes no recipient name by default; a name is included only when the recipient has active consent for that credential.

The OG middleware uses that same consent-aware JSON projection. It uses a 30-second shared cache lifetime without stale-while-revalidate; withdrawing consent prevents subsequent projections from including the name, but cannot recall previews already cached by social platforms or copies made by viewers.

## Private data and consent

Raw recipient email and display name remain in Postgres and are not exposed by public Edge Functions except for an explicitly consented display name. An optional participant/external ID may also be collected for issuer-side roster matching. It is private recipient data: it is not embedded in VC-JWTs, public projections, PDF metadata, or public serials; it is cleared when the recipient is anonymized. Do not collect NIK or other sensitive official identifiers unless the organization has an approved necessity and lawful basis.

Consent is recorded per credential with independent `masked` and `full` scopes. It is hidden by default. Only the recipient's credential-scoped, short-lived management session can grant or withdraw it. Each state change stores a timestamp and notice version and creates an audit event. Consent events are private and unavailable through direct client table access.

For masked consent, names are normalized to NFC and split by Unicode grapheme. A name with one word or at most six graphemes displays initials only. Longer names display the first word followed by each later word's initial plus three asterisks (for example, `Ahmad R*** S***`). Full-name display requires the separate `full` consent.

The signed IdentityObject contains a salted email hash and salt, not the raw email or recipient name. That signed identifier may be present in public credential data but is never used as a display name.

## Visibility

Credentials default to `unlisted`. They are accessible by link or QR but are not listed publicly. Administrators or recipients may switch a credential to `public`.

Recipient management links contain a random one-time token in the URL fragment. Only its SHA-256 hash is stored; the link expires after 30 minutes and redeems once into a credential-scoped 15-minute session. Resending, revoking, or anonymizing a credential invalidates its outstanding access. The raw token is delivered only through the server-side email function.

Authenticated owner, admin, and issuer PDF generation reads the name from the private recipient record rather than the signed credential. PDF Info metadata uses generic values and contains no recipient name or email; no XMP metadata packet is written.

## Deletion

Data deletion removes recipient name, email, email hash, salt, external ID, issuance-row payloads, and email-event payload details. Verification events are retained without their credential link or IP hash. Free-text revocation reasons are replaced with a fixed non-PII marker; credential-linked audit metadata is replaced with a redaction marker while the audit event, credential ID, action, actor, and timestamp remain. Active per-credential consent scopes receive withdrawal events with the system notice version. Credentials associated with the recipient are revoked; their signed payload, JWS, content hash, and PDF path are cleared while the credential ID, revocation record, consent history, and internal revoked-ID entry remain. Previously downloaded or copied credentials cannot be recalled.

## Existing-PDF stamping and retained artifacts

Google Drive stamping is read-only. The issuer shares a Drive folder as Viewer with a service
account; the app stores no service-account key in Vercel or the browser and never writes back to
Drive. Source PDFs are downloaded transiently per Edge Function invocation and are not persisted
to stamped-PDF Storage.

Stamped PDFs are stored only in the private `stamped-certificate-pdfs` bucket. Object paths contain
organization, run, and file UUIDs, not recipient names or source filenames. Private recipient
names and emails are not written into PDF Info or XMP metadata. A stamped PDF may contain the
recipient's achievement and the public credential ID/serial on its visible QR-adjacent labels.

Run and file records contain IDs and sanitized error codes, not source filenames or recipient PII.
CSV source filenames are discarded by the database and are not persisted; the UI may temporarily
display the selected name locally.
The issuer may download a per-achievement ZIP and formula-sanitized run report for an approved
audit period. Browser ZIP assembly is client-side and must be used only on an issuer-controlled
workstation. The report and downloaded PDFs must follow the organization’s retention and deletion
policy.

Recipient anonymization deletes stamped object files, revokes associated credentials, and removes
the recipient name and email. It cannot recall previously downloaded, copied, or emailed PDFs.

The application currently has no scheduled expiry or purge for stamped-PDF Storage objects,
downloaded ZIPs, or report CSVs. A short-lived signed URL limits access duration but does not delete
the underlying object. Before production use, the data owner must approve retention periods and an
operational deletion procedure, then verify Storage deletion and audit retention in the pilot.
Until that policy and procedure are approved and exercised, stamped-PDF production use is blocked.

The owner must also decide how long to retain unlinkable verification events, pseudonymous audit
and consent records, credential/revocation identifiers, batch metadata, and provider-side email
events. No retention period for those records is inferred or configured by this implementation.
