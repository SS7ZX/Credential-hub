# ADR 0004: Recipient data deletion

## Status

Accepted.

## Decision

Deletion is initiated by an owner/admin through the `anonymize-recipient` Edge Function. It first marks the recipient as pending, withdraws name consent, and revokes active recipient-management sessions. The function removes the recipient's stamped PDFs using the private Storage API and only then calls the service-role-only finalization RPC. Finalization clears recipient identifying data, issuance-row payloads, email-event details, stored credential payload/JWS/PDF references, and stamped-file paths and source identifiers. Related credentials are marked revoked and their IDs remain in the credentials table, revocation records, and internal revoked-ID projection.

Storage deletion and Postgres cannot share a transaction. If Storage deletion fails, finalization is not run and the pending anonymization can be retried. The RPCs are idempotent; finalized recipient data stays anonymized if a client retries. The direct authenticated call to the database anonymization RPC is removed so callers cannot bypass Storage cleanup.

The function is idempotent and writes an audit event. It does not claim to recall copies previously downloaded by recipients or third parties.

## Rationale

Keeping a signed credential containing a recipient name or salted email identifier would retain recipient data after deletion. Clearing the signed material and revoking the credential preserves the requested credential ID and revocation evidence without retaining the signed recipient payload.
