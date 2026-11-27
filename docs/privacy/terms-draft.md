# NEEDS LEGAL REVIEW — Draft service terms

**Status: DRAFT — NOT APPROVED OR EFFECTIVE.** This working draft is for the service owner and
qualified counsel. It is not legal advice and must not be published or accepted as binding terms
until jurisdiction, contracting entity, service scope, liability, privacy, and dispute provisions
have been reviewed and approved.

## 1. Service scope

Credential Hub is intended to let an authorized organization configure events and achievements,
issue and verify digital credentials, manage visibility and recipient consent, revoke credentials,
and optionally add verification QR codes to existing certificate PDFs. Features, availability, and
provider integrations may change. The service does not guarantee that an issuer's award decision,
recipient data, source PDF, or credential claim is accurate.

## 2. Organization and issuer responsibilities

An organization is responsible for:

- authorizing its users and reviewing roles before granting access;
- confirming its authority and lawful basis to process recipient data and source PDFs;
- providing accurate event, achievement, recipient, and credential information;
- giving recipients any required privacy notice and obtaining valid consent before public display
  of a recipient name;
- securing its accounts, signing-key backups, downloaded files, and shared Drive folders;
- reviewing recipient-to-certificate matches and sample previews before approving a stamping run;
- deciding and documenting retention periods for its exports and source records; and
- responding to requests, corrections, revocations, and incidents through its approved process.

Do not upload sensitive official identifiers or unrelated personal data unless the organization
has separately confirmed necessity, lawful basis, notice, and safeguards with counsel.

## 3. Credentials and verification

Credentials may be public, unlisted, or revoked according to the product controls and issuer
decisions. An unlisted credential is accessible to people who have its link or QR code; it is not
confidential. Public verification confirms only the signature and status information available to
the service. It does not independently confirm the truth, quality, legal effect, or current
acceptance of an achievement.

Issuers are responsible for correcting or revoking inaccurate or unauthorized credentials.
Previously copied, downloaded, cached, or printed credentials and previews may remain accessible
outside the service after a visibility change, revocation, or deletion request.

## 4. Recipient information and consent

The service uses recipient information to issue, verify, deliver, and manage credentials. Recipient
names are not placed in signed credential payloads. A recipient name is shown in the public
projection only where the recipient has enabled the applicable consent for that credential.
Recipients may withdraw that consent through the management link while it remains valid.

Anonymization removes or redacts configured recipient fields and invalidates associated access.
It cannot recall copies already downloaded, emailed, printed, or retained by external services.
See the separate [privacy model](../privacy-model.md) for the current data map and open retention
decisions.

## 5. Existing PDF stamping

The organization must have authority to process each source PDF and share its Drive folder with the
configured read-only service account. Source PDFs are read for processing and are not written back
to Drive. Stamped output is stored in private object storage and may be downloaded by authorized
users through temporary links.

The organization must inspect the full matching list, resolve all hard errors, approve the random
sample, and check output before distribution. The detailed
[stamping terms draft](./drive-stamping-terms-draft.md) contains additional workflow-specific
language and is also subject to legal review.

## 6. Retention and deletion

Retention periods, backup retention, and deletion service levels are **not specified by this
draft**. The service owner must approve those decisions and confirm what can be deleted from
primary storage, backups, logs, verification records, and third-party providers before publication.
Until then, do not promise a deletion deadline or complete erasure.

## 7. Availability, support, and changes

No availability commitment, response time, support channel, or service-level objective is approved
by this draft. The owner must decide these terms and publish verified support and incident contact
details through an appropriate restricted or public channel.

## 8. Legal review items

Counsel and the service owner must fill in or decide, at minimum:

- contracting entity, governing law, venue, eligible users, and age restrictions;
- privacy notice and lawful bases/roles for recipient and issuer data;
- subprocessor list, international transfers, and provider terms;
- retention periods, deletion process, and backup/log treatment;
- intellectual-property and acceptable-use terms;
- warranties, liability limits, indemnities, termination, and dispute procedure;
- support contacts, incident notices, and any service-level commitments; and
- consumer/recipient-facing rights, correction, access, and complaint process.

Do not publish this draft until every applicable item has been resolved and the final text approved.
