-- =====================================================
-- CREDENTIALHUB INITIAL FOUNDATION
-- =====================================================

create extension if not exists pgcrypto;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create type public.organization_role as enum ('owner', 'admin', 'issuer', 'viewer');
create type public.credential_status as enum ('draft', 'issued', 'revoked', 'expired');
create type public.credential_visibility as enum ('public', 'unlisted');
create type public.issuance_batch_status as enum (
    'draft', 'queued', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled'
);
create type public.issuance_row_status as enum ('pending', 'succeeded', 'failed');
create type public.issuer_key_status as enum ('active', 'retired');

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    description text,
    website_url text,
    logo_url text,
    contact_email text,
    did text not null default 'did:web:tasdiqapp.com',
    status text not null default 'active',
    serial_prefix text not null default 'TSQ',
    next_serial_number bigint not null default 1,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint organizations_name_not_empty check (length(trim(name)) > 0),
    constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    constraint organizations_serial_positive check (next_serial_number > 0)
);

create table public.organization_members (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role public.organization_role not null,
    joined_at timestamptz not null default now(),
    unique (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members(user_id);
create index organization_members_org_idx on public.organization_members(organization_id);

create table public.organization_invitations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    email text not null,
    role public.organization_role not null,
    invited_by uuid not null references auth.users(id),
    expires_at timestamptz not null default (now() + interval '7 days'),
    accepted_at timestamptz,
    accepted_by uuid references auth.users(id),
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    constraint organization_invitation_email_normalized check (
        email = lower(trim(email)) and length(email) between 3 and 320
    ),
    constraint organization_invitation_role_not_owner check (role <> 'owner')
);

create unique index organization_invitation_pending_email_unique
    on public.organization_invitations(organization_id, email)
    where accepted_at is null and revoked_at is null;

create index organization_invitations_email_idx
    on public.organization_invitations(email, expires_at desc);

create table public.issuer_keys (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    kid text not null unique,
    algorithm text not null,
    public_jwk jsonb not null,
    status public.issuer_key_status not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, kid),
    constraint issuer_key_public_jwk_object check (jsonb_typeof(public_jwk) = 'object')
);

create table public.events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    name text not null,
    description text,
    event_date date,
    location text,
    status text not null default 'draft',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    constraint event_name_not_empty check (length(trim(name)) > 0)
);

create table public.achievements (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    event_id uuid,
    name text not null,
    description text not null,
    criteria_narrative text,
    criteria jsonb not null default '{}'::jsonb,
    image_url text,
    category text,
    status text not null default 'draft',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    constraint achievement_event_same_org
        foreign key (organization_id, event_id)
        references public.events(organization_id, id)
        on delete set null (event_id),
    constraint achievement_name_not_empty check (length(trim(name)) > 0),
    constraint achievement_criteria_object check (jsonb_typeof(criteria) = 'object')
);

create table public.certificate_templates (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    name text not null,
    layout jsonb not null default '{}'::jsonb,
    background_path text,
    orientation text not null default 'landscape',
    page_size text not null default 'A4',
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    constraint certificate_template_layout_object check (jsonb_typeof(layout) = 'object')
);

create table public.recipients (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    full_name text,
    email text,
    email_hash text,
    salt text,
    external_id text,
    anonymized_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    constraint recipient_identity_present check (
        (full_name is not null and email is not null)
        or anonymized_at is not null
    )
);

create unique index recipients_org_email_unique
    on public.recipients (organization_id, email)
    where email is not null;

create index recipients_org_idx on public.recipients(organization_id);

create table public.issuance_batches (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    event_id uuid,
    achievement_id uuid not null,
    created_by uuid not null references auth.users(id),
    source_filename text,
    options jsonb not null default '{}'::jsonb,
    status public.issuance_batch_status not null default 'draft',
    total integer not null default 0,
    processed_count integer not null default 0,
    succeeded integer not null default 0,
    failed integer not null default 0,
    idempotency_key text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    constraint batch_counts_valid check (
        total >= 0 and processed_count >= 0 and succeeded >= 0 and failed >= 0
        and processed_count <= total
        and succeeded + failed <= processed_count
    ),
    constraint batch_options_object check (jsonb_typeof(options) = 'object'),
    foreign key (organization_id, event_id)
        references public.events(organization_id, id)
        on delete restrict,
    foreign key (organization_id, achievement_id)
        references public.achievements(organization_id, id)
        on delete restrict,
    unique (organization_id, id),
    unique (organization_id, idempotency_key)
);

create index issuance_batches_org_idx on public.issuance_batches(organization_id);
create index issuance_batches_status_idx on public.issuance_batches(status);

create table public.issuance_rows (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    batch_id uuid not null,
    row_number integer not null,
    payload jsonb not null,
    idempotency_key text not null,
    status public.issuance_row_status not null default 'pending',
    last_error text,
    credential_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (batch_id, row_number),
    unique (organization_id, id),
    foreign key (organization_id, batch_id)
        references public.issuance_batches(organization_id, id)
        on delete cascade,
    unique (idempotency_key),
    constraint issuance_row_payload_object check (jsonb_typeof(payload) = 'object')
);

create table public.credentials (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    batch_id uuid,
    achievement_id uuid,
    recipient_id uuid,
    status public.credential_status not null default 'draft',
    issued_at timestamptz,
    expires_at timestamptz,
    credential_json jsonb,
    jws text,
    kid text,
    visibility public.credential_visibility not null default 'unlisted',
    serial_number text not null unique,
    content_hash text,
    pdf_path text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, batch_id)
        references public.issuance_batches(organization_id, id)
        on delete restrict,
    foreign key (organization_id, achievement_id)
        references public.achievements(organization_id, id)
        on delete restrict,
    foreign key (organization_id, recipient_id)
        references public.recipients(organization_id, id)
        on delete restrict,
    foreign key (organization_id, kid)
        references public.issuer_keys(organization_id, kid)
        on delete restrict
);

create index credentials_org_idx on public.credentials(organization_id);
create index credentials_status_idx on public.credentials(status);
create index credentials_batch_idx on public.credentials(batch_id);
create index credentials_recipient_idx on public.credentials(recipient_id);

alter table public.issuance_rows
    add constraint issuance_rows_credential_fk
    foreign key (organization_id, credential_id)
    references public.credentials(organization_id, id)
    on delete set null (credential_id);

create table public.status_lists (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null unique references public.organizations(id) on delete restrict,
    purpose text not null default 'revocation',
    revoked_credential_ids jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    constraint status_list_revoked_ids_array check (jsonb_typeof(revoked_credential_ids) = 'array')
);

create table public.revocations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    credential_id uuid not null,
    reason text not null,
    revoked_by uuid references auth.users(id),
    revoked_at timestamptz not null default now(),
    constraint revocation_reason_not_empty check (length(trim(reason)) > 0),
    unique (organization_id, credential_id),
    foreign key (organization_id, credential_id)
        references public.credentials(organization_id, id)
        on delete restrict
);

create table public.email_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    credential_id uuid,
    provider_id text,
    type text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    foreign key (organization_id, credential_id)
        references public.credentials(organization_id, id)
        on delete set null (credential_id)
);

create table public.email_send_attempts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    credential_id uuid,
    created_at timestamptz not null default now(),
    status text not null default 'reserved',
    constraint email_send_attempt_status check (status in ('reserved', 'sent', 'failed')),
    foreign key (organization_id, credential_id)
        references public.credentials(organization_id, id)
        on delete cascade
);

create index email_send_attempts_org_created_idx
    on public.email_send_attempts(organization_id, created_at desc);

create table public.recipient_access_tokens (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    credential_id uuid not null,
    recipient_id uuid not null,
    token_hash text not null unique,
    recipient_identity_hash text not null,
    expires_at timestamptz not null,
    redeemed_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    foreign key (organization_id, credential_id)
        references public.credentials(organization_id, id)
        on delete cascade,
    foreign key (organization_id, recipient_id)
        references public.recipients(organization_id, id)
        on delete cascade,
    constraint recipient_access_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

create index recipient_access_tokens_credential_idx
    on public.recipient_access_tokens(organization_id, credential_id, created_at desc);

create table public.recipient_management_sessions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    credential_id uuid not null,
    recipient_id uuid not null,
    token_hash text not null unique,
    recipient_identity_hash text not null,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    foreign key (organization_id, credential_id)
        references public.credentials(organization_id, id)
        on delete cascade,
    foreign key (organization_id, recipient_id)
        references public.recipients(organization_id, id)
        on delete cascade,
    constraint recipient_management_session_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

create index recipient_management_sessions_credential_idx
    on public.recipient_management_sessions(organization_id, credential_id, created_at desc);

create table private.credential_name_consent_events (
    event_id bigint generated always as identity primary key,
    organization_id uuid not null,
    credential_id uuid not null,
    recipient_id uuid not null,
    scope text not null check (scope in ('masked', 'full')),
    event_type text not null check (event_type in ('granted', 'withdrawn')),
    notice_version text not null check (length(trim(notice_version)) between 1 and 64),
    occurred_at timestamptz not null default clock_timestamp(),
    foreign key (organization_id, credential_id)
        references public.credentials(organization_id, id)
        on delete cascade,
    foreign key (organization_id, recipient_id)
        references public.recipients(organization_id, id)
        on delete cascade
);

create index credential_name_consent_events_latest_idx
    on private.credential_name_consent_events(
        organization_id, credential_id, scope, event_id desc
    );

alter table private.credential_name_consent_events enable row level security;
revoke all on private.credential_name_consent_events
    from public, anon, authenticated, service_role;

create table public.verification_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    credential_id uuid,
    method text not null,
    result text not null,
    ip_hash text,
    created_at timestamptz not null default now(),
    foreign key (organization_id, credential_id)
        references public.credentials(organization_id, id)
        on delete set null (credential_id)
);

create table public.api_rate_limits (
    bucket_key text primary key,
    window_started_at timestamptz not null,
    request_count integer not null check (request_count > 0),
    updated_at timestamptz not null default now()
);

create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid references public.organizations(id),
    actor_id uuid references auth.users(id),
    action text not null,
    entity_type text not null,
    entity_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

-- =====================================================
-- PROFILE AND TIMESTAMP HELPERS
-- =====================================================

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    insert into public.profiles(id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
    return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function private.handle_new_user();

revoke all on function private.handle_new_user() from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare r record;
begin
    for r in
        select table_name
        from information_schema.columns
        where table_schema = 'public'
          and column_name = 'updated_at'
          and table_name in (
              'profiles','organizations','issuer_keys','events','achievements',
              'certificate_templates','recipients','issuance_rows','credentials'
          )
    loop
        execute format(
            'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
            r.table_name || '_updated_at',
            r.table_name
        );
    end loop;
end;
$$;

create or replace function private.is_org_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.organization_members m
        where m.organization_id = p_organization_id
          and m.user_id = auth.uid()
    );
$$;

create or replace function private.has_org_role(p_organization_id uuid, p_roles public.organization_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.organization_members m
        where m.organization_id = p_organization_id
          and m.user_id = auth.uid()
          and m.role = any(p_roles)
    );
$$;

create or replace function private.user_has_org_role(
    p_user_id uuid,
    p_organization_id uuid,
    p_roles public.organization_role[]
)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.organization_members m
        where m.organization_id = p_organization_id
          and m.user_id = p_user_id
          and m.role = any(p_roles)
    );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.organization_role[]) from public, anon;
revoke all on function private.user_has_org_role(uuid, uuid, public.organization_role[]) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.organization_role[]) to authenticated;

-- =====================================================
-- ATOMIC ADMIN RPCS
-- =====================================================

create or replace function public.create_organization(
    p_name text,
    p_slug text,
    p_user_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
    v_slug text := lower(trim(coalesce(p_slug, '')));
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

    insert into public.organizations(name, slug, created_by)
    values (regexp_replace(trim(p_name), '\s+', ' ', 'g'), v_slug, p_user_id)
    returning id into v_org_id;

    insert into public.organization_members(organization_id, user_id, role)
    values (v_org_id, p_user_id, 'owner');

    insert into public.status_lists(organization_id) values (v_org_id);

    insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id)
    values (v_org_id, p_user_id, 'organization.created', 'organization', v_org_id);
    return v_org_id;
end;
$$;

revoke all on function public.create_organization(text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_organization(text, text, uuid) to service_role;

create or replace function public.create_organization_invitation(
    p_organization_id uuid,
    p_email text,
    p_role public.organization_role,
    p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_email text := lower(trim(coalesce(p_email, '')));
    v_invitation_id uuid;
    v_organization_name text;
    v_has_account boolean;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if not private.user_has_org_role(
        p_actor_id,
        p_organization_id,
        array['owner']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or length(v_email) > 320 then
        raise exception 'Invalid invitation email' using errcode = '22023';
    end if;
    if p_role is null or p_role not in ('admin', 'issuer', 'viewer') then
        raise exception 'Invalid invitation role' using errcode = '22023';
    end if;

    select name into v_organization_name
    from public.organizations
    where id = p_organization_id;
    if not found then
        raise exception 'Organization not found';
    end if;

    if exists (
        select 1
        from auth.users u
        join public.organization_members m
          on m.organization_id = p_organization_id
         and m.user_id = u.id
        where lower(u.email) = v_email
    ) then
        raise exception 'User is already a member';
    end if;

    update public.organization_invitations
    set revoked_at = now()
    where organization_id = p_organization_id
      and email = v_email
      and accepted_at is null
      and revoked_at is null;

    insert into public.organization_invitations(
        organization_id, email, role, invited_by
    )
    values (p_organization_id, v_email, p_role, p_actor_id)
    returning id into v_invitation_id;

    select exists(select 1 from auth.users where lower(email) = v_email)
    into v_has_account;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        p_organization_id, p_actor_id, 'organization.invitation_created',
        'organization_invitation', v_invitation_id,
        jsonb_build_object('role', p_role::text)
    );

    return jsonb_build_object(
        'id', v_invitation_id,
        'email', v_email,
        'role', p_role::text,
        'organizationName', v_organization_name,
        'hasAccount', v_has_account
    );
end;
$$;

revoke all on function public.create_organization_invitation(
    uuid, text, public.organization_role, uuid
) from public, anon, authenticated;
grant execute on function public.create_organization_invitation(
    uuid, text, public.organization_role, uuid
) to service_role;

create or replace function public.accept_organization_invitation(
    p_invitation_id uuid,
    p_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_invitation public.organization_invitations%rowtype;
    v_user_email text;
    v_organization_name text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_invitation_id is null or p_user_id is null then
        raise exception 'Invitation and verified user are required' using errcode = '22023';
    end if;

    select * into v_invitation
    from public.organization_invitations
    where id = p_invitation_id
    for update;
    if not found then
        raise exception 'Invitation is invalid or expired';
    end if;

    select lower(email) into v_user_email
    from auth.users
    where id = p_user_id
      and email_confirmed_at is not null;
    if v_user_email is null or v_user_email <> v_invitation.email then
        raise exception 'A verified matching email account is required' using errcode = '42501';
    end if;

    select name into v_organization_name
    from public.organizations
    where id = v_invitation.organization_id;
    if not found then
        raise exception 'Organization not found';
    end if;

    if v_invitation.accepted_at is not null then
        if v_invitation.accepted_by <> p_user_id then
            raise exception 'Invitation is invalid or expired';
        end if;
        return jsonb_build_object(
            'organizationId', v_invitation.organization_id,
            'organizationName', v_organization_name,
            'role', v_invitation.role::text
        );
    end if;
    if v_invitation.revoked_at is not null or v_invitation.expires_at <= now() then
        raise exception 'Invitation is invalid or expired';
    end if;
    if exists (
        select 1 from public.organization_members
        where organization_id = v_invitation.organization_id
          and user_id = p_user_id
    ) then
        raise exception 'User is already a member';
    end if;

    insert into public.organization_members(organization_id, user_id, role)
    values (v_invitation.organization_id, p_user_id, v_invitation.role);

    update public.organization_invitations
    set accepted_at = now(), accepted_by = p_user_id
    where id = p_invitation_id;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        v_invitation.organization_id, p_user_id, 'organization.invitation_accepted',
        'organization_invitation', p_invitation_id,
        jsonb_build_object('role', v_invitation.role::text)
    );

    return jsonb_build_object(
        'organizationId', v_invitation.organization_id,
        'organizationName', v_organization_name,
        'role', v_invitation.role::text
    );
end;
$$;

revoke all on function public.accept_organization_invitation(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.accept_organization_invitation(uuid, uuid)
    to service_role;

create or replace function public.create_recipient_access_token(
    p_credential_id uuid,
    p_token_hash text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_organization_id uuid;
    v_recipient_id uuid;
    v_recipient_email text;
    v_recipient_name text;
    v_identity_hash text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid access token hash';
    end if;

    select c.organization_id, c.recipient_id, r.email, r.full_name, r.email_hash
    into v_organization_id, v_recipient_id, v_recipient_email, v_recipient_name, v_identity_hash
    from public.credentials c
    join public.recipients r
      on r.organization_id = c.organization_id
     and r.id = c.recipient_id
    where c.id = p_credential_id
      and c.status = 'issued'
      and r.email is not null
      and r.email_hash is not null
      and r.anonymized_at is null
    for update of c, r;

    if not found then
        raise exception 'Issued credential recipient is unavailable';
    end if;

    update public.recipient_access_tokens
    set revoked_at = now()
    where credential_id = p_credential_id
      and redeemed_at is null
      and revoked_at is null;

    update public.recipient_management_sessions
    set revoked_at = now()
    where credential_id = p_credential_id
      and revoked_at is null;

    insert into public.recipient_access_tokens(
        organization_id, credential_id, recipient_id, token_hash,
        recipient_identity_hash, expires_at
    )
    values (
        v_organization_id, p_credential_id, v_recipient_id, p_token_hash,
        v_identity_hash, now() + interval '30 minutes'
    );

    return jsonb_build_object('email', v_recipient_email, 'name', v_recipient_name);
end;
$$;

revoke all on function public.create_recipient_access_token(uuid, text)
    from public, anon, authenticated;
grant execute on function public.create_recipient_access_token(uuid, text)
    to service_role;

create or replace function public.redeem_recipient_access_token(
    p_token_hash text,
    p_session_hash text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_token public.recipient_access_tokens%rowtype;
    v_serial_number text;
    v_visibility public.credential_visibility;
    v_issued_at timestamptz;
    v_achievement_name text;
    v_masked_name_consent boolean;
    v_full_name_consent boolean;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
       or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid access token';
    end if;

    select * into v_token
    from public.recipient_access_tokens
    where token_hash = p_token_hash
    for update;

    if not found or v_token.redeemed_at is not null or v_token.revoked_at is not null
       or v_token.expires_at <= now() then
        raise exception 'Access link is invalid, expired, or already used';
    end if;

    select c.serial_number, c.visibility, c.issued_at, a.name
    into v_serial_number, v_visibility, v_issued_at, v_achievement_name
    from public.credentials c
    join public.recipients r
      on r.organization_id = c.organization_id
     and r.id = c.recipient_id
    left join public.achievements a
      on a.organization_id = c.organization_id
     and a.id = c.achievement_id
    where c.organization_id = v_token.organization_id
      and c.id = v_token.credential_id
      and c.recipient_id = v_token.recipient_id
      and c.status = 'issued'
      and r.email is not null
      and r.email_hash = v_token.recipient_identity_hash
      and r.anonymized_at is null;

    if not found then
        raise exception 'Access link is invalid, expired, or already used';
    end if;

    update public.recipient_access_tokens
    set redeemed_at = now()
    where id = v_token.id;

    delete from public.recipient_management_sessions
    where credential_id = v_token.credential_id
      and (expires_at <= now() or revoked_at is not null);

    insert into public.recipient_management_sessions(
        organization_id, credential_id, recipient_id, token_hash,
        recipient_identity_hash, expires_at
    )
    values (
        v_token.organization_id, v_token.credential_id, v_token.recipient_id,
        p_session_hash, v_token.recipient_identity_hash, now() + interval '15 minutes'
    );

    insert into public.audit_logs(
        organization_id, action, entity_type, entity_id, metadata
    )
    values (
        v_token.organization_id, 'recipient.access_link_redeemed', 'credential',
        v_token.credential_id, jsonb_build_object('method', 'email_link')
    );

    select coalesce((
        select e.event_type = 'granted'
        from private.credential_name_consent_events e
        where e.organization_id = v_token.organization_id
          and e.credential_id = v_token.credential_id
          and e.scope = 'masked'
        order by e.event_id desc
        limit 1
    ), false)
    into v_masked_name_consent;

    select coalesce((
        select e.event_type = 'granted'
        from private.credential_name_consent_events e
        where e.organization_id = v_token.organization_id
          and e.credential_id = v_token.credential_id
          and e.scope = 'full'
        order by e.event_id desc
        limit 1
    ), false)
    into v_full_name_consent;

    return jsonb_build_object(
        'credentialId', v_token.credential_id,
        'serialNumber', v_serial_number,
        'visibility', v_visibility,
        'issuedAt', v_issued_at,
        'achievementName', v_achievement_name,
        'maskedNameConsent', v_masked_name_consent,
        'fullNameConsent', v_full_name_consent
    );
end;
$$;

revoke all on function public.redeem_recipient_access_token(text, text)
    from public, anon, authenticated;
grant execute on function public.redeem_recipient_access_token(text, text)
    to service_role;

create or replace function public.set_recipient_credential_visibility(
    p_session_hash text,
    p_visibility public.credential_visibility
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_organization_id uuid;
    v_credential_id uuid;
    v_serial_number text;
    v_visibility public.credential_visibility;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
       or p_visibility is null then
        raise exception 'Invalid recipient visibility request';
    end if;

    update public.credentials c
    set visibility = p_visibility,
        updated_at = now()
    from public.recipient_management_sessions s
    join public.recipients r
      on r.organization_id = s.organization_id
     and r.id = s.recipient_id
    where s.token_hash = p_session_hash
      and s.expires_at > now()
      and s.revoked_at is null
      and c.organization_id = s.organization_id
      and c.id = s.credential_id
      and c.recipient_id = s.recipient_id
      and c.status = 'issued'
      and r.email is not null
      and r.email_hash = s.recipient_identity_hash
      and r.anonymized_at is null
    returning c.organization_id, c.id, c.serial_number, c.visibility
    into v_organization_id, v_credential_id, v_serial_number, v_visibility;

    if not found then
        raise exception 'Recipient management session is invalid or expired';
    end if;

    insert into public.audit_logs(
        organization_id, action, entity_type, entity_id, metadata
    )
    values (
        v_organization_id, 'credential.visibility_changed_by_recipient', 'credential',
        v_credential_id,
        jsonb_build_object('visibility', v_visibility::text, 'method', 'email_link')
    );

    return jsonb_build_object(
        'credentialId', v_credential_id,
        'serialNumber', v_serial_number,
        'visibility', v_visibility
    );
end;
$$;

revoke all on function public.set_recipient_credential_visibility(text, public.credential_visibility)
    from public, anon, authenticated;
grant execute on function public.set_recipient_credential_visibility(text, public.credential_visibility)
    to service_role;

create or replace function public.record_recipient_credential_name_consent(
    p_session_hash text,
    p_masked_granted boolean,
    p_full_granted boolean,
    p_notice_version text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_organization_id uuid;
    v_credential_id uuid;
    v_recipient_id uuid;
    v_scope text;
    v_requested boolean;
    v_current boolean;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
       or p_masked_granted is null or p_full_granted is null
       or p_notice_version is null
       or length(trim(p_notice_version)) not between 1 and 64 then
        raise exception 'Invalid recipient name consent request' using errcode = '22023';
    end if;

    select s.organization_id, s.credential_id, s.recipient_id
    into v_organization_id, v_credential_id, v_recipient_id
    from public.recipient_management_sessions s
    join public.credentials c
      on c.organization_id = s.organization_id
     and c.id = s.credential_id
     and c.recipient_id = s.recipient_id
    join public.recipients r
      on r.organization_id = s.organization_id
     and r.id = s.recipient_id
    where s.token_hash = p_session_hash
      and s.expires_at > now()
      and s.revoked_at is null
      and s.recipient_identity_hash = r.email_hash
      and r.email is not null
      and r.anonymized_at is null
      and c.status = 'issued'
    for update of s;

    if not found then
        raise exception 'Recipient management session is invalid or expired';
    end if;

    foreach v_scope in array array['masked', 'full'] loop
        v_requested := case v_scope
            when 'masked' then p_masked_granted
            else p_full_granted
        end;

        select coalesce((
            select e.event_type = 'granted'
            from private.credential_name_consent_events e
            where e.organization_id = v_organization_id
              and e.credential_id = v_credential_id
              and e.scope = v_scope
            order by e.event_id desc
            limit 1
        ), false)
        into v_current;

        if v_requested is distinct from v_current then
            insert into private.credential_name_consent_events(
                organization_id, credential_id, recipient_id,
                scope, event_type, notice_version
            )
            values (
                v_organization_id, v_credential_id, v_recipient_id,
                v_scope, case when v_requested then 'granted' else 'withdrawn' end,
                trim(p_notice_version)
            );

            insert into public.audit_logs(
                organization_id, action, entity_type, entity_id, metadata
            )
            values (
                v_organization_id,
                case when v_requested
                    then 'recipient.name_consent.granted'
                    else 'recipient.name_consent.withdrawn'
                end,
                'credential',
                v_credential_id,
                jsonb_build_object(
                    'scope', v_scope,
                    'noticeVersion', trim(p_notice_version),
                    'method', 'recipient_management_session'
                )
            );
        end if;
    end loop;

    return jsonb_build_object(
        'credentialId', v_credential_id,
        'maskedNameConsent', p_masked_granted,
        'fullNameConsent', p_full_granted
    );
end;
$$;

revoke all on function public.record_recipient_credential_name_consent(
    text, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.record_recipient_credential_name_consent(
    text, boolean, boolean, text
) to service_role;

create or replace function public.get_credential_name_consent(p_credential_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_full_name text;
    v_masked_granted boolean;
    v_full_granted boolean;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_credential_id is null then
        raise exception 'Credential ID is required' using errcode = '22023';
    end if;

    select r.full_name
    into v_full_name
    from public.credentials c
    join public.recipients r
      on r.organization_id = c.organization_id
     and r.id = c.recipient_id
    where c.id = p_credential_id
      and c.status = 'issued'
      and c.visibility in ('public', 'unlisted')
      and r.anonymized_at is null;

    if not found then
        return jsonb_build_object(
            'fullName', null,
            'maskedNameConsent', false,
            'fullNameConsent', false
        );
    end if;

    select coalesce((
        select e.event_type = 'granted'
        from private.credential_name_consent_events e
        join public.credentials c
          on c.organization_id = e.organization_id
         and c.id = e.credential_id
        where c.id = p_credential_id
          and e.scope = 'masked'
        order by e.event_id desc
        limit 1
    ), false)
    into v_masked_granted;

    select coalesce((
        select e.event_type = 'granted'
        from private.credential_name_consent_events e
        join public.credentials c
          on c.organization_id = e.organization_id
         and c.id = e.credential_id
        where c.id = p_credential_id
          and e.scope = 'full'
        order by e.event_id desc
        limit 1
    ), false)
    into v_full_granted;

    return jsonb_build_object(
        'fullName', v_full_name,
        'maskedNameConsent', v_masked_granted,
        'fullNameConsent', v_full_granted
    );
end;
$$;

revoke all on function public.get_credential_name_consent(uuid)
    from public, anon, authenticated;
grant execute on function public.get_credential_name_consent(uuid)
    to service_role;

create or replace function public.add_organization_member_by_email(
    p_organization_id uuid,
    p_email text,
    p_role public.organization_role
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    v_user_id uuid;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if not private.has_org_role(
        p_organization_id,
        array['owner']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;
    if p_role not in ('admin', 'issuer', 'viewer') then
        raise exception 'Invalid member role';
    end if;
    if length(trim(coalesce(p_email, ''))) = 0 then
        raise exception 'Member email is required';
    end if;

    select id into v_user_id
    from auth.users
    where lower(email) = lower(trim(p_email));

    if v_user_id is null then raise exception 'User account not found'; end if;
    if v_user_id = auth.uid() then raise exception 'Cannot add yourself as a member'; end if;

    insert into public.organization_members(organization_id, user_id, role)
    values (p_organization_id, v_user_id, p_role);

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        p_organization_id, auth.uid(), 'organization.member_added',
        'organization_member', v_user_id, jsonb_build_object('role', p_role::text)
    );
    return v_user_id;
end;
$$;

revoke all on function public.add_organization_member_by_email(
    uuid, text, public.organization_role
) from public, anon;
grant execute on function public.add_organization_member_by_email(
    uuid, text, public.organization_role
) to authenticated;

create or replace function public.allocate_serial(p_organization_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
    v_prefix text;
    v_number bigint;
begin
    if not private.has_org_role(p_organization_id, array['owner','admin','issuer']::public.organization_role[]) then
        raise exception 'Insufficient organization role';
    end if;

    update public.organizations
    set next_serial_number = next_serial_number + 1
    where id = p_organization_id
    returning serial_prefix, next_serial_number - 1 into v_prefix, v_number;

    if v_prefix is null then raise exception 'Organization not found'; end if;
    return v_prefix || '-' || extract(year from now())::text || '-' ||
           lpad(v_number::text, 6, '0');
end;
$$;

revoke all on function public.allocate_serial(uuid) from public, anon;
grant execute on function public.allocate_serial(uuid) to authenticated;

create or replace function public.persist_issuance_row(
    p_actor_id uuid,
    p_batch_id uuid,
    p_row_number integer,
    p_payload jsonb,
    p_idempotency_key text,
    p_full_name text,
    p_email text,
    p_email_hash text,
    p_salt text,
    p_duplicate_policy text,
    p_credential_id uuid,
    p_issued_at timestamptz,
    p_expires_at timestamptz,
    p_visibility public.credential_visibility,
    p_credential_json jsonb,
    p_jws text,
    p_kid text,
    p_content_hash text,
    p_pdf_path text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
    v_achievement_id uuid;
    v_recipient_id uuid;
    v_existing_credential_id uuid;
    v_normalized_email text;
    v_normalized_name text;
    v_credential_id uuid;
    v_serial_prefix text;
    v_serial_number bigint;
    v_existing_row public.issuance_rows%rowtype;
begin
    v_credential_id := coalesce(p_credential_id, gen_random_uuid());

    select b.organization_id, b.achievement_id
    into v_org_id, v_achievement_id
    from public.issuance_batches b
    where b.id = p_batch_id;

    if v_org_id is null then raise exception 'Issuance batch not found'; end if;
    if not private.user_has_org_role(
        p_actor_id,
        v_org_id,
        array['owner','admin','issuer']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;
    if p_duplicate_policy not in ('skip', 'reissue', 'error') then
        raise exception 'Invalid duplicate policy';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    select * into v_existing_row
    from public.issuance_rows
    where idempotency_key = p_idempotency_key
    for update;

    if found and v_existing_row.status = 'succeeded' then
        return jsonb_build_object(
            'outcome', 'replayed',
            'credential_id', v_existing_row.credential_id
        );
    end if;

    v_normalized_email := lower(trim(p_email));
    v_normalized_name := regexp_replace(trim(p_full_name), '[[:space:]]+', ' ', 'g');

    select id into v_recipient_id
        from public.recipients
        where organization_id = v_org_id
          and email = v_normalized_email
        limit 1;

    if v_recipient_id is null then
        insert into public.recipients(
            organization_id, full_name, email, email_hash, salt
        )
        values (
            v_org_id, v_normalized_name, v_normalized_email,
            p_email_hash, p_salt
        )
        returning id into v_recipient_id;
    end if;

    select c.id into v_existing_credential_id
    from public.credentials c
    where c.organization_id = v_org_id
      and c.achievement_id = v_achievement_id
      and c.recipient_id = v_recipient_id
      and c.status = 'issued'
    limit 1;

    if v_existing_credential_id is not null and p_duplicate_policy = 'skip' then
        insert into public.issuance_rows(
            organization_id, batch_id, row_number, payload, idempotency_key, status, last_error
        )
        values (
            v_org_id, p_batch_id, p_row_number, p_payload, p_idempotency_key,
            'succeeded', 'Skipped duplicate recipient'
        )
        on conflict (idempotency_key) do update
        set status = 'succeeded',
            last_error = 'Skipped duplicate recipient',
            credential_id = v_existing_credential_id,
            updated_at = now();

        update public.issuance_batches
        set processed_count = processed_count
                + case when v_existing_row.status is null then 1 else 0 end,
            succeeded = succeeded
                + case when v_existing_row.status is distinct from 'succeeded' then 1 else 0 end,
            failed = failed
                - case when v_existing_row.status = 'failed' then 1 else 0 end
        where id = p_batch_id;

        return jsonb_build_object(
            'outcome', 'skipped',
            'credential_id', v_existing_credential_id
        );
    end if;

    if v_existing_credential_id is not null and p_duplicate_policy = 'error' then
        raise exception 'Duplicate recipient';
    end if;

    update public.organizations
    set next_serial_number = next_serial_number + 1
    where id = v_org_id
    returning serial_prefix, next_serial_number - 1
    into v_serial_prefix, v_serial_number;

    if v_serial_prefix is null then raise exception 'Organization not found'; end if;

    insert into public.credentials(
        id, organization_id, batch_id, achievement_id, recipient_id,
        status, issued_at, expires_at, credential_json, jws, kid,
        visibility, serial_number, content_hash, pdf_path
    )
    values (
        v_credential_id,
        v_org_id, p_batch_id, v_achievement_id, v_recipient_id,
        'issued', p_issued_at, p_expires_at, p_credential_json, p_jws, p_kid,
        coalesce(p_visibility, 'unlisted'),
        v_serial_prefix || '-' || extract(year from now())::text || '-' ||
            lpad(v_serial_number::text, 6, '0'),
        p_content_hash, p_pdf_path
    )
    on conflict (id) do nothing;

    insert into public.issuance_rows(
        organization_id, batch_id, row_number, payload, idempotency_key, status,
        credential_id
    )
    values (
        v_org_id, p_batch_id, p_row_number, p_payload, p_idempotency_key,
        'succeeded', v_credential_id
    )
    on conflict (idempotency_key) do update
    set status = 'succeeded',
        last_error = null,
        credential_id = excluded.credential_id,
        updated_at = now();

    update public.issuance_batches
    set processed_count = processed_count
            + case when v_existing_row.status is null then 1 else 0 end,
        succeeded = succeeded
            + case when v_existing_row.status is distinct from 'succeeded' then 1 else 0 end,
        failed = failed
            - case when v_existing_row.status = 'failed' then 1 else 0 end
    where id = p_batch_id;

    return jsonb_build_object(
        'outcome', 'issued',
        'credential_id', v_credential_id,
        'serial_number', v_serial_prefix || '-' || extract(year from now())::text || '-' ||
            lpad(v_serial_number::text, 6, '0')
    );
end;
$$;

revoke all on function public.persist_issuance_row(
    uuid, uuid, integer, jsonb, text, text, text, text, text, text,
    uuid, timestamptz, timestamptz, public.credential_visibility,
    jsonb, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.persist_issuance_row(
    uuid, uuid, integer, jsonb, text, text, text, text, text, text,
    uuid, timestamptz, timestamptz, public.credential_visibility,
    jsonb, text, text, text, text
) to service_role;

create or replace function public.record_issuance_failure(
    p_actor_id uuid,
    p_batch_id uuid,
    p_row_number integer,
    p_payload jsonb,
    p_idempotency_key text,
    p_error text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
    v_previous_status public.issuance_row_status;
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

    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    select status into v_previous_status
    from public.issuance_rows
    where idempotency_key = p_idempotency_key
    for update;

    if v_previous_status = 'succeeded' then return; end if;

    insert into public.issuance_rows(
        organization_id, batch_id, row_number, payload, idempotency_key,
        status, last_error
    )
    values (
        v_org_id, p_batch_id, p_row_number, p_payload, p_idempotency_key,
        'failed', left(p_error, 500)
    )
    on conflict (idempotency_key) do update
    set status = 'failed',
        last_error = left(excluded.last_error, 500),
        updated_at = now();

    update public.issuance_batches
    set processed_count = processed_count
            + case when v_previous_status is null then 1 else 0 end,
        failed = failed
            + case when v_previous_status is distinct from 'failed' then 1 else 0 end,
        succeeded = succeeded
            - case when v_previous_status = 'succeeded' then 1 else 0 end
    where id = p_batch_id;
end;
$$;

revoke all on function public.record_issuance_failure(
    uuid, uuid, integer, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.record_issuance_failure(
    uuid, uuid, integer, jsonb, text, text
) to service_role;

create or replace function public.revoke_credential(
    p_credential_id uuid,
    p_reason text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
    v_actor uuid := auth.uid();
begin
    if length(trim(coalesce(p_reason, ''))) = 0 then
        raise exception 'Revocation reason is required';
    end if;

    select organization_id into v_org_id
    from public.credentials
    where id = p_credential_id
    for update;

    if v_org_id is null then raise exception 'Credential not found'; end if;
    if not private.has_org_role(v_org_id, array['owner','admin']::public.organization_role[]) then
        raise exception 'Insufficient organization role';
    end if;

    update public.credentials
    set status = 'revoked', updated_at = now()
    where id = p_credential_id;

    update public.recipient_access_tokens
    set revoked_at = now()
    where credential_id = p_credential_id
      and redeemed_at is null
      and revoked_at is null;

    update public.recipient_management_sessions
    set revoked_at = now()
    where credential_id = p_credential_id
      and revoked_at is null;

    insert into public.revocations(organization_id, credential_id, reason, revoked_by)
    values (v_org_id, p_credential_id, trim(p_reason), v_actor)
    on conflict (organization_id, credential_id) do update
    set reason = excluded.reason, revoked_by = excluded.revoked_by, revoked_at = now();

    update public.status_lists
    set revoked_credential_ids =
            case
                when revoked_credential_ids @> to_jsonb(p_credential_id::text)
                    then revoked_credential_ids
                else revoked_credential_ids || to_jsonb(p_credential_id::text)
            end,
        updated_at = now()
    where organization_id = v_org_id;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        v_org_id, v_actor, 'credential.revoked', 'credential', p_credential_id,
        jsonb_build_object('reason', trim(p_reason))
    );
end;
$$;

revoke all on function public.revoke_credential(uuid, text) from public, anon;
grant execute on function public.revoke_credential(uuid, text) to authenticated;

create or replace function public.set_credential_visibility(
    p_credential_id uuid,
    p_visibility public.credential_visibility
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
    v_status public.credential_status;
begin
    select organization_id, status into v_org_id, v_status
    from public.credentials
    where id = p_credential_id
    for update;

    if v_org_id is null then raise exception 'Credential not found'; end if;
    if v_status <> 'issued' then raise exception 'Credential is not issued'; end if;
    if not private.has_org_role(
        v_org_id,
        array['owner','admin']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role';
    end if;

    update public.credentials
    set visibility = p_visibility, updated_at = now()
    where id = p_credential_id;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        v_org_id, auth.uid(), 'credential.visibility_changed', 'credential',
        p_credential_id, jsonb_build_object('visibility', p_visibility::text)
    );
end;
$$;

revoke all on function public.set_credential_visibility(
    uuid, public.credential_visibility
) from public, anon;
grant execute on function public.set_credential_visibility(
    uuid, public.credential_visibility
) to authenticated;

create or replace function public.anonymize_recipient(p_recipient_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
    v_email text;
    v_anonymized_at timestamptz;
begin
    select organization_id, email, anonymized_at
    into v_org_id, v_email, v_anonymized_at
    from public.recipients where id = p_recipient_id for update;

    if v_org_id is null then raise exception 'Recipient not found'; end if;
    if not private.has_org_role(v_org_id, array['owner','admin']::public.organization_role[]) then
        raise exception 'Insufficient organization role';
    end if;
    if v_anonymized_at is not null then return; end if;

    insert into private.credential_name_consent_events(
        organization_id, credential_id, recipient_id,
        scope, event_type, notice_version
    )
    select v_org_id, latest.credential_id, p_recipient_id,
           latest.scope, 'withdrawn', 'system-anonymization-v1'
    from (
        select distinct on (e.credential_id, e.scope)
            e.credential_id, e.scope, e.event_type
        from private.credential_name_consent_events e
        where e.organization_id = v_org_id
          and e.recipient_id = p_recipient_id
        order by e.credential_id, e.scope, e.event_id desc
    ) latest
    where latest.event_type = 'granted';

    insert into public.revocations(organization_id, credential_id, reason, revoked_by)
    select v_org_id, c.id, 'Recipient data anonymized', auth.uid()
    from public.credentials c
    where c.organization_id = v_org_id
      and c.recipient_id = p_recipient_id
    on conflict (organization_id, credential_id) do nothing;

    update public.status_lists sl
    set revoked_credential_ids = sl.revoked_credential_ids || coalesce((
        select jsonb_agg(to_jsonb(c.id::text))
        from public.credentials c
        where c.organization_id = v_org_id
          and c.recipient_id = p_recipient_id
          and not sl.revoked_credential_ids @> to_jsonb(c.id::text)
    ), '[]'::jsonb),
    updated_at = now()
    where sl.organization_id = v_org_id;

    update public.credentials
    set status = 'revoked',
        credential_json = null,
        jws = null,
        content_hash = null,
        pdf_path = null,
        updated_at = now()
    where organization_id = v_org_id
      and recipient_id = p_recipient_id;

    delete from public.recipient_access_tokens
    where organization_id = v_org_id
      and recipient_id = p_recipient_id;

    delete from public.recipient_management_sessions
    where organization_id = v_org_id
      and recipient_id = p_recipient_id;

    if v_email is not null then
        update public.issuance_rows
        set payload = '{}'::jsonb,
            idempotency_key = gen_random_uuid()::text,
            last_error = null,
            updated_at = now()
        where organization_id = v_org_id
          and payload ->> 'email' = v_email;
    end if;

    update public.email_events
    set payload = jsonb_build_object('redacted', true)
    where organization_id = v_org_id
      and credential_id in (
          select c.id from public.credentials c
          where c.organization_id = v_org_id
            and c.recipient_id = p_recipient_id
      );

    update public.recipients
    set full_name = null, email = null, email_hash = null, salt = null,
        anonymized_at = now()
    where id = p_recipient_id;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id
    )
    values (
        v_org_id, auth.uid(), 'recipient.anonymized', 'recipient', p_recipient_id
    );
end;
$$;

revoke all on function public.anonymize_recipient(uuid) from public, anon;
grant execute on function public.anonymize_recipient(uuid) to authenticated;

create or replace function public.consume_api_rate_limit(
    p_bucket_key text,
    p_limit integer,
    p_window_seconds integer
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
    v_count integer;
begin
    if p_limit < 1 or p_window_seconds < 1 then
        raise exception 'Invalid rate limit configuration';
    end if;

    insert into public.api_rate_limits(bucket_key, window_started_at, request_count)
    values (p_bucket_key, now(), 1)
    on conflict (bucket_key) do update
    set window_started_at = case
            when public.api_rate_limits.window_started_at
                + make_interval(secs => p_window_seconds) <= now()
            then now()
            else public.api_rate_limits.window_started_at
        end,
        request_count = case
            when public.api_rate_limits.window_started_at
                + make_interval(secs => p_window_seconds) <= now()
            then 1
            else public.api_rate_limits.request_count + 1
        end,
        updated_at = now()
    returning request_count into v_count;

    return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer)
    to service_role;

create or replace function public.reserve_email_send(
    p_organization_id uuid,
    p_credential_id uuid,
    p_daily_limit integer
)
returns uuid language plpgsql security definer set search_path = ''
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

revoke all on function public.reserve_email_send(uuid, uuid, integer)
    from public, anon, authenticated;
grant execute on function public.reserve_email_send(uuid, uuid, integer)
    to service_role;

create or replace function public.complete_email_send(
    p_attempt_id uuid,
    p_provider_id text,
    p_status text,
    p_detail text,
    p_sandbox boolean
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    v_attempt public.email_send_attempts%rowtype;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;
    if p_status is null or p_status not in ('sent', 'failed') then
        raise exception 'Invalid email attempt status' using errcode = '22023';
    end if;

    select * into v_attempt
    from public.email_send_attempts
    where id = p_attempt_id
    for update;
    if not found or v_attempt.status <> 'reserved' then
        raise exception 'Email reservation is unavailable';
    end if;

    update public.email_send_attempts
    set status = p_status
    where id = p_attempt_id;

    insert into public.email_events(
        organization_id, credential_id, provider_id, type, payload
    )
    values (
        v_attempt.organization_id,
        v_attempt.credential_id,
        p_provider_id,
        p_status,
        jsonb_build_object(
            'detail', p_detail,
            'mode', case when p_sandbox then 'sandbox' else 'live' end
        )
    );
end;
$$;

revoke all on function public.complete_email_send(uuid, text, text, text, boolean)
    from public, anon, authenticated;
grant execute on function public.complete_email_send(uuid, text, text, text, boolean)
    to service_role;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.issuer_keys enable row level security;
alter table public.events enable row level security;
alter table public.achievements enable row level security;
alter table public.certificate_templates enable row level security;
alter table public.recipients enable row level security;
alter table public.issuance_batches enable row level security;
alter table public.issuance_rows enable row level security;
alter table public.credentials enable row level security;
alter table public.status_lists enable row level security;
alter table public.revocations enable row level security;
alter table public.email_events enable row level security;
alter table public.email_send_attempts enable row level security;
alter table public.recipient_access_tokens enable row level security;
alter table public.recipient_management_sessions enable row level security;
alter table public.verification_events enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.audit_logs enable row level security;

create policy "own profile read" on public.profiles for select to authenticated
using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "member organization read" on public.organizations for select to authenticated
using (private.is_org_member(id));
create policy "admin organization update" on public.organizations for update to authenticated
using (private.has_org_role(id, array['owner','admin']::public.organization_role[]))
with check (private.has_org_role(id, array['owner','admin']::public.organization_role[]));

create policy "member list read" on public.organization_members for select to authenticated
using (private.is_org_member(organization_id));
create policy "owner member insert" on public.organization_members for insert to authenticated
with check (
    private.has_org_role(organization_id, array['owner']::public.organization_role[])
    and role <> 'owner'
);
create policy "owner member update" on public.organization_members for update to authenticated
using (
    private.has_org_role(organization_id, array['owner']::public.organization_role[])
    and role <> 'owner'
    and user_id <> auth.uid()
)
with check (
    private.has_org_role(organization_id, array['owner']::public.organization_role[])
    and role <> 'owner'
    and user_id <> auth.uid()
);
create policy "owner member delete" on public.organization_members for delete to authenticated
using (
    private.has_org_role(organization_id, array['owner']::public.organization_role[])
    and role <> 'owner'
);

create policy "member issuer keys read" on public.issuer_keys for select to authenticated
using (private.is_org_member(organization_id));
create policy "admin issuer keys write" on public.issuer_keys for all to authenticated
using (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]))
with check (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));

create policy "member events read" on public.events for select to authenticated
using (private.is_org_member(organization_id));
create policy "issuer events write" on public.events for all to authenticated
using (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]))
with check (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]));

create policy "member achievements read" on public.achievements for select to authenticated
using (private.is_org_member(organization_id));
create policy "issuer achievements write" on public.achievements for all to authenticated
using (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]))
with check (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]));

create policy "member templates read" on public.certificate_templates for select to authenticated
using (private.is_org_member(organization_id));
create policy "admin templates write" on public.certificate_templates for all to authenticated
using (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]))
with check (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));

create policy "pii recipient read" on public.recipients for select to authenticated
using (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]));
create policy "pii recipient write" on public.recipients for all to authenticated
using (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]))
with check (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]));

create policy "member batch read" on public.issuance_batches for select to authenticated
using (private.is_org_member(organization_id));
create policy "issuer batch write" on public.issuance_batches for all to authenticated
using (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]))
with check (private.has_org_role(organization_id, array['owner','admin','issuer']::public.organization_role[]));

create policy "member row read" on public.issuance_rows for select to authenticated
using (private.is_org_member(organization_id));

create policy "member credential read" on public.credentials for select to authenticated
using (private.is_org_member(organization_id));

create policy "admin status read" on public.status_lists for select to authenticated
using (private.is_org_member(organization_id));
create policy "admin revocation read" on public.revocations for select to authenticated
using (private.is_org_member(organization_id));
create policy "member email events read" on public.email_events for select to authenticated
using (private.is_org_member(organization_id));
create policy "member verification events read" on public.verification_events for select to authenticated
using (private.is_org_member(organization_id));
create policy "admin audit read" on public.audit_logs for select to authenticated
using (organization_id is not null and private.has_org_role(
    organization_id, array['owner','admin']::public.organization_role[]
));

-- Append-only audit log
create or replace function private.prevent_audit_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
    raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_append_only_update
before update on public.audit_logs for each row execute function private.prevent_audit_mutation();
create trigger audit_logs_append_only_delete
before delete on public.audit_logs for each row execute function private.prevent_audit_mutation();

-- =====================================================
-- EXPLICIT DATA API PRIVILEGES
-- =====================================================

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant select on public.organizations to authenticated;
grant update (name, description, website_url, logo_url, contact_email)
    on public.organizations to authenticated;
grant select, insert, update on public.organization_members to authenticated;
grant delete on public.organization_members to authenticated;
grant select, insert, update on public.issuer_keys to authenticated;
grant select, insert, update on public.events to authenticated;
grant select, insert, update on public.achievements to authenticated;
grant select, insert, update on public.certificate_templates to authenticated;
grant select, insert, update on public.recipients to authenticated;
grant select, insert, update on public.issuance_batches to authenticated;
grant select on public.issuance_rows to authenticated;
grant select on public.credentials to authenticated;
grant select on public.status_lists to authenticated;
grant select on public.revocations to authenticated;
grant select on public.email_events to authenticated;
grant select on public.verification_events to authenticated;
grant select on public.audit_logs to authenticated;

revoke all on public.email_send_attempts, public.recipient_access_tokens, public.recipient_management_sessions
    from public, anon, authenticated;

grant all privileges on all tables in schema public to service_role;
