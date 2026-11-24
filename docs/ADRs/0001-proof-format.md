# ADR 0001: VC-JWT proof format

## Status

Accepted for Phase 2.

## Decision

CredentialHub will sign Open Badge 3.0 credentials as VC-JWT compact JWS documents using Ed25519/EdDSA by default. The signing algorithm is configurable for conformance profiles that require another supported algorithm.

Private keys remain only in Supabase Edge Function secrets. No private key is stored in Postgres or browser code.

## References

- Open Badges Specification 3.0, final release, document 1.4.5, issued 2026-06-29: https://www.imsglobal.org/spec/ob/v3p0/main/
- W3C VC-JOSE-COSE Recommendation, 13 October 2026: https://www.w3.org/TR/vc-jose-cose/
- W3C Verifiable Credentials Data Model v2.0: https://www.w3.org/TR/vc-data-model-2.0/

The exact JWS protected-header `typ` value remains subject to the official 1EdTech conformance profile and will be validated in Phase 2 before signing.
