# ADR 0004: Recipient data deletion

## Status

Accepted.

## Decision

Deletion is implemented as an owner/admin-triggered anonymization transaction. It clears recipient identifying data, issuance-row payloads, email-event details, and stored credential payload/JWS/PDF references. Related credentials are marked revoked and their IDs remain in the credentials table, revocation records, and internal revoked-ID projection.

The function is idempotent and writes an audit event. It does not claim to recall copies previously downloaded by recipients or third parties.

## Rationale

Keeping a signed credential containing a recipient name or salted email identifier would retain recipient data after deletion. Clearing the signed material and revoking the credential preserves the requested credential ID and revocation evidence without retaining the signed recipient payload.
