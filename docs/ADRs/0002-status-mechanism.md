# ADR 0002: Revocation mechanism

## Status

Accepted for implementation, with encoding validation deferred to Phase 2.

## Decision

Use 1EdTech RevocationList semantics: revoke by credential ID and publish organization-scoped revoked credential IDs. Do not allocate or store bitstring status-list indexes.

The database stores revocations in `public.revocations` and a JSON array of revoked credential IDs in `public.status_lists.revoked_credential_ids`.

## Current specification finding

The official Open Badges Specification 3.0 final release document 1.4.5 (2026-06-29) found in this review explicitly exposes Bitstring Status List examples, but no `1EdTechRevocationList` type was found in that downloaded document. CredentialHub will not invent a serialized format. Phase 2 must confirm the exact 1EdTech conformance-profile representation and official URLs before exposing `credentialStatus`.

## Future option

Bitstring Status List may replace or complement this mechanism after it is required by a conformance profile or at greater credential volume.
