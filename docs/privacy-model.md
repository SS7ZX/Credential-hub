# Privacy model

## Signed credentials and public projection

Signed VC-JWT payloads never contain the recipient's name. They carry only the salted hash identity and achievement data. The public JSON endpoint constructs a separate projection from the signed credential and private recipient data. It includes no recipient name by default; a name is included only when the recipient has active consent for that credential.

The OG middleware uses that same consent-aware JSON projection. It uses a 30-second shared cache lifetime without stale-while-revalidate; withdrawing consent prevents subsequent projections from including the name, but cannot recall previews already cached by social platforms or copies made by viewers.

## Private data and consent

Raw recipient email and display name remain in Postgres and are not exposed by public Edge Functions except for an explicitly consented display name. Consent is recorded per credential with independent `masked` and `full` scopes. It is hidden by default. Only the recipient's credential-scoped, short-lived management session can grant or withdraw it. Each state change stores a timestamp and notice version and creates an audit event. Consent events are private and unavailable through direct client table access.

For masked consent, names are normalized to NFC and split by Unicode grapheme. A name with one word or at most six graphemes displays initials only. Longer names display the first word followed by each later word's initial plus three asterisks (for example, `Ahmad R*** S***`). Full-name display requires the separate `full` consent.

The signed IdentityObject contains a salted email hash and salt, not the raw email or recipient name. That signed identifier may be present in public credential data but is never used as a display name.

## Visibility

Credentials default to `unlisted`. They are accessible by link or QR but are not listed publicly. Administrators or recipients may switch a credential to `public`.

Recipient management links contain a random one-time token in the URL fragment. Only its SHA-256 hash is stored; the link expires after 30 minutes and redeems once into a credential-scoped 15-minute session. Resending, revoking, or anonymizing a credential invalidates its outstanding access. The raw token is delivered only through the server-side email function.

Authenticated owner, admin, and issuer PDF generation reads the name from the private recipient record rather than the signed credential. PDF Info metadata uses generic values and contains no recipient name or email; no XMP metadata packet is written.

## Deletion

Data deletion removes recipient name, email, email hash, salt, issuance-row payloads, and email-event payload details. Active per-credential consent scopes receive withdrawal events with the system notice version. Credentials associated with the recipient are revoked; their signed payload, JWS, content hash, and PDF path are cleared while the credential ID, revocation record, consent history, and internal revoked-ID entry remain. Previously downloaded or copied credentials cannot be recalled.
