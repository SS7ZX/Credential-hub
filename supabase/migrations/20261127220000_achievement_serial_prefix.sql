alter table public.achievements
    add column serial_prefix text,
    add constraint achievement_serial_prefix_format
        check (
            serial_prefix is null
            or (
                length(serial_prefix) between 1 and 80
                and serial_prefix ~ '^[A-Z0-9][A-Z0-9._-]*(/[A-Z0-9][A-Z0-9._-]*){0,3}$'
            )
        );

create unique index achievements_serial_prefix_unique
    on public.achievements (serial_prefix)
    where serial_prefix is not null;

create table private.serial_prefix_registry (
    serial_prefix text primary key,
    entity_type text not null check (entity_type in ('event', 'achievement')),
    entity_id uuid not null,
    unique (entity_type, entity_id)
);

alter table private.serial_prefix_registry enable row level security;
revoke all on private.serial_prefix_registry from public, anon, authenticated;

insert into private.serial_prefix_registry(serial_prefix, entity_type, entity_id)
select serial_prefix, 'event', id
from public.events
where serial_prefix is not null;

create or replace function private.normalize_achievement_serial_prefix()
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

create trigger achievements_normalize_serial_prefix
before insert or update of serial_prefix
on public.achievements
for each row
execute function private.normalize_achievement_serial_prefix();

create or replace function private.enforce_global_serial_prefix_uniqueness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_entity_type text := case when tg_table_name = 'events' then 'event' else 'achievement' end;
begin
    if tg_op = 'DELETE' then
        if old.serial_prefix is not null then
            delete from private.serial_prefix_registry
            where serial_prefix = old.serial_prefix
              and entity_type = v_entity_type
              and entity_id = old.id;
        end if;
        return old;
    end if;

    if tg_op = 'UPDATE' and old.serial_prefix is not distinct from new.serial_prefix then
        return new;
    end if;

    if tg_op = 'UPDATE' and old.serial_prefix is not null then
        delete from private.serial_prefix_registry
        where serial_prefix = old.serial_prefix
          and entity_type = v_entity_type
          and entity_id = old.id;
    end if;

    if new.serial_prefix is null then
        return new;
    end if;

    insert into private.serial_prefix_registry(serial_prefix, entity_type, entity_id)
    values (new.serial_prefix, v_entity_type, new.id)
    on conflict do nothing;
    if not found then
        raise unique_violation using message = 'Serial prefix is already in use';
    end if;
    return new;
end;
$$;

create trigger events_enforce_global_serial_prefix_uniqueness
after insert or update of serial_prefix or delete
on public.events
for each row
execute function private.enforce_global_serial_prefix_uniqueness();

create trigger achievements_enforce_global_serial_prefix_uniqueness
after insert or update of serial_prefix or delete
on public.achievements
for each row
execute function private.enforce_global_serial_prefix_uniqueness();

revoke all on function private.normalize_achievement_serial_prefix()
    from public, anon, authenticated;
revoke all on function private.enforce_global_serial_prefix_uniqueness()
    from public, anon, authenticated;

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
    select coalesce(a.serial_prefix, e.serial_prefix)
    into v_prefix
    from public.issuance_batches b
    left join public.events e
      on e.organization_id = b.organization_id
     and e.id = b.event_id
    join public.achievements a
      on a.organization_id = b.organization_id
     and a.id = b.achievement_id
    where b.organization_id = new.organization_id
      and b.id = new.batch_id;

    if v_prefix is null then
        return new;
    end if;

    v_sequence := pg_catalog.substring(new.serial_number, '([0-9]+)$');
    if v_sequence is null then
        raise exception 'Could not derive the allocated credential serial sequence';
    end if;

    new.serial_number := v_prefix || '/' || v_sequence;
    return new;
end;
$$;
