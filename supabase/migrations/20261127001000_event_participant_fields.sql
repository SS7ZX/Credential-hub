alter table public.events
    add column serial_prefix text,
    add constraint event_serial_prefix_format
        check (
            serial_prefix is null
            or (
                length(serial_prefix) between 1 and 80
                and serial_prefix ~ '^[A-Z0-9][A-Z0-9._-]*(/[A-Z0-9][A-Z0-9._-]*){0,3}$'
            )
        );

create unique index events_serial_prefix_unique
    on public.events (serial_prefix)
    where serial_prefix is not null;

create or replace function private.normalize_event_serial_prefix()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.serial_prefix := nullif(
        pg_catalog.upper(pg_catalog.btrim(coalesce(new.serial_prefix, ''))),
        ''
    );
    return new;
end;
$$;

create trigger events_normalize_serial_prefix
before insert or update of serial_prefix
on public.events
for each row
execute function private.normalize_event_serial_prefix();

create or replace function private.apply_event_serial_prefix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_prefix text;
    v_sequence text;
begin
    select e.serial_prefix
    into v_prefix
    from public.issuance_batches b
    join public.events e
      on e.organization_id = b.organization_id
     and e.id = b.event_id
    where b.organization_id = new.organization_id
      and b.id = new.batch_id;

    if v_prefix is null then
        return new;
    end if;

    v_sequence := pg_catalog.substring(new.serial_number from '([0-9]+)$');
    if v_sequence is null then
        raise exception 'Could not derive the allocated credential serial sequence';
    end if;

    new.serial_number := v_prefix || '/' || v_sequence;
    return new;
end;
$$;

revoke all on function private.apply_event_serial_prefix()
    from public, anon, authenticated;

create trigger credentials_apply_event_serial_prefix
before insert or update of serial_number, batch_id
on public.credentials
for each row
execute function private.apply_event_serial_prefix();

alter table public.recipients
    add constraint recipient_external_id_length
    check (external_id is null or length(trim(external_id)) between 1 and 120);

create or replace function private.sync_recipient_external_id_from_issuance_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_external_id text;
begin
    if new.status <> 'succeeded' or new.credential_id is null then
        return new;
    end if;

    v_external_id := nullif(
        pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(new.payload ->> 'external_id', '')),
            '[[:space:]]+',
            ' ',
            'g'
        ),
        ''
    );

    if v_external_id is null then
        return new;
    end if;

    update public.recipients r
    set external_id = v_external_id,
        updated_at = pg_catalog.now()
    from public.credentials c
    where c.organization_id = new.organization_id
      and c.id = new.credential_id
      and c.recipient_id = r.id
      and r.organization_id = new.organization_id
      and r.anonymized_at is null;

    return new;
end;
$$;

revoke all on function private.sync_recipient_external_id_from_issuance_row()
    from public, anon, authenticated;

create trigger issuance_rows_sync_recipient_external_id
after insert or update of payload, credential_id, status
on public.issuance_rows
for each row
execute function private.sync_recipient_external_id_from_issuance_row();

create or replace function private.clear_recipient_external_id_on_anonymization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.anonymized_at is not null then
        new.external_id := null;
    end if;
    return new;
end;
$$;

create trigger recipients_clear_external_id_on_anonymization
before update of anonymized_at
on public.recipients
for each row
execute function private.clear_recipient_external_id_on_anonymization();
