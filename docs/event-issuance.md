# Event setup and participant credential issuance

This guide covers the current issuer workspace workflow for creating event-linked achievements,
preparing a participant list, issuing credentials, and handling common failures. It describes the
implemented behavior; it is not an approval to use real recipient data or production credentials.
For launch gates, use the [production rollout order](./deploy.md) and
[launch checklist](./launch-checklist.md).

## Important behavior and limitations

- An **Event** organizes issuer-side work. The event name, date, location, and description are not
  added to the signed credential by this workflow. The signed achievement content comes from the
  selected **Achievement's** name, description, and criteria narrative.
- A **Category** is an issuer-side grouping label. It does not choose a different credential
  category on each CSV row and is not included in the signed credential by itself. Put any
  recipient-facing wording in the Achievement name or description.
- A credential serial prefix is optional. When provided, it is globally unique across events,
  normalized to uppercase, and combined with the organization's atomic sequence. An Achievement
  prefix overrides its Event prefix; otherwise the Event prefix is used. Prefixes are unique across
  Events and Achievements. The sequence does not reset per event or category. Do not put recipient
  names, NIM/NIK, email addresses, or other personal data in a serial.
- The workspace's initial duplicate policy, visibility, and email choices are `skip`, `unlisted`,
  and off. They are React form state and can remain selected after you finish one batch; verify all
  three settings again before every new issuance rather than assuming they reset.
- Events can be edited. Event field and prefix changes apply to future issuances; they do not
  rewrite serials or signed credential content already issued.
- Serial suffixes have a minimum width of six digits and expand without truncation. The sequence
  remains organization-wide and does not reset per Event or Achievement.
- Importing a CSV **replaces** the staged participant list; it does not append to manually entered
  participants. Save the original file securely before importing.
- The complete validated CSV is staged durably in the database in chunks of up to 50 before the
  batch can be finalized and processed. A draft can be resumed by re-uploading the same file;
  finalized batches can be continued from batch history after a browser/network interruption.
- “Retry failed rows” reprocesses persisted failed issuance rows only. Per-row details show a row
  number, status, safe error code, and serial reference without returning names or emails. The
  dashboard still shows only the 10 most recent batches and 20 most recent credentials.
- Credential email requests are idempotent by batch/request key. **Resume batch emails** does not
  repeat requests already accepted by the provider. **Resend email** starts a deliberate new
  attempt with a fresh request key.
- A successful email-provider response means accepted by the provider, not delivered to the
  recipient.

## 1. Confirm access and prepare

1. Sign in to the issuer workspace and select the correct organization. Only organization owners,
   admins, and issuers can create events/achievements and issue credentials; viewers are
   read-only.
2. Confirm you are using the intended environment and organization. Use synthetic data in local
   or staging. Do not use a production signing key or real participant list for a test.
3. Before an actual issuance, the organization must already have a valid issuer configuration:
   the canonical `PUBLIC_SITE_URL`, an active signing key registered for the organization, and the
   matching issuer DID/JWKS. If those are missing or inconsistent, issuance fails; contact the
   authorized operator rather than changing secrets or database records yourself.
4. Prepare the final participant file and confirm the award criteria with the responsible event
   organizer. Choose one Achievement/category per issuance batch.
5. Decide the event serial format, visibility, duplicate policy, and whether to send emails. Keep
   the default `unlisted` visibility and `skip` duplicate policy unless the owner has reviewed a
   deliberate exception.

## 2. Understand the records

```text
Organization
  └── Event
       └── Achievement (recipient-facing award definition)
            └── Issuance batch (one selected event + one achievement)
                 ├── participant rows
                 └── issued credentials
```

An organization may have many events. An event may have multiple achievements, such as
“CTF — Participant,” “CTF — Finalist,” and “CTF — Winner.” A batch issues the selected Achievement
to the participant rows in that batch. Use separate batches for different awards or categories.

## 3. Create an event

In the issuer workspace's **Create event** form:

1. Enter a recognizable event name (maximum 200 characters).
2. Optionally enter the event date, location (maximum 200 characters), and internal description
   (maximum 2,000 characters).
3. Optionally enter a serial prefix, for example `CTF/HIMASTI/001`.
4. Review the example serial and click **Add event**.

The event fields support issuer organization and selection. They do not automatically appear on the
signed Open Badges credential. The Achievement is the recipient-facing award definition.

### Serial prefix rules

The database trims surrounding whitespace and uppercases the prefix. It accepts one to four
slash-separated segments, with letters, digits, dot, underscore, and hyphen; the total length is at
most 80 characters. Each segment must start with a letter or digit. Examples:

```text
CTF/HIMASTI/001/2026
SEMINAR-A/PARTICIPANT
ROBOTICS_FINAL
```

The prefix must be unique across **all events and achievements in the database**, not merely
within the current organization. A conflict prevents saving. If the prefix is blank, the
organization's existing serial format is used unless the selected Achievement has its own prefix.

### Recommended naming pattern

For example, for one event called **CTF HIMASTI 2026**:

| Workspace field | Example |
|---|---|
| Event name | `CTF HIMASTI 2026` |
| Event serial prefix | `CTF/HIMASTI/001` |
| Achievement serial prefix | blank (inherits the Event prefix) |
| Achievement name | `CTF HIMASTI 2026 — Peserta` |
| Category label | `Peserta` |
| Criteria narrative | The approved, recipient-facing description of what participation means. |
| Example serial | `CTF/HIMASTI/001/000123` |

A Winner Achievement for this same event can inherit the Event prefix or override it with an
Achievement prefix such as `CTF/HIMASTI/JUARA`. The next number still comes from the same
organization sequence. An Achievement prefix overrides the Event prefix only for credentials
issued under that Achievement.

When a prefix is set, the serial combines it with the numeric suffix allocated by the existing
organization-wide atomic counter. For example:

```text
CTF/HIMASTI/001/000123
```

The suffix remains globally allocated within that organization; it is not restarted at `000001`
for a new event or Achievement. The allocation happens as part of the credential persistence
transaction. A reissue consumes another sequence number. Prefixes are part of public credential
serials and must not encode participant identity.

The serial allocator pads to a minimum of six digits and keeps all digits beyond that width. The
database tests cover the seven-digit boundary. The serial suffix remains a shared organization-wide
sequence; separate Event or Achievement counters are not supported. See the forward
[variable-width serial migration](../supabase/migrations/20261127214500_variable_width_serial_suffix.sql)
and [database tests](../supabase/tests/credential_hub_rls.sql).

Use **Edit** beside an Event to correct its metadata or serial prefix. Changing a prefix affects
future credentials only; already-issued serials and signed credential content are not rewritten.
Every Event/Achievement prefix remains globally unique, so reuse of a prefix currently assigned to
another record is rejected. Event edits go through an authorization-checked RPC and add an audit
record containing changed field names, not the old or new field values. Direct Event updates by
authenticated clients are disabled.

## 4. Create an Achievement for each award

Use the **Create achievement** form:

1. Enter the award's public-facing **Achievement name** (maximum 200 characters).
2. Optionally enter a **Category** label (maximum 100 characters), such as `Participant`,
   `Speaker`, or `Winner`.
3. Optionally enter an Achievement serial prefix. It must follow the same format and global
   uniqueness rules as an Event prefix.
4. Link the Achievement to the correct Event.
5. Enter a clear **Description** (required; maximum 2,000 characters).
6. Enter the **Criteria narrative** (required; maximum 4,000 characters).
7. Click **Add achievement** and confirm it is listed with criteria ready.

Criteria are required by the server before issuance. Write them so a recipient and a verifier can
understand what the award represents. The Achievement name, description, and criteria narrative
form the achievement information in the signed credential. The optional Category is a workspace
label only; include it in the name or description if it must be signed and visible to verifiers.

After creation, the issuance form filters the Achievement list to those linked to the selected
Event. An Achievement prefix overrides its Event prefix; without one, the Event prefix applies.
The server also checks that a linked Achievement belongs to the event selected for the batch.

## 5. Prepare participant rows

Choose the Event and the matching Category/Achievement in **Prepare an event participant list**.
You can add participants one at a time or import a CSV.

### CSV format

Use these headers exactly. `full_name` and `email` are required; the other fields are optional:

```csv
full_name,email,external_id,issued_on,expires_on
Sample Recipient,recipient@example.test,PART-001,2026-11-27,2027-11-27
Another Recipient,another@example.test,,2026-11-27,
```

Use synthetic or authorized recipient data only. Recommended date format is ISO `YYYY-MM-DD`;
include an explicit timezone when using a timestamp. JavaScript interprets date-only strings as
UTC; use a timestamp with an explicit offset if an exact instant matters. Check that `expires_on`
is later than `issued_on` before import. The server checks that supplied values parse as dates, but
the current issuance path does not enforce that the expiration is after the issue date. The UI does
not provide a per-row preview for date validity before issuance.

| Field | Requirement and behavior |
|---|---|
| `full_name` | Required; 1–200 characters after trimming. Repeated whitespace is collapsed. |
| `email` | Required; valid email, maximum 320 characters. It is trimmed and lowercased before identity matching. |
| `external_id` | Optional; maximum 120 characters. Repeated whitespace is collapsed. Kept as private recipient data, not placed in the signed credential or public projection, and cleared during anonymization. |
| `category` | The current server schema accepts this optional legacy field (maximum 100 characters), but it does not select or change the batch Achievement. Do not rely on it; choose the Achievement once in the workspace instead. |
| `issued_on` | Optional row-specific credential issue/valid-from date. If omitted, the server uses the batch date if present, otherwise the current time. |
| `expires_on` | Optional row-specific credential expiration. If omitted, the batch expiration is used if present; otherwise the credential has no expiration value. |

The Edge Function supports batch-level `issueDate` and `expiresAt` defaults, but the current
workspace form does not expose those fields. In the current UI, use `issued_on` and `expires_on`
for per-row dates; when `issued_on` is absent, the server uses its current time, and when
`expires_on` is absent, no expiration is set.

The selected Achievement is applied to every row in the batch. A CSV cannot assign different
Achievements to different participants. Do not add a per-row `category` expecting it to change
the award.

The client checks that the required headers exist, the CSV parses, at least one row is present, and
there are no more than 1,000 data rows. The server validates and normalizes each row before it is
persisted for staging. Invalid rows are reported by row number without echoing names or email
addresses; unknown columns are rejected by the strict row schema. A file can load into the review
list but fail server validation when staging. If earlier chunks are already staged, they are
immutable: start a new batch for corrected participant data.

### Identity and data-handling notes

- Email is normalized to lowercase and trimmed for recipient matching. Repeated whitespace in
  names and external IDs is collapsed.
- The optional external ID is stored privately for issuer-side roster matching. Do not use NIK,
  government ID, or other sensitive identifiers without a documented legal and operational need.
- The signed VC-JWT does not contain the recipient's name or external ID. Public display of a
  recipient name is controlled separately by that recipient's consent.
- Anonymization clears recipient PII and the external ID and redacts issuance-row input data. It
  does not recall credentials, PDFs, or exports already copied or downloaded. See the
  [privacy model](./privacy-model.md).
- Keep source CSVs in an access-controlled location. Do not attach them to chat, tickets, or
  public issue reports. The browser may temporarily display the selected filename; do not put
  participant names or IDs in filenames.

## 6. Review the staged list

Before creating a batch:

1. Confirm the selected organization, Event, Achievement, and category.
2. Check the participant count and inspect every displayed name, optional ID, and email.
3. Remove any incorrect row. If importing a CSV after manual entry, remember that the import
   replaces the manual list.
4. Confirm the duplicate policy and visibility.
5. Leave credential email sending disabled unless delivery is part of the approved workflow and
   the sandbox/daily quota configuration is understood.
6. Confirm the Achievement description and criteria are final; the UI has no per-recipient
   override for them.

The UI does not pre-deduplicate the staged CSV. The server applies the duplicate policy against
an already-issued credential for the same normalized recipient in the organization and the same
Achievement whose database status is `issued`. The check does not use expiration time, so do not
assume an expired-but-still-`issued` credential will be treated as a new recipient. Repeated rows
in one batch can therefore cause the later row to be treated as a duplicate after the earlier row
is persisted.

### Duplicate policy

The default is **Skip** and the choice is stored with the batch:

| Policy | Result |
|---|---|
| `skip` | If the same recipient already has a credential with status `issued` for this Achievement in this organization, do not create another one. The row is counted as a successful skip and points to the existing credential. |
| `reissue` | Create an additional credential with a new serial. The existing credential is not automatically revoked. Use only after confirming that multiple active credentials are intended. |
| `error` | Mark the duplicate row failed; the rest of the batch continues. The failed row can be retried after the underlying issue is resolved. |

The duplicate check is not a general CSV cleanup tool: it does not remove duplicate rows before
review and does not compare people across organizations. It is based on normalized email/recipient
identity and the selected Achievement.

### Visibility and consent

- **Unlisted** is the default. The credential can be reached through its link or QR but is not
  listed publicly.
- **Public** makes the credential available through public discovery/projection behavior.
- Recipient name display is separate from credential visibility. A name appears publicly only
  after the recipient grants the applicable consent through the management link.
- Avoid selecting Public during a test. Use synthetic test recipients and verify the projection
  before any public release.
- Confirm visibility on every batch: changing it for one batch does not automatically restore the
  initial unlisted state while the current workspace remains open.

## 7. Issue the batch

1. Click **Issue N credentials** only after reviewing the entire staged list.
2. The browser creates a draft and stages normalized participant data in sequential groups of up
   to 50 rows. The batch cannot start processing until all rows have been staged and finalized.
3. Keep the batch ID from **Recent batches** for operational reconciliation. If the browser closes
   during staging, select **Resume upload**, re-upload the exact same source file, and stage again.
   The server accepts an identical replay and rejects changed data in already-staged rows.
4. After finalization, the server processes durable pending rows in groups of up to 50. If the
   browser/network stops, use **Continue issuance** from Recent batches; do not start a new batch
   for that list.
5. Check processed, succeeded, and failed counts. **View rows** shows paginated row numbers,
   statuses, safe error codes, and serial references without names or email addresses. A skipped
   duplicate counts as succeeded but is not a newly created credential.
6. Reconcile counts and row outcomes against the securely held source list. Do not distribute
   credentials if they do not reconcile.

The server validates the selected issuer, Achievement, active signing key, and signing-key
publication before persistence. Each credential is persisted through the database RPC that
allocates the organization serial atomically. Do not repeat the entire operation merely because
the browser displayed a network error; first inspect the existing batch and credential state.

## 8. Email delivery

Sending credential email is an opt-in checkbox and is off by default. When enabled:

- the browser calls the `send-emails` Edge Function; email provider credentials are server-side
  only;
- emails are attempted only after the issuance loop finishes and only for credentials associated
  with that batch that are in `issued` status. Rows skipped as duplicates point to the earlier
  credential and are not included in the new batch's email query;
- organization daily plan limits and sandbox settings apply; throttled or failed sends are not
  evidence of credential issuance failure. Failed provider attempts may still consume the
  conservative rolling 24-hour quota; see [operations](./operations.md).
- provider acceptance is not a delivery receipt. Check the authorized provider/operations
  evidence before claiming that recipients received a message.

If the browser closes or a request fails after issuance but before email sending, **Resume batch
emails** submits the same batch request key. Previously accepted requests are not sent twice;
attempts still marked reserved are reported as pending confirmation and are not submitted again
because the provider outcome may be uncertain. To intentionally send a credential email again,
use **Resend email**, which creates a distinct request key. Email provider acceptance is not a
delivery receipt; check provider delivery/bounce/complaint evidence before claiming recipient
receipt.

## 9. Failed, interrupted, or partial batches

### Persisted failed rows

If the batch completed with failed rows:

1. Review the count in **Recent batches** and preserve the original source list securely.
2. Resolve a configuration/transient failure. Retries reuse the immutable server-staged row; they
   do not reload edits from the source file.
3. If participant data itself must change, confirm no credential was issued for that row and start
   a new batch with the corrected source data. Do not edit the staged payload directly.
4. Use **Retry failed rows** only when retrying the same stored row is appropriate. The server
   retries persisted failed rows, at most 50 per retry request.
5. If failures remain, repeat **Retry failed rows**; each click processes at most 50 persisted
   failed rows.
6. Refresh and verify that the failed count is resolved. Retry does not create a new batch and
   does not send emails.

Common causes include invalid row values, missing Achievement criteria, a missing/mismatched
signing key, or a request/provider failure. Do not put recipient data or raw provider errors in
support tickets.

### Browser closed, network interruption, or uncertain result

- **Draft batch:** choose **Resume upload**, re-upload the exact same CSV, and click Issue to replay
  the staged chunks. The database accepts an identical staged row and rejects a different payload.
  If participant data needs correction, start a new batch rather than editing persisted rows.
- **Queued/processing batch:** choose **Continue issuance**. Processing resumes only from
  server-stored pending rows. Do not resubmit the whole list as a new batch.
- **Completed batch with failures:** inspect **View rows**, then use **Retry failed rows**. A retry
  reuses that row's stored data and idempotency key; repeat as needed for rows that remain failed.
- **Uncertain email outcome:** use **Resume batch emails** with the original batch key. A previous
  `sent` attempt is not submitted again. A `reserved` attempt is reported pending because the
  provider outcome may be unknown. Use **Resend email** only when a deliberate new send is intended.

The dashboard still lists only the 10 most recent batches and 20 most recent credentials; older
records are not searchable from this page. Preserve batch IDs and reconcile against the approved
source file in the organization's secure operational record.

### Duplicate submission

Do not double-click Issue or start a second batch while the first is still processing. Row
idempotency protects retries within the same batch, but a newly created batch has a new identity.
The duplicate policy is a second safeguard, not a replacement for checking batch counts. In
particular, `reissue` can create another active credential and is not safe as a default recovery
policy.

## 10. Post-issuance checks and privacy

For a controlled test or pilot:

- use a synthetic recipient and an unlisted credential;
- confirm the Achievement text, issuer, dates, status, and serial are correct;
- verify the credential link/QR resolves to the expected public verification route;
- check the public projection contains no recipient name without consent and no external ID;
- if emails are enabled, keep the provider in sandbox and confirm the configured test recipient;
- record only batch IDs/counts and sanitized outcomes in the operational record; do not record
  names, emails, participant IDs, access links, or full credential JWTs; and
- follow the approved retention policy for the source CSV and any downloaded PDFs/reports.

Do not treat a successful signature as proof that the event organizer's award decision or source
participant data is correct. The issuer is responsible for reviewing eligibility and award
accuracy.

## Troubleshooting

| Symptom | Likely cause / safe next action |
|---|---|
| Event save reports a prefix conflict | The prefix is already used by another event. Choose an approved, distinct prefix; do not add a participant identifier. |
| Achievement is absent from the batch selector | It is not linked to the selected Event. Confirm the correct event when creating the Achievement. |
| Issuance fails for every row | Check with the authorized operator for issuer DID, `PUBLIC_SITE_URL`, active registered signing key, and service health. Do not paste secrets into the UI or a ticket. |
| Some rows fail while others succeed | Refresh the batch counts, inspect/fix the source list, then retry only persisted failed rows. A loaded CSV is not proof every row is valid. |
| A row says duplicate | Review recipient identity and selected Achievement. `skip` keeps the existing credential; `reissue` creates another and does not revoke the old one. |
| Processed count is below the CSV row count after interruption | Some chunks may never have reached the server. Do not assume Retry failed rows can recover them; reconcile the original list with existing credentials first. |
| Email count is lower than issued count | Check send opt-in, daily limit, sandbox routing, and provider status. Issuance retry does not retry email. |
| Recipient name is not shown publicly | This is expected unless that recipient has granted the applicable name-display consent. |
| External ID is absent after anonymization | This is expected; anonymization clears the private external ID and recipient PII. |

For operational or privacy incidents, use the restricted contacts and
[operations guide](./operations.md). For unresolved launch gates, keep the release at NO-GO and
follow the [launch checklist](./launch-checklist.md).

## Remaining limitations and owner decisions

- The dashboard lists only the 10 newest batches and 20 newest credentials. Older records are not
  searchable from this UI. Keep a secure operational record of batch IDs and use an approved
  database/operator workflow for older reconciliation.
- Event/achievement prefixes are globally unique, but serial counters remain organization-wide;
  neither per-event reset nor per-achievement reset is supported.
- Failed staged rows are immutable. If row data must change, an issuer must verify the old row did
  not issue a credential, create a new batch, and reconcile the prior batch.
- A `sent` email attempt means the provider accepted the request, not that it was delivered. A
  request left `reserved` is not automatically repeated because provider acceptance may be
  uncertain. Resend starts a new explicit attempt.
- No retention duration is selected by this implementation. The owner/legal reviewer must decide:
  - how long to keep validated participant payloads in issuance rows before recipient
    anonymization;
  - how long to keep batch summaries and sanitized row outcomes;
  - how long to retain keyed email-send attempts (currently retained to preserve idempotency),
    unkeyed quota reservations, and email/provider event records;
  - how long locally held source CSVs, exported reports, and downloaded/stamped PDFs may remain;
  - how to archive or purge abandoned partial draft batches without removing records needed for
    audit, idempotency, or revocation; and
  - how retention interacts with access/deletion requests, accounting requirements, and legal
    holds.

Do not treat unresolved retention decisions as settled by the current database behavior. Any
reconciliation outside the visible workspace must be performed by an authorized operator under an
approved, auditable procedure.

## Implementation references

This guide is written against the implementation below. Recheck it when these files change:

- [Admin workspace](../src/Admin.tsx) — event/Achievement forms, CSV review, duplicate/visibility
  state, draft resume, row outcome details, event editing, serial prefixes, and email resend.
- [Issue-batch Edge Function](../supabase/functions/issue-batch/index.ts) — role enforcement,
  request limits, durable row staging, processing resume, sanitized row outcomes, and credential
  persistence.
- [Durable batch migration](../supabase/migrations/20261127223000_durable_issuance_batches.sql)
  — idempotent creation, immutable staging, finalization, progress status, and safe failure codes.
- [Email idempotency migration](../supabase/migrations/20261127230000_idempotent_credential_email_sends.sql)
  — per-credential request keys and atomic quota reservation.
- [Issuance row schema](../supabase/functions/_shared/issuance-row.ts) — allowed row fields,
  lengths, email normalization, and whitespace normalization.
- [Initial credential schema and persistence RPC](../supabase/migrations/20261124133357_initial_credential_schema.sql)
  — recipient matching, duplicate semantics, and serial allocation.
- [Event participant migration](../supabase/migrations/20261127001000_event_participant_fields.sql)
  and [Achievement prefix migration](../supabase/migrations/20261127220000_achievement_serial_prefix.sql)
  — prefix validation, precedence, global uniqueness, and external-ID synchronization.
- [Audited Event update migration](../supabase/migrations/20261127231500_audited_event_updates.sql)
  — authorized Event edits, audit records, and disabled direct updates for authenticated clients.
- [Credential/RLS pgTAP tests](../supabase/tests/credential_hub_rls.sql) — serial overflow,
  prefix precedence, durable staging, and email request idempotency coverage.
