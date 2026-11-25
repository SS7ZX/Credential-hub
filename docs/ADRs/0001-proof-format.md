# ADR 0001: VC-JWT proof format

## Status

Accepted for Phase 2.

## Decision

CredentialHub will sign Open Badge 3.0 credentials as VC-JWT compact JWS documents using Ed25519/EdDSA by default. The signing algorithm is configurable for conformance profiles that require another supported algorithm.

Private keys remain only in Supabase Edge Function secrets. No private key is stored in Postgres or browser code.

## References

- Open Badges Specification 3.0, final release, document 1.4.5, issued 2026-06-29: https://www.imsglobal.org/spec/ob/v3p0/main/
- Open Badges 3.0 context 3.0.3: https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json
- Open Badges 3.0 AchievementCredential JSON-LD schema: https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json
- W3C VC-JOSE-COSE Recommendation, 13 October 2026: https://www.w3.org/TR/2026/REC-vc-jose-cose-20261013/
- W3C Verifiable Credentials Data Model v2.0 Recommendation: https://www.w3.org/TR/2025/REC-vc-data-model-2.0-20250515/

The VC-JOSE-COSE Recommendation registers `application/vc+jwt` and says the `typ` protected-header parameter SHOULD be `vc+jwt`; when present, `cty` SHOULD be `vc`. CredentialHub uses those values.

The official Open Badges schema is pinned in `supabase/functions/_shared/ob_v3p0_achievementcredential_schema.json` and validated before signing and during verification.
