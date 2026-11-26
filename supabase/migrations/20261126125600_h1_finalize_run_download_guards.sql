begin;

create or replace function public.get_stamp_file_download_path(
    p_organization_id uuid,
    p_stamp_run_id uuid,
    p_stamp_file_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_path text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;

    select sf.storage_path
    into v_path
    from public.stamp_files sf
    join public.recipients r
      on r.organization_id = sf.organization_id
     and r.id = sf.recipient_id
    where sf.organization_id = p_organization_id
      and sf.stamp_run_id = p_stamp_run_id
      and sf.id = p_stamp_file_id
      and sf.status = 'completed'
      and sf.storage_path is not null
      and r.anonymized_at is null
      and r.anonymization_requested_at is null;

    return v_path;
end;
$$;

create or replace function public.list_visible_stamp_run_files(
    p_organization_id uuid,
    p_stamp_run_id uuid
)
returns table (
    id uuid,
    status text,
    error_code text,
    credential_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;

    return query
    select sf.id, sf.status::text, sf.error_code::text, sf.credential_id
    from public.stamp_files sf
    join public.recipients r
      on r.organization_id = sf.organization_id
     and r.id = sf.recipient_id
    where sf.organization_id = p_organization_id
      and sf.stamp_run_id = p_stamp_run_id
      and sf.status <> 'deleted'
      and r.anonymized_at is null
      and r.anonymization_requested_at is null
    order by sf.created_at;
end;
$$;

revoke all on function public.get_stamp_file_download_path(uuid, uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.list_visible_stamp_run_files(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.get_stamp_file_download_path(uuid, uuid, uuid)
    to service_role;
grant execute on function public.list_visible_stamp_run_files(uuid, uuid)
    to service_role;

commit;
