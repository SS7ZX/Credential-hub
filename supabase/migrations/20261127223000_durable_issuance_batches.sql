create or replace function public.create_issuance_batch(
    p_actor_id uuid,
    p_organization_id uuid,
    p_event_id uuid,
    p_achievement_id uuid,
    p_rows_total integer,
    p_options jsonb,
    p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_batch public.issuance_batches%rowtype;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_rows_total is null or p_rows_total < 1 or p_rows_total > 1000 then
        raise exception 'Invalid issuance row count' using errcode = '22023';
    end if;
    if p_options is null or jsonb_typeof(p_options) <> 'object' then
        raise exception 'Invalid issuance options' using errcode = '22023';
    end if;
    if p_idempotency_key is null or length(p_idempotency_key) not between 1 and 100 then
        raise exception 'Invalid issuance idempotency key' using errcode = '22023';
    end if;
    if not private.user_has_org_role(
        p_actor_id,
        p_organization_id,
        array['owner','admin','issuer']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;
    if not exists (
        select 1
        from public.achievements a
        where a.id = p_achievement_id
          and a.organization_id = p_organization_id
          and (a.event_id is null or a.event_id = p_event_id)
    ) then
        raise exception 'Achievement does not belong to this event';
    end if;
    if not exists (
        select 1 from public.events e
        where e.id = p_event_id and e.organization_id = p_organization_id
    ) then
        raise exception 'Event not found in this organization';
    end if;

    perform pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'issuance-batch:' || p_organization_id::text || ':' || p_idempotency_key,
            0
        )
    );
    select * into v_batch
    from public.issuance_batches
    where organization_id = p_organization_id
      and idempotency_key = p_idempotency_key
    for update;
    if found then
        if v_batch.created_by <> p_actor_id
           or v_batch.event_id <> p_event_id
           or v_batch.achievement_id <> p_achievement_id
           or v_batch.total <> p_rows_total
           or v_batch.options <> p_options then
            raise exception 'Issuance batch idempotency key was reused with different input'
                using errcode = '23505';
        end if;
        return jsonb_build_object(
            'id', v_batch.id,
            'total', v_batch.total,
            'status', v_batch.status
        );
    end if;

    insert into public.issuance_batches(
        organization_id, event_id, achievement_id, created_by,
        total, options, status, idempotency_key, source_filename
    )
    values (
        p_organization_id, p_event_id, p_achievement_id, p_actor_id,
        p_rows_total, p_options, 'draft', p_idempotency_key, null
    )
    returning * into v_batch;

    return jsonb_build_object(
        'id', v_batch.id,
        'total', v_batch.total,
        'status', v_batch.status
    );
end;
$$;

create or replace function public.stage_issuance_rows(
    p_actor_id uuid,
    p_batch_id uuid,
    p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_batch public.issuance_batches%rowtype;
    v_item jsonb;
    v_row_number integer;
    v_count integer := 0;
    v_seen_rows integer[] := array[]::integer[];
    v_existing public.issuance_rows%rowtype;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
        raise exception 'Invalid issuance staging chunk' using errcode = '22023';
    end if;
    if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 50 then
        raise exception 'Invalid issuance staging chunk' using errcode = '22023';
    end if;

    select * into v_batch
    from public.issuance_batches
    where id = p_batch_id
    for update;
    if not found then raise exception 'Issuance batch not found'; end if;
    if not private.user_has_org_role(
        p_actor_id,
        v_batch.organization_id,
        array['owner','admin','issuer']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;
    if v_batch.status <> 'draft' then
        raise exception 'Only draft issuance batches accept staged rows';
    end if;

    for v_item in select value from jsonb_array_elements(p_rows)
    loop
        if jsonb_typeof(v_item) is distinct from 'object'
           or jsonb_typeof(v_item->'payload') is distinct from 'object'
           or coalesce(v_item->>'rowNumber', '') !~ '^[1-9][0-9]*$'
           or coalesce(v_item->>'idempotencyKey', '') !~ '^[a-f0-9]{64}$' then
            raise exception 'Invalid staged issuance row' using errcode = '22023';
        end if;
        v_row_number := (v_item->>'rowNumber')::integer;
        if v_row_number = any(v_seen_rows) then
            raise exception 'Duplicate row number in staging chunk' using errcode = '22023';
        end if;
        v_seen_rows := array_append(v_seen_rows, v_row_number);
        if v_row_number > v_batch.total then
            raise exception 'Staged row number exceeds batch total' using errcode = '22023';
        end if;

        select * into v_existing
        from public.issuance_rows
        where batch_id = p_batch_id and row_number = v_row_number
        for update;
        if found then
            if v_existing.status <> 'pending'
               or v_existing.payload is distinct from v_item->'payload'
               or v_existing.idempotency_key is distinct from v_item->>'idempotencyKey' then
                raise exception 'Staged row differs from the persisted batch row'
                    using errcode = '23505';
            end if;
        else
            insert into public.issuance_rows(
                organization_id, batch_id, row_number, payload, idempotency_key, status
            )
            values (
                v_batch.organization_id,
                p_batch_id,
                v_row_number,
                v_item->'payload',
                v_item->>'idempotencyKey',
                'pending'
            );
        end if;
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

create or replace function public.finalize_issuance_batch(
    p_actor_id uuid,
    p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_batch public.issuance_batches%rowtype;
    v_staged_count integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    select * into v_batch
    from public.issuance_batches
    where id = p_batch_id
    for update;
    if not found then raise exception 'Issuance batch not found'; end if;
    if not private.user_has_org_role(
        p_actor_id,
        v_batch.organization_id,
        array['owner','admin','issuer']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;

    if v_batch.status <> 'draft' then
        return jsonb_build_object('id', v_batch.id, 'status', v_batch.status);
    end if;

    select count(*) into v_staged_count
    from public.issuance_rows
    where batch_id = p_batch_id;
    if v_staged_count <> v_batch.total then
        raise exception 'All issuance rows must be staged before processing';
    end if;

    update public.issuance_batches
    set status = 'queued',
        started_at = null,
        completed_at = null
    where id = p_batch_id
    returning * into v_batch;

    return jsonb_build_object('id', v_batch.id, 'status', v_batch.status);
end;
$$;

create or replace function public.refresh_issuance_batch_status(
    p_actor_id uuid,
    p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_batch public.issuance_batches%rowtype;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    select * into v_batch
    from public.issuance_batches
    where id = p_batch_id
    for update;
    if not found then raise exception 'Issuance batch not found'; end if;
    if not private.user_has_org_role(
        p_actor_id,
        v_batch.organization_id,
        array['owner','admin','issuer']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;

    if v_batch.processed_count >= v_batch.total then
        update public.issuance_batches
        set status = case when failed > 0 then 'completed_with_errors'::public.issuance_batch_status
                          else 'completed'::public.issuance_batch_status end,
            completed_at = coalesce(completed_at, now())
        where id = p_batch_id
        returning * into v_batch;
    elsif v_batch.status in ('queued', 'processing', 'failed') then
        update public.issuance_batches
        set status = 'processing',
            started_at = coalesce(started_at, now()),
            completed_at = null
        where id = p_batch_id
        returning * into v_batch;
    end if;

    return jsonb_build_object(
        'id', v_batch.id,
        'status', v_batch.status,
        'total', v_batch.total,
        'processed_count', v_batch.processed_count,
        'succeeded', v_batch.succeeded,
        'failed', v_batch.failed
    );
end;
$$;

create or replace function public.record_issuance_failure(
    p_actor_id uuid,
    p_batch_id uuid,
    p_row_number integer,
    p_payload jsonb,
    p_idempotency_key text,
    p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_org_id uuid;
    v_previous_status public.issuance_row_status;
    v_current_key text;
    v_current_payload jsonb;
begin
    select organization_id into v_org_id
    from public.issuance_batches
    where id = p_batch_id;
    if v_org_id is null then raise exception 'Issuance batch not found'; end if;
    if not private.user_has_org_role(
        p_actor_id,
        v_org_id,
        array['owner','admin','issuer']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;
    if p_error is null or p_error not in (
        'recipient_anonymized',
        'invalid_row',
        'duplicate_recipient',
        'issuance_failed'
    ) then
        raise exception 'Invalid issuance failure code' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));
    select status, idempotency_key, payload
    into v_previous_status, v_current_key, v_current_payload
    from public.issuance_rows
    where batch_id = p_batch_id and row_number = p_row_number
    for update;
    if not found then
        raise exception 'Staged issuance row not found';
    end if;
    if v_previous_status = 'succeeded' then return; end if;
    if v_current_key is distinct from p_idempotency_key
       or v_current_payload is distinct from p_payload then
        raise exception 'Staged issuance row changed';
    end if;

    update public.issuance_rows
    set status = 'failed',
        last_error = left(p_error, 80),
        updated_at = now()
    where batch_id = p_batch_id and row_number = p_row_number;

    update public.issuance_batches
    set processed_count = processed_count
            + case when v_previous_status = 'pending' then 1 else 0 end,
        failed = failed
            + case when v_previous_status is distinct from 'failed' then 1 else 0 end,
        succeeded = succeeded
            - case when v_previous_status = 'succeeded' then 1 else 0 end
    where id = p_batch_id;
end;
$$;

revoke all on function public.create_issuance_batch(uuid, uuid, uuid, uuid, integer, jsonb, text)
    from public, anon, authenticated;
revoke all on function public.stage_issuance_rows(uuid, uuid, jsonb)
    from public, anon, authenticated;
revoke all on function public.finalize_issuance_batch(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.refresh_issuance_batch_status(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.record_issuance_failure(uuid, uuid, integer, jsonb, text, text)
    from public, anon, authenticated;
grant execute on function public.create_issuance_batch(uuid, uuid, uuid, uuid, integer, jsonb, text)
    to service_role;
grant execute on function public.stage_issuance_rows(uuid, uuid, jsonb)
    to service_role;
grant execute on function public.finalize_issuance_batch(uuid, uuid)
    to service_role;
grant execute on function public.refresh_issuance_batch_status(uuid, uuid)
    to service_role;
grant execute on function public.record_issuance_failure(uuid, uuid, integer, jsonb, text, text)
    to service_role;
