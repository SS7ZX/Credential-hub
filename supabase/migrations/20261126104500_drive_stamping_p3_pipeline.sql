begin;

create or replace function public.list_stampable_credentials(
    p_organization_id uuid,
    p_achievement_id uuid
)
returns table (
    credential_id uuid,
    serial_number text,
    recipient_id uuid,
    full_name text,
    email text,
    event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null
       or not private.has_org_role(
           p_organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;

    return query
    select c.id, c.serial_number, r.id, r.full_name, r.email, a.event_id
    from public.credentials c
    join public.recipients r
      on r.organization_id = c.organization_id
     and r.id = c.recipient_id
    join public.achievements a
      on a.organization_id = c.organization_id
     and a.id = c.achievement_id
    where c.organization_id = p_organization_id
      and c.achievement_id = p_achievement_id
      and c.status = 'issued'
      and r.anonymized_at is null
      and r.anonymization_requested_at is null
    order by c.issued_at, c.id;
end;
$$;

create or replace function public.fail_stamp_file(
    p_stamp_file_id uuid,
    p_error_code public.stamp_file_error_code
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_file public.stamp_files%rowtype;
    v_run public.stamp_runs%rowtype;
    v_processed integer;
    v_succeeded integer;
    v_failed integer;
    v_final_status public.stamp_run_status;
begin
    if p_error_code is null then
        raise exception 'A sanitized stamping error code is required';
    end if;

    select * into v_file
    from public.stamp_files
    where id = p_stamp_file_id
    for update;
    if not found then raise exception 'Stamp file not found'; end if;
    if auth.uid() is null
       or not private.has_org_role(
           v_file.organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;
    if v_file.status in ('completed', 'deleted', 'failed') then
        return;
    end if;

    select * into v_run
    from public.stamp_runs
    where id = v_file.stamp_run_id
    for update;

    update public.stamp_files
    set status = 'failed',
        error_code = p_error_code,
        lease_expires_at = null,
        completed_at = now()
    where id = p_stamp_file_id;

    select
        count(*) filter (where sf.status in ('completed', 'failed'))::integer,
        count(*) filter (where sf.status = 'completed')::integer,
        count(*) filter (where sf.status = 'failed')::integer
    into v_processed, v_succeeded, v_failed
    from public.stamp_files sf
    where sf.stamp_run_id = v_file.stamp_run_id;

    v_final_status := case
        when v_processed < v_run.expected_file_count then 'processing'::public.stamp_run_status
        else 'completed_with_errors'::public.stamp_run_status
    end;

    update public.stamp_runs
    set processed_count = v_processed,
        succeeded_count = v_succeeded,
        failed_count = v_failed,
        status = v_final_status
    where id = v_file.stamp_run_id;

    if v_processed = v_run.expected_file_count then
        insert into public.audit_logs(
            organization_id, action, entity_type, entity_id, metadata
        )
        values (
            v_run.organization_id, 'stamp.run_completed', 'stamp_run', v_run.id,
            jsonb_build_object('succeeded_count', v_succeeded, 'failed_count', v_failed)
        );
    end if;
end;
$$;

revoke all on function public.list_stampable_credentials(uuid, uuid)
    from public, anon;
revoke all on function public.fail_stamp_file(uuid, public.stamp_file_error_code)
    from public, anon;
grant execute on function public.list_stampable_credentials(uuid, uuid)
    to authenticated;
grant execute on function public.fail_stamp_file(uuid, public.stamp_file_error_code)
    to authenticated;

commit;
