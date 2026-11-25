# Tasdiq Credential Hub

Tasdiq issues and verifies Open Badges 3.0 credentials using VC-JWT proofs. The public portal is a React SPA; Supabase Edge Functions handle signing, verification, and all credential email delivery. Issuer private keys stay in server-side environment secrets.

## Local setup

1. Copy `.env.example` to `.env.local` and set the public Supabase values plus the server-side secrets required by the local functions.
2. Install the locked dependencies with `npm ci`.
3. Run the portal with `npm run dev`, or validate it with `npm run build`, `npm run lint`, and `npm test`.
4. Install Deno 2 to validate Edge Functions with `deno task test:functions` and `deno task check:functions`.
5. Local database and Edge Function development require Docker Desktop with its engine running. Run `npx supabase db reset` and `npx supabase test db` only against the local Supabase stack.

No remote database command is required for frontend development. Do not run `supabase db push --remote` unless the database owner explicitly requests it.

## Issuer signing key

The owner should generate the signing key on a trusted machine and retain an offline backup. This command generates a fresh Ed25519 key pair; it does not persist the private key in the repository:

```powershell
npm run keygen -- tasdiq-2026-01
```

The script prints the private PKCS#8 key, corresponding public SPKI key, key ID, and public JWK. Set the private/public PEM values and key ID as Supabase Edge Function secrets; register only the public JWK in `issuer_keys.public_jwk`. Treat the command output as secret material and do not paste it into source control, issues, or chat.

Set `ISSUER_OWNER_EMAIL` to the verified owner account email as a Supabase Edge Function secret. Only that account may bootstrap organization creation; the database RPC is executable only by `service_role`, never directly by browser users. Required function secrets are listed in `.env.example`. `VITE_*` values are public browser configuration; all other values must remain server-side.

Credential email delivery uses the `send-emails` Supabase Edge Function and Resend; the browser never calls Resend. Credential emails include a short-lived, single-use recipient management link. Its opaque token is stored only as a hash, redeemed once, and exchanged for a 15-minute credential-scoped session; visibility changes are atomic Postgres RPCs. Email sending defaults to sandbox mode (`RESEND_SANDBOX=true`), which redirects messages to the configured `RESEND_SANDBOX_TO` test inbox and removes recipient names from the test message. Set `RESEND_DAILY_PLAN_LIMIT` to the daily quota for the configured Resend plan. The server-side limiter enforces a rolling 24-hour cap per organization and reports any messages held back by the quota. Only switch sandbox mode off after the sending domain is configured and verified.

## Public credential portal

- `/verify/:id` checks a credential by ID and supports signed VC-JWT paste/upload and QR scanning.
- `/c/:id` displays the public credential projection, a share QR code, and LinkedIn sharing.
- `/manage` redeems the one-time recipient management link from the email fragment and allows the recipient to switch visibility for that credential only.
- `middleware.ts` supplies Open Graph metadata to crawlers from only the public credential projection returned by `get-credential`. It does not expose identity hashes or private credential data in page metadata.
- Public Supabase functions are explicitly configured without gateway JWT enforcement; each applies the intended public projection and/or rate limiting. Issuance remains authenticated.

Recipient names are omitted unless the recipient has consented. Credentials default to unlisted visibility and are reachable by link/QR; public listing is a separate choice.

See [operations and deployment](./docs/operations.md) for environment setup, release gates, Vercel routing, Supabase deployment, recipient link handling, PDF asset readiness, and key-rotation procedures.
