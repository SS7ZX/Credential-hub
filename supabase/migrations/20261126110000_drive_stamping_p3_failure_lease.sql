begin;

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
    if v_file.status = 'processing' and v_file.lease_expires_at > now() then
        raise exception 'Stamp file has an active processing lease';
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

commit;
