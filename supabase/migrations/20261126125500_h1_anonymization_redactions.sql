begin;

create table private.audit_log_redaction_permits (
    audit_log_id uuid primary key references public.audit_logs(id) on delete cascade,
    recipient_id uuid not null references public.recipients(id) on delete cascade
);
alter table private.audit_log_redaction_permits enable row level security;
revoke all on private.audit_log_redaction_permits
    from public, anon, authenticated, service_role;

create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'metadata') is not distinct from (to_jsonb(old) - 'metadata')
       and new.metadata = '{"redacted": true}'::jsonb
       and exists (
           select 1
           from private.audit_log_redaction_permits p
           where p.audit_log_id = old.id
       ) then
        return new;
    end if;

    raise exception 'audit_logs is append-only';
end;
$$;

create or replace function private.redact_recipient_audit_metadata(
    p_organization_id uuid,
    p_recipient_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_audit_log_id uuid;
begin
    for v_audit_log_id in
        select al.id
        from public.audit_logs al
        where al.organization_id = p_organization_id
          and al.entity_type = 'credential'
          and al.entity_id in (
              select c.id
              from public.credentials c
              where c.organization_id = p_organization_id
                and c.recipient_id = p_recipient_id
          )
          and al.metadata is distinct from '{"redacted": true}'::jsonb
    loop
        insert into private.audit_log_redaction_permits(audit_log_id, recipient_id)
        values (v_audit_log_id, p_recipient_id);

        update public.audit_logs
        set metadata = '{"redacted": true}'::jsonb
        where id = v_audit_log_id;

        delete from private.audit_log_redaction_permits
        where audit_log_id = v_audit_log_id;
    end loop;
end;
$$;

create or replace function private.redact_anonymized_recipient_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.anonymized_at is null and new.anonymized_at is not null then
        update public.verification_events ve
        set credential_id = null,
            ip_hash = null
        where ve.organization_id = new.organization_id
          and ve.credential_id in (
              select c.id
              from public.credentials c
              where c.organization_id = new.organization_id
                and c.recipient_id = new.id
          );

        update public.revocations r
        set reason = 'Recipient data anonymized'
        where r.organization_id = new.organization_id
          and r.credential_id in (
              select c.id
              from public.credentials c
              where c.organization_id = new.organization_id
                and c.recipient_id = new.id
          );

        perform private.redact_recipient_audit_metadata(new.organization_id, new.id);
    end if;
    return new;
end;
$$;

create trigger recipients_redact_pii_after_anonymization
after update of anonymized_at on public.recipients
for each row
when (old.anonymized_at is null and new.anonymized_at is not null)
execute function private.redact_anonymized_recipient_data();

update public.issuance_batches
set source_filename = null
where source_filename is not null;

create or replace function private.discard_issuance_source_filename()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.source_filename := null;
    return new;
end;
$$;

create trigger issuance_batches_discard_source_filename
before insert or update of source_filename on public.issuance_batches
for each row
execute function private.discard_issuance_source_filename();

revoke all on function private.redact_recipient_audit_metadata(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function private.prevent_audit_mutation()
    from public, anon, authenticated, service_role;
revoke all on function private.redact_anonymized_recipient_data()
    from public, anon, authenticated, service_role;
revoke all on function private.discard_issuance_source_filename()
    from public, anon, authenticated, service_role;

commit;
