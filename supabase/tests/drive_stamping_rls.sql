begin;

create extension if not exists pgtap;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
    ('11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'stamp-owner-a@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('11000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'stamp-issuer-a@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('11000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'stamp-viewer-a@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('11000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'stamp-owner-b@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, slug, did, created_by)
values
    ('21000000-0000-0000-0000-000000000001', 'Stamp Org A', 'stamp-org-a', 'did:web:example.test', '11000000-0000-0000-0000-000000000001'),
    ('21000000-0000-0000-0000-000000000002', 'Stamp Org B', 'stamp-org-b', 'did:web:example.test', '11000000-0000-0000-0000-000000000004');

insert into public.organization_members (organization_id, user_id, role)
values
    ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'owner'),
    ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'issuer'),
    ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000003', 'viewer'),
    ('21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004', 'owner');

insert into public.issuer_keys (id, organization_id, kid, algorithm, public_jwk)
values
    ('52000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'stamp-key-a', 'EdDSA', '{}'),
    ('52000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'stamp-key-b', 'EdDSA', '{}');
update public.issuer_keys
set status = 'retired'
where kid = 'stamp-key-b';
select is(
    (select array_agg(kid order by kid)
     from public.issuer_keys
     where status in ('active', 'retired')),
    array['stamp-key-a', 'stamp-key-b']::text[],
    'issuer discovery keeps active and retired public keys available'
);

insert into public.events (id, organization_id, name)
values
    ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Stamp Event A'),
    ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'Stamp Event B');

insert into public.achievements (id, organization_id, event_id, name, description)
values
    ('41000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Stamp Achievement A', 'A'),
    ('41000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Unissued Achievement A', 'No issued credentials'),
    ('41000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002', 'Stamp Achievement B', 'B');

insert into public.recipients (id, organization_id, full_name, email, email_hash, salt)
values
    ('61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Stamp Recipient A', 'stamp-recipient-a@test.invalid', 'hash-stamp-a', 'salt-stamp-a'),
    ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'Stamp Recipient B', 'stamp-recipient-b@test.invalid', 'hash-stamp-b', 'salt-stamp-b');

insert into public.issuance_batches (
    id, organization_id, event_id, achievement_id, created_by, total
)
values
    ('71000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 1),
    ('71000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004', 1);

update public.issuance_batches
set source_filename = 'Stamp Recipient A stamp-recipient-a@test.invalid.csv'
where id = '71000000-0000-0000-0000-000000000001';
select is(
    (select source_filename from public.issuance_batches
     where id = '71000000-0000-0000-0000-000000000001'),
    null::text,
    'issuance source filenames are discarded instead of retained'
);

insert into public.credentials (
    id, organization_id, batch_id, achievement_id, recipient_id,
    status, serial_number, issued_at, credential_json, jws, kid
)
values
    ('81000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'issued', 'STAMP-A-000001', now(), '{}', 'test-stamp-a', 'stamp-key-a'),
    ('81000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 'issued', 'STAMP-B-000001', now(), '{}', 'test-stamp-b', 'stamp-key-b');

insert into public.verification_events (
    id, organization_id, credential_id, method, result, ip_hash
)
values (
    '91000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'qr', 'valid', 'hashed-recipient-ip'
);
insert into public.revocations (organization_id, credential_id, reason)
values (
    '21000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'manual review for Stamp Recipient A at stamp-recipient-a@test.invalid'
);
insert into public.audit_logs (
    id, organization_id, action, entity_type, entity_id, metadata
)
values (
    '92000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'credential.revoked', 'credential', '81000000-0000-0000-0000-000000000001',
    '{"reason":"Stamp Recipient A stamp-recipient-a@test.invalid"}'::jsonb
);

insert into public.status_lists (organization_id, revoked_credential_ids)
values ('21000000-0000-0000-0000-000000000001', '[]');

select is(
    (select public from storage.buckets where id = 'stamped-certificate-pdfs'),
    false,
    'stamped PDF bucket is private'
);
select is(
    (select count(*)::int from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')),
    0,
    'authenticated users have no stamped PDF write policies'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
    $$select * from public.stamp_runs$$,
    '42501', null, 'anonymous users cannot read stamping runs'
);
select throws_ok(
    $$select public.create_stamp_run(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'folder_abcdef1234', 1, repeat('a', 64)
    )$$,
    '42501', null, 'anonymous users cannot start stamping runs'
);
select is(
    (select count(*)::int from storage.objects where bucket_id = 'stamped-certificate-pdfs'),
    0,
    'anonymous users cannot read private stamped PDF objects'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.qr_layouts), 0, 'viewer cannot read QR layouts');
select is((select count(*)::int from public.stamp_runs), 0, 'viewer cannot read stamping runs');
select is((select count(*)::int from public.stamp_files), 0, 'viewer cannot read stamped files');
select throws_ok(
    $$select * from public.list_stampable_credentials(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001'
    )$$,
    '42501', null, 'viewer cannot retrieve stampable recipient credentials'
);
select throws_ok(
    $$insert into public.stamp_runs(
      organization_id, achievement_id, drive_folder_id, idempotency_key, created_by, expected_file_count
    ) values (
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'folder_abcdef1234', repeat('b', 64),
      '11000000-0000-0000-0000-000000000003', 1
    )$$,
    '42501', null, 'viewer cannot directly create a stamp run'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.stamp_runs), 0, 'another tenant owner cannot read stamping runs');
select is((select count(*)::int from public.qr_layouts), 0, 'another tenant owner cannot read QR layouts');
select throws_ok(
    $$select * from public.list_stampable_credentials(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001'
    )$$,
    '42501', null, 'another tenant owner cannot retrieve recipient credentials'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
    $$insert into storage.objects(bucket_id, name, metadata)
      values ('stamped-certificate-pdfs', 'arbitrary/upload.pdf', '{}'::jsonb)$$,
    '42501', null, 'authenticated issuers cannot upload arbitrary stamped PDFs'
);
select lives_ok(
    $$select public.save_qr_layout(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      1, 50, 50, 72, 842, 595, 2
    )$$,
    'issuer can save a per-achievement QR layout'
);
select is(
    (select count(*)::int from public.list_stampable_credentials(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001'
    )),
    1,
    'issuer can retrieve only issued credentials for mapping'
);
select is(
    (select full_name from public.list_stampable_credentials(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001'
    )),
    'Stamp Recipient A',
    'issuer mapping projection includes private recipient name for review'
);
select throws_ok(
    $$select public.save_qr_layout(
      '21000000-0000-0000-0000-000000000002',
      '41000000-0000-0000-0000-000000000002',
      1, 50, 50, 72, 842, 595, 2
    )$$,
    '42501', null, 'issuer cannot save a layout in another tenant'
);
select throws_ok(
    $$select public.save_qr_layout(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      1, 50, 50, 86, 842, 595, 2
    )$$,
    '23514', null, 'layout rejects a QR larger than the approved maximum'
);
select lives_ok(
    $$select public.create_stamp_run(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'folder_abcdef1234', 1, repeat('a', 64)
    )$$,
    'issuer can create a run after credentials have been issued'
);
select is(
    public.create_stamp_run(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'folder_abcdef1234', 1, repeat('a', 64)
    ),
    (select id from public.stamp_runs
     where organization_id = '21000000-0000-0000-0000-000000000001'
       and idempotency_key = repeat('a', 64)),
    'run creation is idempotent'
);
select throws_ok(
    $$select public.create_stamp_run(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'https://googleapis.com/drive', 1, repeat('c', 64)
    )$$,
    'P0001', 'Invalid Drive folder ID', 'folder URL input is rejected'
);
select throws_ok(
    $$select public.create_stamp_run(
      '21000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000003',
      'folder_abcdef1234', 1, repeat('f', 64)
    )$$,
    'P0001', 'Issue credentials before starting a stamping run',
    'stamping refuses achievements without issued credentials'
);
select throws_ok(
    $$select public.create_stamp_run(
      '21000000-0000-0000-0000-000000000002',
      '41000000-0000-0000-0000-000000000002',
      'folder_abcdef1234', 1, repeat('d', 64)
    )$$,
    '42501', null, 'issuer cannot create a run in another tenant'
);

select lives_ok(
    $$select public.register_stamp_file(
      (select id from public.stamp_runs where idempotency_key = repeat('a', 64)),
      '81000000-0000-0000-0000-000000000001',
      'drive_file_12345'
    )$$,
    'issuer can register a file only against its issued credential'
);
select is(
    public.register_stamp_file(
      (select id from public.stamp_runs where idempotency_key = repeat('a', 64)),
      '81000000-0000-0000-0000-000000000001',
      'drive_file_12345'
    ),
    (select id from public.stamp_files where drive_file_id = 'drive_file_12345'),
    'file registration is idempotent'
);
select throws_ok(
    $$select public.register_stamp_file(
      (select id from public.stamp_runs where idempotency_key = repeat('a', 64)),
      '81000000-0000-0000-0000-000000000002',
      'drive_file_other123'
    )$$,
    'P0001', 'Credential is not issued or available for this achievement',
    'file registration rejects credentials from another tenant'
);
select throws_ok(
    $$select public.register_stamp_file(
      (select id from public.stamp_runs where idempotency_key = repeat('a', 64)),
      '81000000-0000-0000-0000-000000000001',
      'drive_file_other123'
    )$$,
    'P0001', 'Credential is already mapped to a different Drive file',
    'one credential cannot be mapped to multiple files in a run'
);
select throws_ok(
    $$select public.approve_stamp_run_review(
      (select id from public.stamp_runs where idempotency_key = repeat('a', 64)),
      '{}'::uuid[], true
    )$$,
    'P0001', 'Review sample must contain the required distinct files',
    'review requires the required number of distinct sample files'
);
select lives_ok(
    $$select public.approve_stamp_run_review(
      (select id from public.stamp_runs where idempotency_key = repeat('a', 64)),
      array[(select id from public.stamp_files where drive_file_id = 'drive_file_12345')],
      true
    )$$,
    'issuer can approve the complete run and required sample'
);
select is(
    (select status::text from public.stamp_runs where idempotency_key = repeat('a', 64)),
    'approved',
    'review approval gates processing'
);
select is(
    public.claim_stamp_file(
      (select id from public.stamp_files where drive_file_id = 'drive_file_12345'),
      repeat('c', 64)
    )
        ->> 'storagePath',
    '21000000-0000-0000-0000-000000000001/'
      || (select id::text from public.stamp_runs where idempotency_key = repeat('a', 64))
      || '/'
      || (select id::text from public.stamp_files where drive_file_id = 'drive_file_12345')
      || '.pdf',
    'claim returns a generated UUID-only Storage path'
);
select throws_ok(
    $$select public.claim_stamp_file(
      (select id from public.stamp_files where drive_file_id = 'drive_file_12345'),
      repeat('c', 64)
    )$$,
    'P0001', 'Stamp file is already processing', 'active file claims cannot run twice'
);
select throws_ok(
    $$select public.fail_stamp_file(
      (select id from public.stamp_files where drive_file_id = 'drive_file_12345'),
      'other'
    )$$,
    'P0001', 'Stamp file has an active processing lease',
    'a failed concurrent request cannot clear another worker active lease'
);
select throws_ok(
    $$select public.complete_stamp_file(
      (select id from public.stamp_files where drive_file_id = 'drive_file_12345'),
      true, repeat('e', 64), null
    )$$,
    'P0001', 'Stamped PDF is not present in private Storage',
    'completion cannot succeed without a private Storage object'
);
select lives_ok(
    $$select public.complete_stamp_file(
      (select id from public.stamp_files where drive_file_id = 'drive_file_12345'),
      false, null, 'other'
    )$$,
    'issuer can record a sanitized processing failure'
);
select is(
    (select status::text from public.stamp_runs where idempotency_key = repeat('a', 64)),
    'completed_with_errors',
    'run state and counters reflect a failed file'
);
select throws_ok(
    $$select public.claim_stamp_file(
      (select id from public.stamp_files where drive_file_id = 'drive_file_12345'),
      repeat('d', 64)
    )$$,
    'P0001', 'Drive PDF changed after the file was registered',
    'retry rejects changed Drive source content'
);

reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
    $$select public.prepare_recipient_anonymization(
      '11000000-0000-0000-0000-000000000002',
      '61000000-0000-0000-0000-000000000001'
    )$$,
    '42501', 'Insufficient organization role',
    'service role cannot prepare anonymization for an issuer actor'
);
select throws_ok(
    $$select public.prepare_recipient_anonymization(
      '11000000-0000-0000-0000-000000000003',
      '61000000-0000-0000-0000-000000000001'
    )$$,
    '42501', 'Insufficient organization role',
    'service role cannot prepare anonymization for a viewer actor'
);
select is(
    array(
      select jsonb_array_elements_text(
        public.prepare_recipient_anonymization(
          '11000000-0000-0000-0000-000000000001',
          '61000000-0000-0000-0000-000000000001'
        )->'storagePaths'
      )
    ),
    array[
      '21000000-0000-0000-0000-000000000001/'
      || (select id::text from public.stamp_runs where idempotency_key = repeat('a', 64))
      || '/'
      || (select id::text from public.stamp_files where drive_file_id = 'drive_file_12345')
      || '.pdf'
    ]::text[],
    'owner-authorized preparation returns only UUID object paths for Storage cleanup'
);
select lives_ok(
    $$select public.complete_recipient_anonymization(
      '11000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001'
    )$$,
    'finalization atomically completes after Storage cleanup'
);
select ok(
    (select full_name is null and email is null and anonymized_at is not null
     from public.recipients where id = '61000000-0000-0000-0000-000000000001'),
    'anonymization clears recipient PII'
);
select ok(
    (select bool_and(status = 'deleted' and drive_file_id is null
        and source_sha256 is null and output_sha256 is null and storage_path is null)
     from public.stamp_files
     where recipient_id = '61000000-0000-0000-0000-000000000001'),
    'anonymization removes stored object references and source identifiers'
);
select is(
    (select status::text from public.credentials where id = '81000000-0000-0000-0000-000000000001'),
    'revoked',
    'anonymization revokes the associated credential'
);
select is(
    (select count(*)::int from public.revocations
     where credential_id = '81000000-0000-0000-0000-000000000001'),
    1,
    'credential ID and revocation evidence are retained'
);
select is(
    (select credential_id from public.verification_events
     where id = '91000000-0000-0000-0000-000000000001'),
    null::uuid,
    'anonymization unlinks verification history from the credential'
);
select is(
    (select ip_hash from public.verification_events
     where id = '91000000-0000-0000-0000-000000000001'),
    null::text,
    'anonymization removes the verification IP hash'
);
select is(
    (select reason from public.revocations
     where credential_id = '81000000-0000-0000-0000-000000000001'),
    'Recipient data anonymized',
    'anonymization replaces free-text revocation reasons'
);
select is(
    (select metadata from public.audit_logs
     where id = '92000000-0000-0000-0000-000000000001'),
    '{"redacted": true}'::jsonb,
    'anonymization redacts PII from append-only credential audit metadata'
);
select ok(
    (select bool_and(not metadata ? 'full_name' and not metadata ? 'email' and not metadata ? 'file_name')
     from public.audit_logs
     where action like 'stamp.%'),
    'stamping audit metadata contains no recipient names, emails, or filenames'
);
reset role;

select * from finish();
rollback;
