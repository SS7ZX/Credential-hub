begin;

create extension if not exists pgtap;
select no_plan();

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
    '13000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'download-owner@test.invalid', '',
    now(), '{}', '{}', now(), now()
);

insert into public.organizations (id, name, slug, did, created_by)
values (
    '23000000-0000-0000-0000-000000000001',
    'Download Test Org', 'download-test-org', 'did:web:download.example',
    '13000000-0000-0000-0000-000000000001'
);
insert into public.organization_members (organization_id, user_id, role)
values (
    '23000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001', 'owner'
);
insert into public.issuer_keys (id, organization_id, kid, algorithm, public_jwk)
values (
    '53000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001',
    'download-key', 'EdDSA', '{}'
);
insert into public.events (id, organization_id, name)
values (
    '33000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001', 'Download Event'
);
insert into public.achievements (id, organization_id, event_id, name, description)
values (
    '43000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000001', 'Download Achievement', 'Test'
);
insert into public.recipients (id, organization_id, full_name, email, email_hash, salt)
values
    ('63000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Active Recipient', 'active-download@test.invalid', 'hash-active', 'salt-active'),
    ('63000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', 'Pending Recipient', 'pending-download@test.invalid', 'hash-pending', 'salt-pending'),
    ('63000000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000001', 'Anonymized Recipient', 'done-download@test.invalid', 'hash-done', 'salt-done');
insert into public.issuance_batches (
    id, organization_id, event_id, achievement_id, created_by, total
)
values (
    '73000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000001',
    '43000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001', 3
);
insert into public.credentials (
    id, organization_id, batch_id, achievement_id, recipient_id,
    status, serial_number, issued_at, credential_json, jws, kid
)
values
    ('83000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', 'issued', 'DOWNLOAD-0001', now(), '{}', 'test-1', 'download-key'),
    ('83000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000002', 'issued', 'DOWNLOAD-0002', now(), '{}', 'test-2', 'download-key'),
    ('83000000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000003', 'issued', 'DOWNLOAD-0003', now(), '{}', 'test-3', 'download-key');
insert into public.stamp_runs (
    id, organization_id, achievement_id, drive_folder_id, idempotency_key,
    created_by, status, expected_file_count, processed_count, succeeded_count
)
values (
    '93000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001',
    '43000000-0000-0000-0000-000000000001',
    'folder_abcdef1234', repeat('a', 64),
    '13000000-0000-0000-0000-000000000001',
    'completed', 3, 3, 3
);
insert into public.stamp_files (
    id, organization_id, stamp_run_id, credential_id, recipient_id, drive_file_id,
    output_sha256, storage_path, status, completed_at
)
values
    ('a3000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', 'active_file_123', repeat('b', 64), '23000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000001/a3000000-0000-0000-0000-000000000001.pdf', 'completed', now()),
    ('a3000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000002', 'pending_file_123', repeat('c', 64), '23000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000001/a3000000-0000-0000-0000-000000000002.pdf', 'completed', now()),
    ('a3000000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000003', '63000000-0000-0000-0000-000000000003', 'done_file_123', repeat('d', 64), '23000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000001/a3000000-0000-0000-0000-000000000003.pdf', 'completed', now());

update public.recipients
set anonymization_requested_at = now()
where id = '63000000-0000-0000-0000-000000000002';
update public.recipients
set full_name = null,
    email = null,
    email_hash = null,
    salt = null,
    anonymized_at = now()
where id = '63000000-0000-0000-0000-000000000003';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
    public.get_stamp_file_download_path(
      '23000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001'
    ),
    '23000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000001/a3000000-0000-0000-0000-000000000001.pdf',
    'active recipient can obtain a signed-download path'
);
select is(
    public.get_stamp_file_download_path(
      '23000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000002'
    ),
    null::text,
    'pending anonymization cannot obtain a signed-download path'
);
select is(
    public.get_stamp_file_download_path(
      '23000000-0000-0000-0000-000000000001',
      '93000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000003'
    ),
    null::text,
    'completed anonymization cannot obtain a signed-download path'
);
select is(
    (select array_agg(id order by id)
     from public.list_visible_stamp_run_files(
       '23000000-0000-0000-0000-000000000001',
       '93000000-0000-0000-0000-000000000001'
     )),
    array['a3000000-0000-0000-0000-000000000001'::uuid],
    'run status omits files for pending and anonymized recipients'
);
reset role;

select * from finish();
rollback;
