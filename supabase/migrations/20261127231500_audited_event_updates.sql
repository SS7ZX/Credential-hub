create or replace function public.update_event(
    p_event_id uuid,
    p_name text,
    p_event_date date,
    p_location text,
    p_description text,
    p_serial_prefix text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event public.events%rowtype;
    v_actor_id uuid := auth.uid();
    v_changed_fields text[] := array[]::text[];
    v_name text;
    v_location text;
    v_description text;
    v_serial_prefix text;
begin
    if v_actor_id is null then
        raise exception 'Authenticated user required' using errcode = '42501';
    end if;
    if p_name is null or length(pg_catalog.btrim(p_name)) = 0 then
        raise exception 'Event name is required' using errcode = '22023';
    end if;
    v_name := pg_catalog.regexp_replace(pg_catalog.btrim(p_name), '[[:space:]]+', ' ', 'g');
    v_location := nullif(
        pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_location, '')), '[[:space:]]+', ' ', 'g'),
        ''
    );
    v_description := nullif(
        pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_description, '')), '[[:space:]]+', ' ', 'g'),
        ''
    );
    v_serial_prefix := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_serial_prefix, ''))), '');

    select * into v_event
    from public.events
    where id = p_event_id
    for update;
    if not found then
        raise exception 'Event not found';
    end if;
    if not private.user_has_org_role(
        v_actor_id,
        v_event.organization_id,
        array['owner','admin','issuer']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;

    if v_event.name is distinct from v_name then
        v_changed_fields := array_append(v_changed_fields, 'name');
    end if;
    if v_event.event_date is distinct from p_event_date then
        v_changed_fields := array_append(v_changed_fields, 'event_date');
    end if;
    if v_event.location is distinct from v_location then
        v_changed_fields := array_append(v_changed_fields, 'location');
    end if;
    if v_event.description is distinct from v_description then
        v_changed_fields := array_append(v_changed_fields, 'description');
    end if;
    if v_event.serial_prefix is distinct from v_serial_prefix then
        v_changed_fields := array_append(v_changed_fields, 'serial_prefix');
    end if;

    update public.events
    set name = v_name,
        event_date = p_event_date,
        location = v_location,
        description = v_description,
        serial_prefix = v_serial_prefix,
        updated_at = pg_catalog.now()
    where id = p_event_id
    returning * into v_event;

    if cardinality(v_changed_fields) > 0 then
        insert into public.audit_logs(
            organization_id, actor_id, action, entity_type, entity_id, metadata
        )
        values (
            v_event.organization_id,
            v_actor_id,
            'event.updated',
            'event',
            v_event.id,
            jsonb_build_object(
                'changed_fields', to_jsonb(v_changed_fields),
                'serial_prefix_applies_to_future_credentials_only', true
            )
        );
    end if;

    return jsonb_build_object(
        'id', v_event.id,
        'name', v_event.name,
        'serial_prefix', v_event.serial_prefix,
        'updated_at', v_event.updated_at
    );
end;
$$;

revoke all on function public.update_event(uuid, text, date, text, text, text)
    from public, anon, service_role;
grant execute on function public.update_event(uuid, text, date, text, text, text)
    to authenticated;

revoke update on public.events from authenticated;
