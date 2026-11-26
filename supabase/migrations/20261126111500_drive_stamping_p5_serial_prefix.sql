begin;

alter table public.organizations
    alter column serial_prefix set default 'CH';

update public.organizations
set serial_prefix = 'CH'
where serial_prefix = chr(84) || chr(83) || chr(81);

create or replace function public.create_organization(
    p_name text,
    p_slug text,
    p_did text,
    p_user_id uuid,
    p_serial_prefix text default 'CH'
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
    v_slug text := lower(trim(coalesce(p_slug, '')));
    v_serial_prefix text := upper(regexp_replace(trim(coalesce(p_serial_prefix, '')), '[^A-Za-z0-9]+', '-', 'g'));
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_user_id is null or not exists (
        select 1 from auth.users
        where id = p_user_id and email_confirmed_at is not null
    ) then
        raise exception 'Verified user is required' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_name, ''))) = 0 then
        raise exception 'Organization name is required';
    end if;
    if length(v_slug) > 100 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
        raise exception 'Invalid organization slug';
    end if;
    if p_did is null or p_did !~ '^did:web:[A-Za-z0-9.-]+(%3A[0-9]{1,5})?$' then
        raise exception 'Invalid organization DID' using errcode = '22023';
    end if;
    if v_serial_prefix = '' or length(v_serial_prefix) > 20 then
        raise exception 'Invalid organization serial prefix' using errcode = '22023';
    end if;

    insert into public.organizations(name, slug, did, serial_prefix, created_by)
    values (
        regexp_replace(trim(p_name), '\s+', ' ', 'g'),
        v_slug,
        p_did,
        v_serial_prefix,
        p_user_id
    )
    returning id into v_org_id;

    insert into public.organization_members(organization_id, user_id, role)
    values (v_org_id, p_user_id, 'owner');

    insert into public.status_lists(organization_id) values (v_org_id);

    insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id)
    values (v_org_id, p_user_id, 'organization.created', 'organization', v_org_id);
    return v_org_id;
end;
$$;

drop function public.create_organization(text, text, text, uuid);

revoke all on function public.create_organization(text, text, text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.create_organization(text, text, text, uuid, text)
    to service_role;

commit;
