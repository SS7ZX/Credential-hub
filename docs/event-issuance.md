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
  normalized to uppercase, and combined with the organization's atomic sequence. The sequence does
  not reset per event or category. Do not put recipient names, NIM/NIK, email addresses, or other
  personal data in a serial.
- The workspace's initial duplicate policy, visibility, and email choices are `skip`, `unlisted`,
  and off. They are React form state and can remain selected after you finish one batch; verify all
  three settings again before every new issuance rather than assuming they reset.
- The current UI has no event-edit control. Confirm the event name and serial prefix before saving.
- The serial allocator currently pads suffixes to six characters using PostgreSQL `lpad`, which
  truncates values wider than the target length. There is no overflow guard or seven-digit test;
  treat this as a scale-up blocker and do not assume arbitrary-width serials. Details are under
  [Serial prefix rules](#serial-prefix-rules).
- Importing a CSV **replaces** the staged participant list; it does not append to manually entered
  participants. Save the original file securely before importing.
- Issuance is sent to the server in sequential chunks of up to 50 rows. A failed request can leave
  a partially processed batch. Only submitted rows are durably recorded; rows in browser memory
  that were never submitted are not available to the retry action.
- “Retry failed rows” reprocesses persisted failed issuance rows only. It does not retry unsent
  chunks or send credential emails. The current batch screen shows counts, not a row-by-row
  reconciliation or email-resend interface. The dashboard shows only the 10 most recent batches
  and 20 most recent credentials and has no search/pagination for older records. See
  [interrupted or partial batches](#9-failed-interrupted-or-partial-batches)
  before attempting recovery.
- A successful email-provider response means accepted by the provider, not delivered to the
  recipient. The current UI does not expose a separate resend action for issuance emails.

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

The prefix must be unique across **all events in the database**, not merely within the current
organization. A conflict prevents saving the event. If the prefix is blank, the organization's
existing serial format is used.

### Recommended naming pattern

For example, for one event called **CTF HIMASTI 2026**:

| Workspace field | Example |
|---|---|
| Event name | `CTF HIMASTI 2026` |
| Event serial prefix | `CTF/HIMASTI/001` |
| Achievement name | `CTF HIMASTI 2026 — Peserta` |
| Category label | `Peserta` |
| Criteria narrative | The approved, recipient-facing description of what participation means. |
| Example serial | `CTF/HIMASTI/001/000123` |

A Winner Achievement for this same event uses the same event prefix and the next organization
sequence, for example `CTF/HIMASTI/001/000124`; the Achievement identifies the award. The current
product assigns prefixes to **Events**, not to Achievements, and it has no category-specific
counter or serial-prefix field. It cannot produce separate `.../PESERTA/...` and `.../JUARA/...`
serial formats for different Achievements within one Event. Do not create duplicate Event records
to work around this without the issuer owner's approval and a data-migration plan.

When a prefix is set, the serial combines it with the numeric suffix allocated by the existing
organization-wide atomic counter. For example:

```text
CTF/HIMASTI/001/000123
```

The suffix remains globally allocated within that organization; it is not restarted at `000001`
for a new event or Achievement. The allocation happens as part of the credential persistence
transaction. A reissue consumes another sequence number. Prefixes are part of public credential
serials and must not encode participant identity.

The current SQL calls PostgreSQL `lpad(sequence, 6, '0')`. PostgreSQL truncates a string on the
right when it exceeds the requested length, so a seven-digit sequence such as `1000000` becomes
`100000`. Because the serial also contains the year, the exact collision depends on which
truncated values have already been issued under the same prefix and year; the database does not
currently reject overflow or expand the suffix. This boundary is not covered by the current
serial tests. Before high-volume use, update the allocator to use variable-width padding (minimum
six digits) or an explicit safe bound, and add pgTAP cases for six- and seven-digit values. Do not
assume seven-digit serial behavior from the UI example. See the
[issuance migration](../supabase/migrations/20261124133357_initial_credential_schema.sql) and
[PostgreSQL `lpad` documentation](https://www.postgresql.org/docs/current/functions-string.html).
The existing [database test](../supabase/tests/credential_hub_rls.sql) checks normalization and a
six-digit serial example, but does not cover the overflow boundary.

The current UI does not offer an event edit action. If an event was created with the wrong prefix,
do not work around the UI by editing database rows; ask the authorized owner/operator to review a
safe correction or create a new event with a distinct prefix.

## 4. Create an Achievement for each award

Use the **Create achievement** form:

1. Enter the award's public-facing **Achievement name** (maximum 200 characters).
2. Optionally enter a **Category** label (maximum 100 characters), such as `Participant`,
   `Speaker`, or `Winner`.
3. Link the Achievement to the correct Event.
4. Enter a clear **Description** (required; maximum 2,000 characters).
5. Enter the **Criteria narrative** (required; maximum 4,000 characters).
6. Click **Add achievement** and confirm it is listed with criteria ready.

Criteria are required by the server before issuance. Write them so a recipient and a verifier can
understand what the award represents. The Achievement name, description, and criteria narrative
form the achievement information in the signed credential. The optional Category is a workspace
label only; include it in the name or description if it must be signed and visible to verifiers.

After creation, the issuance form filters the Achievement list to those linked to the selected
Event. The server also checks that a linked Achievement belongs to the event selected for the
batch.

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
there are no more than 1,000 data rows. Individual row values are validated by the server while
processing. A CSV can therefore load into the review list and still produce failed rows (for
example, a blank name, malformed email, oversized external ID, or unsupported extra field).
Unknown columns are rejected by the strict row schema. Fix the source file and review the batch
outcome rather than assuming that a successful import means issuance succeeded.

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
2. Keep the browser open while the progress message advances. The browser sends the batch in
   sequential groups of up to 50 rows; each row is validated, signed, and persisted independently.
3. Wait for the final success/error message and allow the dashboard to refresh.
4. Check **Recent batches** for processed, succeeded, and failed counts. A skipped duplicate is
   included in successful processing; it is not a newly created credential.
5. Check **Recent credentials** and verify representative credentials through their share page
   or the public verification route.
6. Reconcile `processed`, `succeeded`, and `failed` counts against the source list. Do not
   distribute credentials if counts do not reconcile.

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

If an issuance request fails before the email phase, a later **Retry failed rows** action only
retries issuance rows; it does **not** send or resend emails. The current participant workflow
does not provide a separate credential-email resend control. If email status is uncertain, do not
send duplicate messages manually until the owner/operator has reconciled provider and application
records.

## 9. Failed, interrupted, or partial batches

### Persisted failed rows

If the batch completed with failed rows:

1. Review the count in **Recent batches** and preserve the original source list securely.
2. Correct the source data or resolve the configuration issue.
3. Use **Retry failed rows** for that batch. The server retries persisted failed rows, at most 50
   per retry request.
4. If failures remain, repeat **Retry failed rows**; each click processes at most 50 persisted
   failed rows.
5. Refresh and verify that the failed count is resolved. Retry does not create a new batch and
   does not send emails.

Common causes include invalid row values, missing Achievement criteria, a missing/mismatched
signing key, or a request/provider failure. Do not put recipient data or raw provider errors in
support tickets.

### Browser closed, network interruption, or uncertain result

The UI sends rows in chunks from browser memory. The server records only rows that have already
been submitted. Therefore:

- rows already persisted remain in the batch and are protected by a stable row idempotency key;
- persisted rows with status `failed` can be retried from **Recent batches**;
- rows in later chunks that were never sent are not stored in the batch and cannot be recovered by
  **Retry failed rows**; and
- the current dashboard lists only the 10 most recent batches and has no row-level batch detail to
  prove exactly which source rows were submitted, nor a durable upload/resume workflow for the
  unsent portion. It lists only the 20 most recent credentials, so it is not a complete
  reconciliation report for large batches.

If the browser closes or the network fails mid-batch, stop and do not blindly issue the whole CSV
again. Preserve the original CSV in its approved secure location, refresh the dashboard, compare
the batch counts and existing credentials, and have an authorized issuer/operator reconcile the
already-issued recipients before submitting any remaining rows. Using `skip` can prevent another
active credential for an already-issued recipient/Achievement, but it does not resend email for
the skipped credential. If the rows cannot be reliably reconciled from the available UI, pause the
run and request an audited operator review.

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

## Known product gaps and engineering follow-up

These are limitations of the current implementation, not operator configuration mistakes:

| Gap | Current impact | Required follow-up before relying on the capability at scale |
|---|---|---|
| Serial suffix overflow | The current six-character `lpad` can truncate larger numbers; no boundary guard or seven-digit test exists. | Use variable-width padding or a safe hard limit and add pgTAP tests before crossing the boundary. |
| Non-durable client chunking | Rows not yet submitted from browser memory are lost if the tab closes or the connection fails. | Persist the full validated batch before processing and make server-side progress/resume authoritative. |
| Limited batch observability | The UI exposes aggregate counts for only the most recent 10 batches, no row-level outcomes, and only the most recent 20 credentials. | Add searchable batch detail with per-row status, sanitized failure codes, and pagination before using the UI as the sole reconciliation record. |
| No credential-email resend action | Retrying failed issuance rows does not retry/resend email; skipped duplicates do not trigger a new email. | Add a separate authorized, idempotent email resend flow and show provider state without treating acceptance as delivery. |
| Event-level prefix only | One serial prefix is shared by all Achievements for an Event; the suffix uses an organization-wide counter. | If category-specific formats or counters are required, decide their uniqueness/reset semantics before extending the schema. |
| No event edit UI | Operators cannot correct event details or prefix from the workspace after creation. | Add an audited edit/archive workflow with rules for already-issued credentials, or keep the current create-only constraint explicit. |

Do not treat these follow-ups as implemented merely because the operator can work around them
manually. Any batch reconciliation or correction outside the visible workspace must be performed
by an authorized operator under an approved, auditable procedure.

## Implementation references

This guide is written against the implementation below. Recheck it when these files change:

- [Admin workspace](../src/Admin.tsx) — event/Achievement forms, CSV review, duplicate/visibility
  state, 50-row chunking, recent-list limits, and email invocation.
- [Issue-batch Edge Function](../supabase/functions/issue-batch/index.ts) — role enforcement,
  request limits, date parsing, row validation, row retry, and credential persistence.
- [Issuance row schema](../supabase/functions/_shared/issuance-row.ts) — allowed row fields,
  lengths, email normalization, and whitespace normalization.
- [Initial credential schema and persistence RPC](../supabase/migrations/20261124133357_initial_credential_schema.sql)
  — recipient matching, duplicate semantics, and serial allocation.
- [Event participant migration](../supabase/migrations/20261127001000_event_participant_fields.sql)
  — event prefix validation/formatting and external-ID synchronization/anonymization.
- [Credential/RLS pgTAP tests](../supabase/tests/credential_hub_rls.sql) — current database
  coverage. It does not yet test the serial overflow boundary.
