# Privacy model

## Public

Public projection is limited to credential ID, achievement, issuer, issue/expiry dates, status, and public consented display name.

## Private

Raw recipient email and display name remain in Postgres and are never exposed by public Edge Functions. Recipients receive an email hash and salt in the credential IdentityObject.

## Visibility

Credentials default to `unlisted`. They are accessible by link or QR but are not listed publicly. Administrators or recipients may switch a credential to `public`.

## Deletion

Data deletion anonymizes recipient PII while retaining the credential ID and revocation record.
