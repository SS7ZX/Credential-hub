# ADR 0003: Atomic Postgres RPC operations

## Status

Accepted.

## Decision

Issue persistence, serial allocation, revocation, and recipient anonymization use Postgres RPC functions. RPC functions run atomically and use `SECURITY DEFINER` with `set search_path = ''`.

Edge Functions may call these RPCs but browser clients may not perform direct issue-persist, revoke, or serial-allocation table writes.

The browser sends batches to `issue-batch` as chunks only after server-side authentication and Zod validation. Email sending is performed only by the `send-emails` Edge Function.
