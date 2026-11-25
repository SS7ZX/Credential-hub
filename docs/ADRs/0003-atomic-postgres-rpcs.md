# ADR 0003: Atomic Postgres RPC operations

## Status

Accepted.

## Decision

Issue persistence, serial allocation, revocation, and recipient anonymization use Postgres RPC functions. RPC functions run atomically and use `SECURITY DEFINER` with `set search_path = ''`.

Edge Functions may call these RPCs but browser clients may not perform direct issue-persist, revoke, or serial-allocation table writes.

The browser sends batches to `issue-batch` as chunks only after server-side authentication and Zod validation. Email sending is performed only by the `send-emails` Edge Function.

Organization bootstrap is also atomic: `create-organization` authenticates the caller, requires a verified email matching the server-side `ISSUER_OWNER_EMAIL`, then invokes a `service_role`-only Postgres RPC. The RPC independently checks the caller role and confirmed user record before creating the organization, owner membership, status list, and audit event. Authenticated browser users cannot execute this RPC directly.

Recipient access-token creation, redemption, and visibility changes are `service_role`-only Postgres RPCs. The database atomically validates credential status, recipient identity hash, token expiry, single-use redemption, and session expiry; it stores only hashes of the random tokens. Recipient sessions can change visibility for one credential only.

Email quota enforcement reserves a send under an organization-scoped Postgres advisory lock and counts reservations and completed attempts in the preceding 24 hours. Reservation and result logging are separate `service_role`-only RPCs so concurrent Edge Function requests cannot exceed the configured daily cap. Resend receives the reservation UUID as its idempotency key.

Organization invitation creation and acceptance are also atomic, `service_role`-only RPCs. Creation independently checks that the acting user is an organization owner, normalizes the email, prevents owner-role invitations, and revokes an earlier pending invitation for that address. Acceptance locks the invitation, verifies the confirmed Auth email matches, enforces expiry/revocation, creates membership, and records the audit event in one transaction. Repeating acceptance by the same account is idempotent.
