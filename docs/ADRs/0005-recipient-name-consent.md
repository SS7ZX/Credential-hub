# ADR 0005: Recipient names and public consent

## Status

Accepted.

## Decision

Recipient names are never included in a signed credential payload, starting with the first credential. The signed `credentialSubject` contains only the salted email hash identity and achievement. The initial migration is edited in place before first application; the local database may be reset because no real credentials have been issued.

Names are hidden from public output by default. A recipient may independently grant or withdraw `masked` and `full` name-display consent for one credential using that credential's short-lived recipient management session. Every state change is stored as an append-only event with a timestamp and notice version and produces an audit event. The service-only RPC validates the active credential-scoped session and recipient identity; browser clients cannot access the consent table or RPC directly. Anonymization records withdrawal events for active scopes.

The public credential JSON projection reads the private recipient name and active consent together on the server. The Vercel OG middleware consumes that projection and uses a 30-second shared cache TTL without stale-while-revalidate. The public endpoint itself is `no-store`. Third-party social caches and previously copied content cannot be invalidated reliably.

Masked names are NFC-normalized and segmented by Unicode grapheme. A single-word name or a name of at most six graphemes is rendered as initials only. Longer names show the first word in full and subsequent words as their initial plus three asterisks, such as `Ahmad R*** S***`. Full-name visibility requires its own separate consent.

Authenticated organization owners, admins, and issuers may generate a PDF using the private recipient record. PDF Info metadata uses generic values and no XMP metadata packet is produced; recipient names and emails must not appear in metadata.

`PUBLIC_SITE_URL` is the single canonical origin. Credential and achievement IDs and the `did:web` identifier are derived from it; a separate hardcoded or independently configured production domain is not used.

## Consequences

- New and existing local test fixtures must not expect recipient names in signed payloads.
- The public projection can display a name only while the matching credential consent is active.
- Consent history and audit events are retained after withdrawal and anonymization; public display is still disabled.
- Social previews may take up to the configured cache TTL to refresh, and external platforms may retain copies longer.
- Staging and production must each set the correct `PUBLIC_SITE_URL` and publish the matching DID document/key configuration before issuance.

## Validation

Behavior is covered by credential builder tests, middleware tests, PDF metadata tests, and pgTAP tests for default-hidden consent, grant/withdraw/re-grant order, role restrictions, direct table access, audit history, and anonymization withdrawal.
