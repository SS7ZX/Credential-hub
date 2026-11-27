alter table public.email_send_attempts
    add column request_key text;

create unique index email_send_attempts_idempotency_unique
    on public.email_send_attempts(organization_id, credential_id, request_key)
    where credential_id is not null and request_key is not null;

create or replace function public.reserve_email_send(
    p_organization_id uuid,
    p_credential_id uuid,
    p_daily_limit integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt_id uuid;
    v_count bigint;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_daily_limit is null or p_daily_limit < 1 then
        raise exception 'Invalid daily email limit' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('email-daily:' || p_organization_id::text, 0)
    );

    delete from public.email_send_attempts
    where organization_id = p_organization_id
      and request_key is null
      and created_at <= now() - interval '24 hours';

    select count(*) into v_count
    from public.email_send_attempts
    where organization_id = p_organization_id
      and created_at > now() - interval '24 hours';

    if v_count >= p_daily_limit then
        return null;
    end if;

    insert into public.email_send_attempts(organization_id, credential_id)
    values (p_organization_id, p_credential_id)
    returning id into v_attempt_id;
    return v_attempt_id;
end;
$$;

create or replace function public.reserve_idempotent_credential_email(
    p_organization_id uuid,
    p_credential_id uuid,
    p_daily_limit integer,
    p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_attempt public.email_send_attempts%rowtype;
    v_count bigint;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_daily_limit is null or p_daily_limit < 1 then
        raise exception 'Invalid daily email limit' using errcode = '22023';
    end if;
    if p_credential_id is null
       or p_request_key is null
       or p_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid credential email idempotency key' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('email-daily:' || p_organization_id::text, 0)
    );

    select * into v_attempt
    from public.email_send_attempts
    where organization_id = p_organization_id
      and credential_id = p_credential_id
      and request_key = p_request_key
    for update;
    if found then
        return jsonb_build_object(
            'attemptId', v_attempt.id,
            'created', false,
            'status', v_attempt.status
        );
    end if;

    delete from public.email_send_attempts
    where organization_id = p_organization_id
      and request_key is null
      and created_at <= now() - interval '24 hours';

    select count(*) into v_count
    from public.email_send_attempts
    where organization_id = p_organization_id
      and created_at > now() - interval '24 hours';
    if v_count >= p_daily_limit then
        return jsonb_build_object('throttled', true);
    end if;

    insert into public.email_send_attempts(
        organization_id, credential_id, request_key
    )
    values (
        p_organization_id, p_credential_id, p_request_key
    )
    returning * into v_attempt;

    return jsonb_build_object(
        'attemptId', v_attempt.id,
        'created', true,
        'status', v_attempt.status
    );
end;
$$;

revoke all on function public.reserve_idempotent_credential_email(uuid, uuid, integer, text)
    from public, anon, authenticated;
grant execute on function public.reserve_idempotent_credential_email(uuid, uuid, integer, text)
    to service_role;
