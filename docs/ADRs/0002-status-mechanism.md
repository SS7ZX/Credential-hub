# ADR 0002: Revocation mechanism

## Status

**Decision pending for serialized credentials.** Internal revocation tracking is implemented. No serialized status method is approved by this ADR yet, and no new status format or index/bitstring logic is to be implemented until the product owner chooses an option.

## Current internal behavior

Track revoked credential IDs in Postgres and return revocation results through CredentialHub's verification endpoint. The database stores revocation records in `public.revocations` and an organization-scoped revoked-ID projection in `public.status_lists.revoked_credential_ids`. This is an internal application representation, not an external OB 3.0 status method.

## Official sources reviewed

1. **Open Badges Specification 3.0**, document 1.4.5, dated 2026-06-29: <https://www.imsglobal.org/spec/ob/v3p0>. Reviewed the credential/status model, credential verification discussion, examples, and linked JSON Schema. `credentialStatus` is optional in the linked AchievementCredential schema; when present, the generic schema requires `type` but allows additional properties. It does not by itself establish interoperability or certification for every arbitrary status type.
2. **Open Badges 3.0 Conformance and Certification Guide**, document 1.5, dated 2026-06-15: <https://www.imsglobal.org/spec/ob/v3p0/cert/>. Section 4.1's revocation test identifies `BitstringStatusListEntry` with `statusPurpose: "revocation"` as the test's revoked-credential signal. Section 2.2 directs implementers to the conformance suite and describes submission of an issued test credential. This is the clearest reviewed certification evidence for the Bitstring option.
3. **Open Badges 3.0 Implementation Guide**, document 2.1, dated 2026-06-15: <https://www.imsglobal.org/spec/ob/v3p0/impl>. Reviewed for implementation and conformance guidance; it does not make the separate Candidate Final Public VCRL document a final standard.
4. **Open Badges 3.0 Errata**, document 1.6, dated 2026-06-29: <https://www.imsglobal.org/spec/ob/v3p0/errata>. Reviewed for corrections relevant to the selected OB version.
5. **1EdTech Revocation List Status Method**, previously reviewed as version 1.2, dated 2024-04-05, status **Candidate Final Public**. The previously captured document describes a `1EdTechRevocationList` status type and a TLS GET endpoint whose response represents revoked credential IDs as a list, rather than a bitstring index. However, the URL previously associated with it (`https://www.imsglobal.org/spec/ob/v3p0/cs/revocation-list`) returned HTTP 404 when re-checked for this revision, and the document is not listed in the current OB 3.0 document set (§1.2). Treat those details as a prior research finding requiring a current, independently verifiable official source—not as a confirmed currently published/adopted standard.
6. **1EdTech Verifiable Credentials certification suite**: <https://certification.imsglobal.org/certification/verifiable-credentials/>. Reviewed as the operational destination referenced by the guide.
7. **Linked AchievementCredential JSON Schema**: <https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json>. Reviewed the `CredentialStatus` definition: `type` is required; `id` is described as the URL of the issuer's status method; the schema leaves the status-method-specific shape open.

The sources answer different questions: the OB credential schema is structurally permissive, while the certification guide's revocation test specifies Bitstring Status List behavior. The previously reviewed VCRL document described a list-of-IDs method, but its source URL could not be revalidated and its Candidate Final Public status does not establish that it passes the OB 3.0 certification test. Do not claim that generic schema validation proves status-method conformance.

## Options for the owner

| Option | Benefits | Costs and limitations |
| --- | --- | --- |
| **Bitstring Status List** (`BitstringStatusListEntry`) | Matches the reviewed certification guide's revocation test; supports compact, indexed status publication and is designed to avoid publishing each revoked ID as a straightforward list. | Requires index allocation and a status-list credential/endpoint, correct update and caching semantics, and schema/database/application changes. A shared status list can reveal verifier fetch patterns; it must be hosted and operated reliably. |
| **No serialized `credentialStatus`** | Simplest credential format; avoids claiming an external status method not yet selected. The first-party verifier can continue to consult CredentialHub's database/API. | Offline and third-party verifiers cannot discover revocation from the credential; the reviewed certification guide's revocation test may not pass. Online first-party checking becomes essential. |
| **1EdTechRevocationList (additional research finding)** | Matches the reviewed VCRL document's list-of-revoked-IDs design; simpler to understand and inspect than bitstring indexing. | The document reviewed is Candidate Final Public, not confirmed final/adopted; certification-guide support is not established. A public list can disclose revoked IDs and grows with revocations. Before implementation, resolve exact response/schema details and confirm adoption and validator acceptance. |

## Decision and implementation gate

No option is selected in this revision. Until the owner decides:

- Keep internal revocation records and first-party verification behavior.
- Do not add `status_list_index`, bitstring storage/index allocation, a serialized `BitstringStatusListEntry`, a serialized `1EdTechRevocationList`, or any other new `credentialStatus` representation.
- Do not claim OB 3.0 revocation certification based solely on schema validity or internal revocation records.
- Before implementation, record the chosen version/profile and validator evidence in this ADR, then make the schema, migration, issuance, publication, and verification changes together.
