begin;

create extension if not exists pgtap;
select no_plan();

-- Fixed identities make request.jwt.claims deterministic for role-switch tests.
insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
    ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-a@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'viewer-a@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'issuer-a@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'admin-a@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'owner-b@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('10000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'new-member@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, slug, created_by)
values
    ('20000000-0000-0000-0000-000000000001', 'Org A', 'org-a', '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000002', 'Org B', 'org-b', '10000000-0000-0000-0000-000000000005');

insert into public.organization_members (organization_id, user_id, role)
values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'viewer'),
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'issuer'),
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'admin'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 'owner');

insert into public.events (id, organization_id, name)
values
    ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Event A'),
    ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Event B');

insert into public.achievements (id, organization_id, event_id, name, description)
values
    ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Achievement A', 'A'),
    ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Achievement B', 'B');

insert into public.certificate_templates (id, organization_id, name)
values
    ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Template A'),
    ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Template B');

insert into public.issuer_keys (id, organization_id, kid, algorithm, public_jwk)
values
    ('51000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'key-a', 'EdDSA', '{}'),
    ('51000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'key-b', 'EdDSA', '{}');

insert into public.recipients (id, organization_id, full_name, email, email_hash, salt)
values
    ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Recipient A', 'recipient-a@test.invalid', 'hash-a', 'salt-a'),
    ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Recipient B', 'recipient-b@test.invalid', 'hash-b', 'salt-b');

insert into public.issuance_batches (
    id, organization_id, event_id, achievement_id, created_by, total
)
values
    ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 10),
    ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 10);

insert into public.credentials (
    id, organization_id, batch_id, achievement_id, recipient_id,
    status, serial_number, issued_at, credential_json, jws, kid
)
values
    ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'issued', 'TSQ-A-000001', now(), '{}', 'test-a', 'key-a'),
    ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'revoked', 'TSQ-B-000001', now(), '{}', 'test-b', 'key-b');

insert into public.issuance_rows (
    id, organization_id, batch_id, row_number, payload, idempotency_key,
    status, credential_id
)
values
    ('71000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, '{}', 'row-a', 'succeeded', '80000000-0000-0000-0000-000000000001'),
    ('71000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 1, '{}', 'row-b', 'succeeded', '80000000-0000-0000-0000-000000000002');

insert into public.status_lists (organization_id, revoked_credential_ids)
values
    ('20000000-0000-0000-0000-000000000001', '[]'),
    ('20000000-0000-0000-0000-000000000002', '["80000000-0000-0000-0000-000000000002"]');

insert into public.revocations (organization_id, credential_id, reason, revoked_by)
values ('20000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 'Test revocation', '10000000-0000-0000-0000-000000000005');

insert into public.email_events (organization_id, credential_id, type)
values
    ('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'sent'),
    ('20000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 'sent');

insert into public.verification_events (organization_id, credential_id, method, result)
values
    ('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'id', 'valid'),
    ('20000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 'id', 'revoked');

insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id)
values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fixture', 'organization', '20000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', 'fixture', 'organization', '20000000-0000-0000-0000-000000000002');

-- Tenant reads: each organization-scoped relation must hide Org B from Org A's viewer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is((select count(*)::int from public.organizations where id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another organization');
select is((select count(*)::int from public.organization_members where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant membership');
select is((select count(*)::int from public.issuer_keys where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant key');
select is((select count(*)::int from public.events where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant event');
select is((select count(*)::int from public.achievements where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant achievement');
select is((select count(*)::int from public.certificate_templates where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant template');
select is((select count(*)::int from public.recipients where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant recipient');
select is((select count(*)::int from public.issuance_batches where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant batch');
select is((select count(*)::int from public.issuance_rows where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant issuance row');
select is((select count(*)::int from public.credentials where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant credential');
select is((select count(*)::int from public.status_lists where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant status list');
select is((select count(*)::int from public.revocations where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant revocation');
select is((select count(*)::int from public.email_events where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant email event');
select is((select count(*)::int from public.verification_events where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant verification event');
select is((select count(*)::int from public.audit_logs where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot select another tenant audit record');

select is((select count(*)::int from public.organizations where id = '20000000-0000-0000-0000-000000000001'), 1, 'viewer can read own organization');
select is((select count(*)::int from public.events where organization_id = '20000000-0000-0000-0000-000000000001'), 1, 'viewer can read own organization events');
select throws_ok(
    $$insert into public.events(organization_id, name) values ('20000000-0000-0000-0000-000000000001', 'Viewer event')$$,
    '42501', null, 'viewer cannot create events'
);
select throws_ok(
    $$insert into public.issuance_batches(organization_id, event_id, achievement_id, created_by)
      values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')$$,
    '42501', null, 'viewer cannot create batches'
);
select throws_ok(
    $$insert into public.issuance_batches(organization_id, event_id, achievement_id, created_by)
      values ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002')$$,
    '42501', null, 'viewer cannot insert a batch in another tenant'
);
select throws_ok(
    $$insert into public.organization_members(organization_id, user_id, role)
      values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000006', 'viewer')$$,
    '42501', null, 'viewer cannot insert another tenant membership'
);
select throws_ok(
    $$insert into public.issuer_keys(organization_id, kid, algorithm, public_jwk)
      values ('20000000-0000-0000-0000-000000000002', 'viewer-key', 'EdDSA', '{}')$$,
    '42501', null, 'viewer cannot insert another tenant key'
);
select throws_ok(
    $$insert into public.events(organization_id, name)
      values ('20000000-0000-0000-0000-000000000002', 'Viewer event B')$$,
    '42501', null, 'viewer cannot insert another tenant event'
);
select throws_ok(
    $$insert into public.achievements(organization_id, name, description)
      values ('20000000-0000-0000-0000-000000000002', 'Viewer achievement B', 'B')$$,
    '42501', null, 'viewer cannot insert another tenant achievement'
);
select throws_ok(
    $$insert into public.certificate_templates(organization_id, name)
      values ('20000000-0000-0000-0000-000000000002', 'Viewer template B')$$,
    '42501', null, 'viewer cannot insert another tenant template'
);
select throws_ok(
    $$insert into public.recipients(organization_id, full_name, email)
      values ('20000000-0000-0000-0000-000000000002', 'Viewer B', 'viewer-b@test.invalid')$$,
    '42501', null, 'viewer cannot insert another tenant recipient'
);
select ok(
    not has_table_privilege('authenticated', 'public.credentials', 'INSERT')
    and not has_table_privilege('authenticated', 'public.issuance_rows', 'INSERT')
    and not has_table_privilege('authenticated', 'public.status_lists', 'INSERT')
    and not has_table_privilege('authenticated', 'public.revocations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.email_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.verification_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'),
    'authenticated clients cannot directly insert issuance results, status, events, or audit rows'
);
select ok(
    not has_table_privilege('authenticated', 'public.issuance_rows', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.credentials', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.status_lists', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.revocations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.email_events', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.verification_events', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE'),
    'authenticated clients cannot directly update issuance results, status, events, or audit rows'
);
select ok(
    not has_table_privilege('authenticated', 'public.organizations', 'DELETE')
    and not has_table_privilege('authenticated', 'public.issuer_keys', 'DELETE')
    and not has_table_privilege('authenticated', 'public.events', 'DELETE')
    and not has_table_privilege('authenticated', 'public.achievements', 'DELETE')
    and not has_table_privilege('authenticated', 'public.certificate_templates', 'DELETE')
    and not has_table_privilege('authenticated', 'public.recipients', 'DELETE')
    and not has_table_privilege('authenticated', 'public.issuance_batches', 'DELETE')
    and not has_table_privilege('authenticated', 'public.issuance_rows', 'DELETE')
    and not has_table_privilege('authenticated', 'public.credentials', 'DELETE')
    and not has_table_privilege('authenticated', 'public.status_lists', 'DELETE')
    and not has_table_privilege('authenticated', 'public.revocations', 'DELETE')
    and not has_table_privilege('authenticated', 'public.email_events', 'DELETE')
    and not has_table_privilege('authenticated', 'public.verification_events', 'DELETE')
    and not has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'),
    'authenticated clients cannot directly delete tenant data'
);
select throws_ok(
    $$insert into public.organizations(name, slug, created_by)
      values ('Viewer Org', 'viewer-org', '10000000-0000-0000-0000-000000000002')$$,
    '42501', null, 'viewer cannot insert organizations'
);
select throws_ok(
    $$insert into public.credentials(organization_id, serial_number)
      values ('20000000-0000-0000-0000-000000000002', 'VIEWER-CREDENTIAL')$$,
    '42501', null, 'viewer cannot insert credential rows directly'
);
select throws_ok(
    $$update public.credentials set status = 'revoked'
      where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot update credential rows directly'
);
select throws_ok(
    $$delete from public.credentials where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot delete credential rows directly'
);
select throws_ok(
    $$insert into public.issuance_rows(organization_id, batch_id, row_number, payload, idempotency_key)
      values ('20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 5, '{}', 'viewer-direct-row')$$,
    '42501', null, 'viewer cannot insert issuance rows directly'
);
select throws_ok(
    $$update public.issuance_rows set status = 'failed'
      where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot update issuance rows directly'
);
select throws_ok(
    $$delete from public.issuance_rows where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot delete issuance rows directly'
);
select throws_ok(
    $$insert into public.status_lists(organization_id)
      values ('20000000-0000-0000-0000-000000000002')$$,
    '42501', null, 'viewer cannot insert status lists directly'
);
select throws_ok(
    $$update public.status_lists set revoked_credential_ids = '[]'
      where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot update status lists directly'
);
select throws_ok(
    $$delete from public.status_lists where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot delete status lists directly'
);
select throws_ok(
    $$insert into public.revocations(organization_id, credential_id, reason)
      values ('20000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 'viewer')$$,
    '42501', null, 'viewer cannot insert revocations directly'
);
select throws_ok(
    $$update public.revocations set reason = 'tampered'
      where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot update revocations directly'
);
select throws_ok(
    $$delete from public.revocations where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot delete revocations directly'
);
select throws_ok(
    $$insert into public.email_events(organization_id, type)
      values ('20000000-0000-0000-0000-000000000002', 'sent')$$,
    '42501', null, 'viewer cannot insert email events directly'
);
select throws_ok(
    $$update public.email_events set type = 'tampered'
      where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot update email events directly'
);
select throws_ok(
    $$delete from public.email_events where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot delete email events directly'
);
select throws_ok(
    $$insert into public.verification_events(organization_id, method, result)
      values ('20000000-0000-0000-0000-000000000002', 'id', 'valid')$$,
    '42501', null, 'viewer cannot insert verification events directly'
);
select throws_ok(
    $$update public.verification_events set result = 'tampered'
      where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot update verification events directly'
);
select throws_ok(
    $$delete from public.verification_events where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot delete verification events directly'
);
select throws_ok(
    $$insert into public.audit_logs(organization_id, action, entity_type)
      values ('20000000-0000-0000-0000-000000000002', 'viewer', 'test')$$,
    '42501', null, 'viewer cannot insert audit rows directly'
);
select throws_ok(
    $$update public.audit_logs set action = 'tampered'
      where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot update audit rows directly'
);
select throws_ok(
    $$delete from public.audit_logs where organization_id = '20000000-0000-0000-0000-000000000002'$$,
    '42501', null, 'viewer cannot delete audit rows directly'
);
select throws_ok(
    $$select public.allocate_serial('20000000-0000-0000-0000-000000000001')$$,
    'P0001', 'Insufficient organization role', 'viewer cannot allocate serials'
);
select throws_ok(
    $$select public.revoke_credential('80000000-0000-0000-0000-000000000001', 'test')$$,
    'P0001', 'Insufficient organization role', 'viewer cannot revoke credentials'
);
select throws_ok(
    $$select public.persist_issuance_row(
        '70000000-0000-0000-0000-000000000001',
        2, '{"email":"viewer@test.invalid"}', 'viewer-row-unique',
        'Viewer Recipient', 'viewer@test.invalid', 'hash-viewer', 'salt-viewer',
        false, 'skip', '81000000-0000-0000-0000-000000000002',
        'TSQ-2026-000010', now(), null, 'unlisted', '{}',
        'viewer-test-jws', 'key-a', 'hash-viewer-content', null
    )$$,
    'P0001', 'Insufficient organization role', 'viewer cannot persist credentials'
);
reset role;

-- Org A rows are not writable through policies, even if a member knows Org B IDs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$update public.organizations set name = 'stolen' where id = '20000000-0000-0000-0000-000000000002'$$, 'viewer update attempt on another organization is filtered');
select is((select name from public.organizations where id = '20000000-0000-0000-0000-000000000002'), null, 'viewer still cannot read or change another organization');
select throws_ok($$delete from public.organizations where id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'viewer cannot delete organizations');
select lives_ok($$update public.events set name = 'viewer-stolen' where id = '30000000-0000-0000-0000-000000000001'$$, 'viewer cannot update even own organization events');
select throws_ok($$delete from public.events where id = '30000000-0000-0000-0000-000000000001'$$, '42501', null, 'viewer cannot delete own organization events');
select lives_ok($$update public.organization_members set role = 'owner' where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer membership update attempt is filtered');
select is((select count(*)::int from public.organization_members where organization_id = '20000000-0000-0000-0000-000000000002'), 0, 'viewer cannot read or change another tenant membership');
select lives_ok($$delete from public.organization_members where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer membership delete attempt is filtered');
select lives_ok($$update public.issuer_keys set status = 'retired' where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer key update attempt is filtered');
select throws_ok($$delete from public.issuer_keys where organization_id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'viewer cannot delete keys');
select lives_ok($$update public.events set name = 'stolen' where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer event update attempt is filtered');
select is((select name from public.events where id = '30000000-0000-0000-0000-000000000002'), null, 'viewer cannot read or change another tenant event');
select throws_ok($$delete from public.events where organization_id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'viewer cannot delete events');
select lives_ok($$update public.achievements set name = 'stolen' where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer achievement update attempt is filtered');
select is((select name from public.achievements where id = '40000000-0000-0000-0000-000000000002'), null, 'viewer cannot read or change another tenant achievement');
select throws_ok($$delete from public.achievements where organization_id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'viewer cannot delete achievements');
select lives_ok($$update public.certificate_templates set name = 'stolen' where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer template update attempt is filtered');
select is((select name from public.certificate_templates where id = '50000000-0000-0000-0000-000000000002'), null, 'viewer cannot read or change another tenant template');
select throws_ok($$delete from public.certificate_templates where organization_id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'viewer cannot delete templates');
select lives_ok($$update public.recipients set full_name = 'stolen' where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer recipient update attempt is filtered');
select is((select full_name from public.recipients where id = '60000000-0000-0000-0000-000000000002'), null, 'viewer cannot read or change another tenant recipient');
select throws_ok($$delete from public.recipients where organization_id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'viewer cannot delete recipients');
select lives_ok($$update public.issuance_batches set status = 'failed' where organization_id = '20000000-0000-0000-0000-000000000002'$$, 'viewer batch update attempt is filtered');
select is((select count(*)::int from public.issuance_batches where id = '70000000-0000-0000-0000-000000000002'), 0, 'viewer cannot read another tenant batch after update attempt');
select throws_ok($$delete from public.issuance_batches where organization_id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'viewer cannot delete batches');
reset role;

select is((select name from public.organizations where id = '20000000-0000-0000-0000-000000000002'), 'Org B', 'another tenant organization remains unchanged');
select is((select name from public.events where id = '30000000-0000-0000-0000-000000000001'), 'Event A', 'viewer cannot update an event in own organization');
select is((select role::text from public.organization_members where organization_id = '20000000-0000-0000-0000-000000000002'), 'owner', 'another tenant membership remains unchanged');
select is((select status::text from public.issuer_keys where organization_id = '20000000-0000-0000-0000-000000000002'), 'active', 'another tenant key remains unchanged');
select is((select name from public.events where id = '30000000-0000-0000-0000-000000000002'), 'Event B', 'another tenant event remains unchanged');
select is((select name from public.achievements where id = '40000000-0000-0000-0000-000000000002'), 'Achievement B', 'another tenant achievement remains unchanged');
select is((select name from public.certificate_templates where id = '50000000-0000-0000-0000-000000000002'), 'Template B', 'another tenant template remains unchanged');
select is((select full_name from public.recipients where id = '60000000-0000-0000-0000-000000000002'), 'Recipient B', 'another tenant recipient remains unchanged');
select is((select status::text from public.issuance_batches where id = '70000000-0000-0000-0000-000000000002'), 'draft', 'another tenant batch remains unchanged');

-- Issuer may create batches and persist credentials but may not revoke.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok(
    $$insert into public.issuance_batches(organization_id, event_id, achievement_id, created_by, total)
      values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 1)$$,
    'issuer can create a batch'
);
select lives_ok(
    $$select public.persist_issuance_row(
        (select id from public.issuance_batches where organization_id = '20000000-0000-0000-0000-000000000001' and created_by = '10000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
        1, '{"email":"new@test.invalid"}', 'issuer-row-unique',
        'New Recipient', 'new@test.invalid', 'hash-new', 'salt-new', false, 'skip',
        '81000000-0000-0000-0000-000000000001', 'TSQ-2026-000009', now(), null,
        'unlisted', '{}', 'issuer-test-jws', 'key-a', 'hash-content', null
    )$$,
    'issuer can persist an issued credential through the atomic RPC'
);
select throws_ok(
    $$select public.revoke_credential('80000000-0000-0000-0000-000000000001', 'issuer attempt')$$,
    'P0001', 'Insufficient organization role', 'issuer cannot revoke'
);
select throws_ok(
    $$select public.anonymize_recipient('60000000-0000-0000-0000-000000000001')$$,
    'P0001', 'Insufficient organization role', 'issuer cannot anonymize recipients'
);
reset role;

-- Admin can revoke; owner can manage organization members.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
    $$select public.revoke_credential('80000000-0000-0000-0000-000000000001', 'admin test revocation')$$,
    'admin can revoke credentials'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
    $$insert into public.organization_members(organization_id, user_id, role)
      values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'viewer')$$,
    'owner can add organization members'
);
select lives_ok(
    $$delete from public.organization_members
      where organization_id = '20000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-000000000006'$$,
    'owner can remove organization members'
);
reset role;

-- Anonymous users have no table privileges or RPC execution privileges.
select ok(
    not exists (
        select 1
        from information_schema.tables t
        cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
        where t.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and has_table_privilege('anon', format('%I.%I', t.table_schema, t.table_name), p.privilege)
    ),
    'anon has no SELECT/INSERT/UPDATE/DELETE privilege on any public table'
);
select ok(
    not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.prosecdef
          and has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    'anon cannot execute SECURITY DEFINER functions'
);

-- Every SECURITY DEFINER function has a pinned search_path.
select ok(
    not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.prosecdef
          and array_to_string(coalesce(p.proconfig, '{}'), ',') not like '%search_path=%'
    ),
    'all application SECURITY DEFINER functions pin search_path'
);

-- Even service_role and the table owner cannot mutate append-only audit rows.
set local role service_role;
select throws_ok(
    $$update public.audit_logs set action = 'tampered' where organization_id = '20000000-0000-0000-0000-000000000001'$$,
    'P0001', 'audit_logs is append-only', 'service_role cannot update audit logs'
);
select throws_ok(
    $$delete from public.audit_logs where organization_id = '20000000-0000-0000-0000-000000000001'$$,
    'P0001', 'audit_logs is append-only', 'service_role cannot delete audit logs'
);
reset role;
set local role postgres;
select throws_ok(
    $$update public.audit_logs set action = 'tampered' where organization_id = '20000000-0000-0000-0000-000000000001'$$,
    'P0001', 'audit_logs is append-only', 'table owner cannot update audit logs'
);
select throws_ok(
    $$delete from public.audit_logs where organization_id = '20000000-0000-0000-0000-000000000001'$$,
    'P0001', 'audit_logs is append-only', 'table owner cannot delete audit logs'
);
reset role;

-- Cross-tenant references must fail even for a privileged database writer.
select throws_ok(
    $$insert into public.issuance_batches(organization_id, event_id, achievement_id, created_by)
      values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$$,
    '23503', null, 'batch cannot reference another tenant achievement'
);
select throws_ok(
    $$insert into public.issuance_batches(organization_id, event_id, achievement_id, created_by)
      values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
    '23503', null, 'batch cannot reference another tenant event'
);
select throws_ok(
    $$insert into public.credentials(organization_id, achievement_id, serial_number)
      values ('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'CROSS-ACH')$$,
    '23503', null, 'credential cannot reference another tenant achievement'
);
select throws_ok(
    $$insert into public.credentials(organization_id, recipient_id, serial_number)
      values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'CROSS-RECIPIENT')$$,
    '23503', null, 'credential cannot reference another tenant recipient'
);
select throws_ok(
    $$insert into public.credentials(organization_id, batch_id, serial_number)
      values ('20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'CROSS-BATCH')$$,
    '23503', null, 'credential cannot reference another tenant batch'
);
select throws_ok(
    $$insert into public.issuance_rows(organization_id, batch_id, row_number, payload, idempotency_key)
      values ('20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 99, '{}', 'cross-tenant-row')$$,
    '23503', null, 'issuance row cannot reference another tenant batch'
);
select throws_ok(
    $$insert into public.revocations(organization_id, credential_id, reason)
      values ('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'cross tenant')$$,
    '23503', null, 'revocation cannot reference another tenant credential'
);
select throws_ok(
    $$insert into public.email_events(organization_id, credential_id, type)
      values ('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'sent')$$,
    '23503', null, 'email event cannot reference another tenant credential'
);
select throws_ok(
    $$insert into public.verification_events(organization_id, credential_id, method, result)
      values ('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'id', 'valid')$$,
    '23503', null, 'verification event cannot reference another tenant credential'
);

select * from finish();
rollback;
