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
    ('10000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'new-member@test.invalid', '', now(), '{}', '{}', now(), now()),
    ('10000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'unverified-owner@test.invalid', '', null, '{}', '{}', now(), now()),
    ('10000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'expired-member@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, slug, did, created_by)
values
    ('20000000-0000-0000-0000-000000000001', 'Org A', 'org-a', 'did:web:example.test', '10000000-0000-0000-0000-000000000001'),
    ('20000000-0000-0000-0000-000000000002', 'Org B', 'org-b', 'did:web:example.test', '10000000-0000-0000-0000-000000000005');

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
    ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Recipient B', 'recipient-b@test.invalid', 'hash-b', 'salt-b'),
    ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Recipient A2', 'recipient-a2@test.invalid', 'hash-a2', 'salt-a2');

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
    ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'issued', 'ORG-A-000001', now(), '{}', 'test-a', 'key-a'),
    ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'revoked', 'ORG-B-000001', now(), '{}', 'test-b', 'key-b');

insert into public.issuance_rows (
    id, organization_id, batch_id, row_number, payload, idempotency_key,
    status, credential_id
)
values
    ('71000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, '{"email":"recipient-a@test.invalid","full_name":"Recipient A"}', 'row-a', 'succeeded', '80000000-0000-0000-0000-000000000001'),
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

select throws_ok(
    $$select * from private.credential_name_consent_events$$,
    '42501', null, 'ordinary authenticated users cannot read consent events'
);
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
    not has_table_privilege('authenticated', 'public.organization_invitations', 'SELECT')
    and not has_table_privilege('authenticated', 'public.organization_invitations', 'INSERT')
    and not has_table_privilege('authenticated', 'public.organization_invitations', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.organization_invitations', 'DELETE'),
    'authenticated clients cannot directly access invitation records'
);
select ok(
    not has_table_privilege('authenticated', 'public.email_send_attempts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.email_send_attempts', 'INSERT')
    and not has_table_privilege('authenticated', 'public.email_send_attempts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.email_send_attempts', 'DELETE')
    and
    not has_table_privilege('authenticated', 'public.recipient_access_tokens', 'SELECT')
    and not has_table_privilege('authenticated', 'public.recipient_access_tokens', 'INSERT')
    and not has_table_privilege('authenticated', 'public.recipient_access_tokens', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.recipient_access_tokens', 'DELETE')
    and not has_table_privilege('authenticated', 'public.recipient_management_sessions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.recipient_management_sessions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.recipient_management_sessions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.recipient_management_sessions', 'DELETE'),
    'authenticated clients cannot directly access recipient management tokens or sessions'
);
reset role;
select ok(
    not has_table_privilege('authenticated', 'private.credential_name_consent_events', 'SELECT')
    and not has_table_privilege('authenticated', 'private.credential_name_consent_events', 'INSERT')
    and not has_table_privilege('authenticated', 'private.credential_name_consent_events', 'UPDATE')
    and not has_table_privilege('authenticated', 'private.credential_name_consent_events', 'DELETE')
    and not has_table_privilege('service_role', 'private.credential_name_consent_events', 'SELECT')
    and not has_table_privilege('service_role', 'private.credential_name_consent_events', 'INSERT')
    and not has_table_privilege('service_role', 'private.credential_name_consent_events', 'UPDATE')
    and not has_table_privilege('service_role', 'private.credential_name_consent_events', 'DELETE'),
    'ordinary users and service_role cannot directly access consent events'
);
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
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
    $$select public.create_organization('Viewer Org', 'viewer-org', 'did:web:example.test', '10000000-0000-0000-0000-000000000002')$$,
    '42501', null, 'authenticated users cannot self-provision organizations'
);
select throws_ok(
    $$select public.create_recipient_access_token('80000000-0000-0000-0000-000000000001', repeat('c', 64))$$,
    '42501', null, 'authenticated users cannot create recipient access tokens'
);
select throws_ok(
    $$select public.redeem_recipient_access_token(repeat('c', 64), repeat('d', 64))$$,
    '42501', null, 'authenticated users cannot redeem recipient access tokens directly'
);
select throws_ok(
    $$select public.set_recipient_credential_visibility(repeat('d', 64), 'public')$$,
    '42501', null, 'authenticated users cannot update recipient visibility without redeeming a link'
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
    $$select public.set_credential_visibility('80000000-0000-0000-0000-000000000001', 'public')$$,
    'P0001', 'Insufficient organization role', 'viewer cannot change credential visibility'
);
select throws_ok(
    $$select public.persist_issuance_row(
        '10000000-0000-0000-0000-000000000002',
        '70000000-0000-0000-0000-000000000001',
        2, '{"email":"viewer@test.invalid"}'::jsonb, 'viewer-row-unique',
        'Viewer Recipient', 'viewer@test.invalid', 'hash-viewer', 'salt-viewer',
        'skip', '81000000-0000-0000-0000-000000000002',
        now(), null, 'unlisted', '{}'::jsonb,
        'viewer-test-jws', 'key-a', 'hash-viewer-content', null
    )$$,
    '42501', null, 'authenticated users cannot directly execute the persistence RPC'
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
reset role;
set local role service_role;
select lives_ok(
    $$select public.persist_issuance_row(
        '10000000-0000-0000-0000-000000000003',
        (select id from public.issuance_batches where organization_id = '20000000-0000-0000-0000-000000000001' and created_by = '10000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
        1, '{"email":"new@test.invalid"}'::jsonb, 'issuer-row-unique',
        'New Recipient', 'new@test.invalid', 'hash-new', 'salt-new', 'skip',
        '81000000-0000-0000-0000-000000000001', now(), null,
        'unlisted', '{}'::jsonb, 'issuer-test-jws', 'key-a', 'hash-content', null
    )$$,
    'service role can persist an issued credential for an issuer after internal role validation'
);
insert into public.email_events (organization_id, credential_id, type, payload)
values (
    '20000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'sent',
    '{"recipient":"new@test.invalid"}'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
    $$select public.revoke_credential('80000000-0000-0000-0000-000000000001', 'issuer attempt')$$,
    'P0001', 'Insufficient organization role', 'issuer cannot revoke'
);
select throws_ok(
    $$select public.anonymize_recipient('60000000-0000-0000-0000-000000000001')$$,
    'P0001', 'Insufficient organization role', 'issuer cannot anonymize recipients'
);
select throws_ok(
    $$select public.set_credential_visibility('80000000-0000-0000-0000-000000000001', 'public')$$,
    'P0001', 'Insufficient organization role', 'issuer cannot change credential visibility'
);
select throws_ok(
    $$select public.record_recipient_credential_name_consent(
      repeat('0', 64), true, false, 'issuer-attempt'
    )$$,
    '42501', null, 'issuer cannot grant recipient name consent'
);
reset role;
set local role service_role;
select throws_ok(
    $$select public.persist_issuance_row(
        '10000000-0000-0000-0000-000000000002',
        '70000000-0000-0000-0000-000000000001',
        2, '{"email":"viewer@test.invalid"}'::jsonb, 'viewer-service-row',
        'Viewer Recipient', 'viewer@test.invalid', 'hash-viewer', 'salt-viewer',
        'skip', '81000000-0000-0000-0000-000000000003',
        now(), null, 'unlisted', '{}'::jsonb,
        'viewer-test-jws', 'key-a', 'hash-viewer-content', null
    )$$,
    'P0001', 'Insufficient organization role', 'persistence RPC rejects a viewer actor even when called by the service role'
);
reset role;

-- Admin can revoke; owner can manage organization members.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
    $$select public.set_credential_visibility('80000000-0000-0000-0000-000000000001', 'public')$$,
    'admin can change credential visibility'
);
select lives_ok(
    $$select public.revoke_credential('80000000-0000-0000-0000-000000000001', 'admin test revocation')$$,
    'admin can revoke credentials'
);
select throws_ok(
    $$select public.record_recipient_credential_name_consent(
      repeat('0', 64), true, false, 'admin-attempt'
    )$$,
    '42501', null, 'admin cannot grant recipient name consent'
);
select is(
    (select visibility::text from public.credentials where id = '80000000-0000-0000-0000-000000000001'),
    'public',
    'admin visibility change is persisted'
);
select throws_ok(
    $$insert into public.organization_members(organization_id, user_id, role)
      values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'viewer')$$,
    '42501', null, 'admin cannot insert organization members'
);
select lives_ok(
    $$update public.organization_members set role = 'owner'
      where organization_id = '20000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-000000000002'$$,
    'admin member update is filtered by owner-only RLS'
);
select is(
    (select role::text from public.organization_members
     where organization_id = '20000000-0000-0000-0000-000000000001'
       and user_id = '10000000-0000-0000-0000-000000000002'),
    'viewer',
    'admin cannot change a member role'
);
select throws_ok(
    $$select public.add_organization_member_by_email(
        '20000000-0000-0000-0000-000000000001', 'new-member@test.invalid', 'viewer'
    )$$,
    'P0001', 'Insufficient organization role', 'member-management RPC rejects an admin'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
    $$select public.add_organization_member_by_email(
        '20000000-0000-0000-0000-000000000001', 'new-member@test.invalid', 'viewer'
    )$$,
    'owner can add an existing user through the role-checked member RPC'
);
select throws_ok(
    $$insert into public.organization_members(organization_id, user_id, role)
      values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'owner')$$,
    '42501', null, 'owner cannot grant owner role through direct membership insert'
);
select throws_ok(
    $$update public.organization_members set role = 'owner'
      where organization_id = '20000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-000000000006'$$,
    '42501', null, 'owner cannot escalate another member to owner through direct update'
);
select lives_ok(
    $$update public.organization_members set role = 'viewer'
      where organization_id = '20000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-000000000001'$$,
    'owner cannot change their own membership role'
);
select is(
    (select role::text from public.organization_members
     where organization_id = '20000000-0000-0000-0000-000000000001'
       and user_id = '10000000-0000-0000-0000-000000000001'),
    'owner',
    'owner retains their owner role after self-update attempt'
);
select lives_ok(
    $$delete from public.organization_members
      where organization_id = '20000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-000000000001'$$,
    'owner cannot delete their own membership'
);
select is(
    (select count(*)::int from public.organization_members
     where organization_id = '20000000-0000-0000-0000-000000000001'
       and user_id = '10000000-0000-0000-0000-000000000001'),
    1,
    'organization retains its owner membership'
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
set local role anon;
set local request.jwt.claim.role = 'anon';
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
    $$select * from private.credential_name_consent_events$$,
    '42501', null, 'anon cannot read recipient name-consent events'
);
select throws_ok(
    $$select public.record_recipient_credential_name_consent(
      repeat('0', 64), true, false, 'anon-attempt'
    )$$,
    '42501', null, 'anon cannot execute recipient name-consent RPC'
);
reset role;
set local request.jwt.claim.role = 'authenticated';

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

-- Owner-issued member invitations require a verified matching account and accept once.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
    $$select public.create_organization_invitation(
      '20000000-0000-0000-0000-000000000001',
      'unauthorized@test.invalid', 'viewer', '10000000-0000-0000-0000-000000000002'
    )$$,
    '42501', 'Insufficient organization role',
    'invitation RPC rejects an actor without owner role'
);
select throws_ok(
    $$select public.create_organization_invitation(
      '20000000-0000-0000-0000-000000000001',
      'invalid-role@test.invalid', 'owner', '10000000-0000-0000-0000-000000000001'
    )$$,
    '22023', 'Invalid invitation role',
    'invitation RPC does not allow owner role assignment'
);
select is(
    public.create_organization_invitation(
      '20000000-0000-0000-0000-000000000001',
      '  NEW-MEMBER@Test.Invalid  ', 'viewer', '10000000-0000-0000-0000-000000000001'
    )->>'email',
    'new-member@test.invalid',
    'invitation email is normalized before persistence'
);
select lives_ok(
    $$select public.create_organization_invitation(
      '20000000-0000-0000-0000-000000000001',
      'new-member@test.invalid', 'issuer', '10000000-0000-0000-0000-000000000001'
    )$$,
    'owner can resend an invitation with a changed role'
);
select is(
    (select count(*)::int from public.organization_invitations
     where organization_id = '20000000-0000-0000-0000-000000000001'
       and email = 'new-member@test.invalid'
       and accepted_at is null and revoked_at is null),
    1,
    'resending leaves only one active invitation for the email'
);
select is(
    (select count(*)::int from public.organization_invitations
     where organization_id = '20000000-0000-0000-0000-000000000001'
       and email = 'new-member@test.invalid'
       and revoked_at is not null),
    1,
    'resending revokes the previous invitation'
);
select throws_ok(
    $$select public.accept_organization_invitation(
      (select id from public.organization_invitations
       where email = 'new-member@test.invalid' and revoked_at is not null limit 1),
      '10000000-0000-0000-0000-000000000006'
    )$$,
    'P0001', 'Invitation is invalid or expired',
    'revoked invitation cannot be accepted'
);
select throws_ok(
    $$select public.accept_organization_invitation(
      (select id from public.organization_invitations
       where email = 'new-member@test.invalid' and revoked_at is null limit 1),
      '10000000-0000-0000-0000-000000000005'
    )$$,
    '42501', 'A verified matching email account is required',
    'a different verified account cannot accept the invitation'
);
select lives_ok(
    $$select public.accept_organization_invitation(
      (select id from public.organization_invitations
       where email = 'new-member@test.invalid' and revoked_at is null limit 1),
      '10000000-0000-0000-0000-000000000006'
    )$$,
    'verified matching account can accept the current invitation'
);
select lives_ok(
    $$select public.accept_organization_invitation(
      (select id from public.organization_invitations
       where email = 'new-member@test.invalid' and accepted_at is not null limit 1),
      '10000000-0000-0000-0000-000000000006'
    )$$,
    'same user can retry an already accepted invitation idempotently'
);
select is(
    (select count(*)::int from public.organization_members
     where organization_id = '20000000-0000-0000-0000-000000000001'
       and user_id = '10000000-0000-0000-0000-000000000006'
       and role = 'issuer'),
    1,
    'acceptance creates exactly one membership with the invited role'
);
select lives_ok(
    $$select public.create_organization_invitation(
      '20000000-0000-0000-0000-000000000001',
      'unverified-owner@test.invalid', 'viewer', '10000000-0000-0000-0000-000000000001'
    )$$,
    'owner can invite an unverified but existing account'
);
select throws_ok(
    $$select public.accept_organization_invitation(
      (select id from public.organization_invitations where email = 'unverified-owner@test.invalid'),
      '10000000-0000-0000-0000-000000000007'
    )$$,
    '42501', 'A verified matching email account is required',
    'unverified account cannot accept an invitation'
);
reset role;
update auth.users set email_confirmed_at = now()
where id = '10000000-0000-0000-0000-000000000007';
set local role service_role;
select lives_ok(
    $$select public.accept_organization_invitation(
      (select id from public.organization_invitations where email = 'unverified-owner@test.invalid'),
      '10000000-0000-0000-0000-000000000007'
    )$$,
    'account can accept after its email has been verified'
);
select lives_ok(
    $$select public.create_organization_invitation(
      '20000000-0000-0000-0000-000000000001',
      'expired-member@test.invalid', 'viewer', '10000000-0000-0000-0000-000000000001'
    )$$,
    'owner can invite a previously unknown account'
);
update public.organization_invitations
set expires_at = now() - interval '1 second'
where email = 'expired-member@test.invalid';
select throws_ok(
    $$select public.accept_organization_invitation(
      (select id from public.organization_invitations where email = 'expired-member@test.invalid'),
      '10000000-0000-0000-0000-000000000008'
    )$$,
    'P0001', 'Invitation is invalid or expired',
    'expired invitation cannot be accepted'
);
reset role;
update auth.users set email_confirmed_at = null
where id = '10000000-0000-0000-0000-000000000007';

-- Even service_role and the table owner cannot mutate append-only audit rows.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select ok(
    public.create_organization('Owner Allowlist Test', 'owner-allowlist-test', 'did:web:example.test', '10000000-0000-0000-0000-000000000001') is not null,
    'service_role can atomically provision an organization for the authorized owner'
);
select is(
    (select count(*)::int from public.organization_members m
     join public.organizations o on o.id = m.organization_id
     where o.slug = 'owner-allowlist-test'
       and m.user_id = '10000000-0000-0000-0000-000000000001'
       and m.role = 'owner'),
    1,
    'organization provisioning creates its owner membership'
);
select is(
    (select did from public.organizations where slug = 'owner-allowlist-test'),
    'did:web:example.test',
    'organization provisioning stores the DID derived from the canonical site origin'
);
select is(
    (select count(*)::int from public.status_lists s
     join public.organizations o on o.id = s.organization_id
     where o.slug = 'owner-allowlist-test'),
    1,
    'organization provisioning creates its status list'
);
select is(
    (select count(*)::int from public.audit_logs a
     join public.organizations o on o.id = a.organization_id
     where o.slug = 'owner-allowlist-test'
       and a.action = 'organization.created'),
    1,
    'organization provisioning records an audit event'
);
select throws_ok(
    $$select public.create_organization('Unverified Org', 'unverified-org', 'did:web:example.test', '10000000-0000-0000-0000-000000000007')$$,
    '42501', 'Verified user is required', 'organization provisioning rejects unverified owner accounts'
);
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok(
    $$select public.reserve_email_send('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 10)$$,
    '42501', 'Service role required', 'authenticated callers cannot reserve email quota'
);
select throws_ok(
    $$select public.create_recipient_access_token('81000000-0000-0000-0000-000000000001', repeat('c', 64))$$,
    '42501', 'Service role required', 'recipient token RPC re-checks the caller role'
);
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select isnt(
    public.reserve_email_send('20000000-0000-0000-0000-000000000002', null, 2),
    null,
    'email quota can reserve organization invitation email without a credential'
);
select lives_ok(
    $$select public.complete_email_send(
      (select id from public.email_send_attempts
       where organization_id = '20000000-0000-0000-0000-000000000002'
         and credential_id is null and status = 'reserved' limit 1),
      'provider-invitation', 'sent', null, true
    )$$,
    'invitation email reservation completes without a credential reference'
);
select is(
    (select count(*)::int from public.email_events
     where organization_id = '20000000-0000-0000-0000-000000000002'
       and credential_id is null and provider_id = 'provider-invitation'),
    1,
    'invitation email completion is recorded in email events'
);
select isnt(
    public.reserve_email_send('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 2),
    null,
    'email quota atomically reserves the first send'
);
select lives_ok(
    $$select public.complete_email_send(
      (select id from public.email_send_attempts where organization_id = '20000000-0000-0000-0000-000000000001' and status = 'reserved' limit 1),
      'provider-first', 'sent', null, true
    )$$,
    'email reservation completion records provider outcome and event atomically'
);
select isnt(
    public.reserve_email_send('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 2),
    null,
    'email quota atomically reserves a send below its cap'
);
select lives_ok(
    $$select public.complete_email_send(
      (select id from public.email_send_attempts where organization_id = '20000000-0000-0000-0000-000000000001' and status = 'reserved' limit 1),
      'provider-second', 'failed', 'provider rejection', false
    )$$,
    'failed provider attempts still count against the daily plan limit'
);
select is(
    public.reserve_email_send('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 2),
    null,
    'email quota refuses sends at the daily cap'
);
update public.email_send_attempts
set created_at = now() - interval '25 hours'
where organization_id = '20000000-0000-0000-0000-000000000001';
select isnt(
    public.reserve_email_send('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 2),
    null,
    'email quota uses a rolling 24-hour window and releases expired attempts'
);
select is(
    public.create_recipient_access_token('81000000-0000-0000-0000-000000000001', repeat('a', 64))->>'email',
    'new@test.invalid',
    'service_role creates a token only for an issued credential with a recipient email'
);
select is(
    public.redeem_recipient_access_token(repeat('a', 64), repeat('b', 64))->>'credentialId',
    '81000000-0000-0000-0000-000000000001',
    'recipient redeems a valid one-time link into a credential-scoped session'
);
select throws_ok(
    $$select public.redeem_recipient_access_token(repeat('a', 64), repeat('c', 64))$$,
    'P0001', 'Access link is invalid, expired, or already used',
    'recipient access link can be redeemed only once'
);
select is(
    public.set_recipient_credential_visibility(repeat('b', 64), 'public')->>'visibility',
    'public',
    'recipient session can atomically make its credential public'
);
select is(
    (select count(*)::int from public.audit_logs
     where entity_id = '81000000-0000-0000-0000-000000000001'
       and action = 'credential.visibility_changed_by_recipient'),
    1,
    'recipient visibility changes are audited without a user account'
);
select throws_ok(
    $$select public.create_recipient_access_token('80000000-0000-0000-0000-000000000002', repeat('e', 64))$$,
    'P0001', 'Issued credential recipient is unavailable',
    'revoked credentials cannot receive recipient management links'
);
select lives_ok(
    $$select public.create_recipient_access_token('81000000-0000-0000-0000-000000000001', repeat('3', 64))$$,
    'service_role can issue a fresh recipient link'
);
update public.recipient_access_tokens
set expires_at = now() - interval '1 minute'
where token_hash = repeat('3', 64);
select throws_ok(
    $$select public.redeem_recipient_access_token(repeat('3', 64), repeat('4', 64))$$,
    'P0001', 'Access link is invalid, expired, or already used',
    'expired recipient access links cannot be redeemed'
);
select lives_ok(
    $$select public.create_recipient_access_token('81000000-0000-0000-0000-000000000001', repeat('5', 64))$$,
    'service_role can issue another single-use link'
);
select lives_ok(
    $$select public.redeem_recipient_access_token(repeat('5', 64), repeat('6', 64))$$,
    'a valid access link creates a management session'
);
update public.recipient_management_sessions
set expires_at = now() - interval '1 minute'
where token_hash = repeat('6', 64);
select throws_ok(
    $$select public.set_recipient_credential_visibility(repeat('6', 64), 'unlisted')$$,
    'P0001', 'Recipient management session is invalid or expired',
    'expired recipient management sessions cannot change visibility'
);
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
    $$insert into public.credentials(organization_id, kid, serial_number)
      values ('20000000-0000-0000-0000-000000000001', 'key-b', 'CROSS-KEY')$$,
    '23503', null, 'credential cannot reference another tenant signing key'
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
    $$insert into private.credential_name_consent_events(
        organization_id, credential_id, recipient_id, scope, event_type, notice_version
      ) values (
        '20000000-0000-0000-0000-000000000001',
        '80000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000002',
        'masked', 'granted', 'cross-tenant-test'
      )$$,
    '23503', null, 'consent events cannot reference another tenant recipient'
);
select throws_ok(
    $$insert into private.credential_name_consent_events(
        organization_id, credential_id, recipient_id, scope, event_type, notice_version
      ) values (
        '20000000-0000-0000-0000-000000000001',
        '80000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000003',
        'masked', 'granted', 'credential-recipient-mismatch'
      )$$,
    '23503', null, 'consent events cannot reference another recipient in the same tenant'
);
select throws_ok(
    $$insert into public.verification_events(organization_id, credential_id, method, result)
      values ('20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'id', 'valid')$$,
    '23503', null, 'verification event cannot reference another tenant credential'
);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
    $$select public.create_recipient_access_token('81000000-0000-0000-0000-000000000001', repeat('f', 64))$$,
    'issuer email can create a scoped management link before recipient anonymization'
);
select lives_ok(
    $$select public.redeem_recipient_access_token(repeat('f', 64), repeat('0', 64))$$,
    'recipient management link can be redeemed before anonymization'
);
select is(
    public.get_credential_name_consent('81000000-0000-0000-0000-000000000001')->>'maskedNameConsent',
    'false',
    'masked-name consent is hidden by default'
);
select is(
    public.get_credential_name_consent('81000000-0000-0000-0000-000000000001')->>'fullNameConsent',
    'false',
    'full-name consent is hidden by default'
);
select is(
    public.record_recipient_credential_name_consent(
      repeat('0', 64), true, false, 'consent-test-v1'
    )->>'maskedNameConsent',
    'true',
    'recipient session can grant masked-name consent'
);
select is(
    public.record_recipient_credential_name_consent(
      repeat('0', 64), false, false, 'consent-test-v1'
    )->>'maskedNameConsent',
    'false',
    'recipient session can withdraw masked-name consent'
);
select is(
    public.record_recipient_credential_name_consent(
      repeat('0', 64), true, false, 'consent-test-v2'
    )->>'maskedNameConsent',
    'true',
    'recipient session can grant masked-name consent again'
);
reset role;
set local role postgres;
select is(
    (select string_agg(event_type, ',' order by event_id)
     from private.credential_name_consent_events
     where credential_id = '81000000-0000-0000-0000-000000000001'
       and scope = 'masked'),
    'granted,withdrawn,granted',
    'consent projection follows grant, withdrawal, and re-grant order'
);
select ok(
    (select bool_and(occurred_at is not null and length(notice_version) > 0)
     from private.credential_name_consent_events
     where credential_id = '81000000-0000-0000-0000-000000000001'),
    'every consent event records a timestamp and notice version'
);
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
    $$select public.record_recipient_credential_name_consent(
      repeat('0', 64), true, true, 'consent-test-v2'
    )$$,
    'masked and full name consents are independently grantable'
);
select lives_ok(
    $$select public.record_recipient_credential_name_consent(
      repeat('0', 64), true, false, 'consent-test-v2'
    )$$,
    'full name consent can be withdrawn independently'
);
select is(
    (select count(*)::int from public.audit_logs
     where entity_id = '81000000-0000-0000-0000-000000000001'
       and action like 'recipient.name_consent.%'),
    5,
    'every consent grant and withdrawal is audit-logged'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
    $$select public.anonymize_recipient((select id from public.recipients where email = 'new@test.invalid'))$$,
    'owner can anonymize a recipient'
);
select ok(
    (select full_name is null and email is null and email_hash is null and salt is null
        and anonymized_at is not null
     from public.recipients
     where id = (select recipient_id from public.credentials where id = '81000000-0000-0000-0000-000000000001')),
    'anonymization removes recipient identifiers'
);
select ok(
    (select status = 'revoked' and credential_json is null and jws is null
        and content_hash is null and pdf_path is null
     from public.credentials where id = '81000000-0000-0000-0000-000000000001'),
    'anonymization revokes and clears the signed credential payload'
);
select is(
    (select count(*)::int from public.revocations where credential_id = '81000000-0000-0000-0000-000000000001'),
    1,
    'anonymization retains a revocation record for the credential ID'
);
select ok(
    (select revoked_credential_ids @> to_jsonb('81000000-0000-0000-0000-000000000001'::text)
     from public.status_lists where organization_id = '20000000-0000-0000-0000-000000000001'),
    'anonymized credential ID remains in the internal revoked-ID projection'
);
select ok(
    (select payload = '{}'::jsonb from public.issuance_rows where credential_id = '81000000-0000-0000-0000-000000000001'),
    'anonymization removes recipient payload from issuance rows'
);
select ok(
    (select payload = '{"redacted": true}'::jsonb from public.email_events where credential_id = '81000000-0000-0000-0000-000000000001'),
    'anonymization redacts email-event payloads while retaining their audit row'
);
reset role;
set local role postgres;
select is(
    public.get_credential_name_consent('81000000-0000-0000-0000-000000000001')->>'maskedNameConsent',
    'false',
    'anonymization withdraws masked-name consent'
);
select is(
    public.get_credential_name_consent('81000000-0000-0000-0000-000000000001')->>'fullNameConsent',
    'false',
    'anonymization withdraws full-name consent'
);
select is(
    (select count(*)::int from private.credential_name_consent_events
     where credential_id = '81000000-0000-0000-0000-000000000001'
       and event_type = 'withdrawn'
       and notice_version = 'system-anonymization-v1'),
    1,
    'anonymization records a versioned consent withdrawal'
);
reset role;
select is(
    (select count(*)::int from public.recipient_access_tokens
     where credential_id = '81000000-0000-0000-0000-000000000001'),
    0,
    'recipient anonymization deletes outstanding access tokens'
);
select is(
    (select count(*)::int from public.recipient_management_sessions
     where credential_id = '81000000-0000-0000-0000-000000000001'),
    0,
    'recipient anonymization deletes active management sessions'
);

select * from finish();
rollback;
