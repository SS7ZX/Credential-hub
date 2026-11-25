# Privacy model

## Public

Public projection is limited to credential ID, achievement, issuer, issue/expiry dates, status, and public consented display name.

## Private

Raw recipient email and display name remain in Postgres and are never exposed by public Edge Functions. Recipients receive an email hash and salt in the credential IdentityObject.

## Visibility

Credentials default to `unlisted`. They are accessible by link or QR but are not listed publicly. Administrators or recipients may switch a credential to `public`.

Recipient management links contain a random one-time token in the URL fragment. Only its SHA-256 hash is stored; the link expires after 30 minutes and redeems once into a credential-scoped 15-minute session. Resending, revoking, or anonymizing a credential invalidates its outstanding access. The raw token is delivered only through the server-side email function.

## Deletion

Data deletion removes recipient name, email, email hash, salt, consent, issuance-row payloads, and email-event payload details. Credentials associated with the recipient are revoked; their signed payload, JWS, content hash, and PDF path are cleared while the credential ID, revocation record, and internal revoked-ID entry remain. Previously downloaded or copied credentials cannot be recalled.
