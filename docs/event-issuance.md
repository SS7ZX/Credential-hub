# Creating events and issuing participant credentials

## Set up an event

In the issuer workspace, create an Event with its name, date, location, and description. These fields organize the issuer workspace; the signed Open Badges credential uses the selected Achievement's name, description, and criteria.

Optionally set a credential serial prefix such as `CTF/HIMASTI/001`. Prefixes:

- are normalized to uppercase;
- may contain 1–4 slash-separated segments using letters, numbers, `.`, `_`, or `-`;
- must be unique across events;
- are applied when a credential is issued, producing values such as `CTF/HIMASTI/001/000123`.

The final numeric suffix comes from the organization's existing atomic serial counter, so it remains unique and does not reset for each event. The current workspace sets this prefix when creating the event; it does not yet include an event-edit control. Do not put a participant's NIM, NIK, email, or other identifying value in a public serial.

## Configure a category

Create an Achievement linked to the Event for each certificate category, for example “Seminar A — Participant” and “Seminar A — Speaker.” Give it a public-facing name, description, and criteria narrative. The optional Category field is an internal grouping label; include wording in the Achievement name/description if it must appear in the signed credential.

Issue one batch per selected Achievement/category. The event and achievement must match.

## Add participants

Choose the Event and category, then add people individually or import a CSV. Manual entry and CSV import use the same staged list; importing a CSV replaces the current list.

CSV headers:

```csv
full_name,email,external_id,issued_on,expires_on
Example Recipient,recipient@example.test,NIM-001,2026-11-27,
```

`full_name` and `email` are required. `external_id`, `issued_on`, and `expires_on` are optional. Emails are trimmed and lowercased; names and IDs have repeated whitespace collapsed. A batch supports at most 1,000 recipients and is processed in chunks of 50.

The optional participant ID is stored privately as a recipient external ID and is not included in the VC-JWT or public credential projection. Anonymizing a recipient clears it and redacts issuance-row input data. Do not use this field for NIK or other sensitive official identifiers unless there is a specific legal and operational need.

Review the staged name, ID, and email list before issuing. Duplicate handling defaults to Skip and can be changed for the batch. Credential email sending is opt-in and uses the server-side `send-emails` Edge Function; the organization daily limit still applies. Recipient name display on the public credential is handled separately through the consent link.

## Data flow summary

```text
Organization → Event → Achievement/category → Issuance batch → Recipients + credentials
```

Event serial formatting and the existing sequence allocation happen within the database credential-persistence transaction. External IDs are copied from a successfully persisted issuance row to the private recipient record by a database trigger in that same transaction; an anonymization trigger clears them when anonymization completes.
