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
        on delete restrict,
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
    public_name_consent boolean not null default false,
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

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.organization_role[]) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.organization_role[]) to authenticated;

-- =====================================================
-- ATOMIC ADMIN RPCS
-- =====================================================

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_org_id uuid;
begin
    if v_user_id is null then raise exception 'Authentication required'; end if;
    if length(trim(p_name)) = 0 then raise exception 'Organization name is required'; end if;
    if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid organization slug'; end if;

    insert into public.organizations(name, slug, created_by)
    values (trim(p_name), lower(p_slug), v_user_id)
    returning id into v_org_id;

    insert into public.organization_members(organization_id, user_id, role)
    values (v_org_id, v_user_id, 'owner');

    insert into public.status_lists(organization_id) values (v_org_id);

    insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id)
    values (v_org_id, v_user_id, 'organization.created', 'organization', v_org_id);
    return v_org_id;
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

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
    p_batch_id uuid,
    p_row_number integer,
    p_payload jsonb,
    p_idempotency_key text,
    p_full_name text,
    p_email text,
    p_email_hash text,
    p_salt text,
    p_public_name_consent boolean,
    p_duplicate_policy text,
    p_credential_id uuid,
    p_serial_number text,
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
begin
    v_credential_id := coalesce(p_credential_id, gen_random_uuid());

    select b.organization_id, b.achievement_id
    into v_org_id, v_achievement_id
    from public.issuance_batches b
    where b.id = p_batch_id;

    if v_org_id is null then raise exception 'Issuance batch not found'; end if;
    if not private.has_org_role(v_org_id, array['owner','admin','issuer']::public.organization_role[]) then
        raise exception 'Insufficient organization role';
    end if;
    if p_duplicate_policy not in ('skip', 'reissue', 'error') then
        raise exception 'Invalid duplicate policy';
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
            organization_id, full_name, email, email_hash, salt, public_name_consent
        )
        values (
            v_org_id, v_normalized_name, v_normalized_email,
            p_email_hash, p_salt, coalesce(p_public_name_consent, false)
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
        on conflict (batch_id, row_number) do update
        set status = 'succeeded',
            last_error = 'Skipped duplicate recipient',
            credential_id = v_existing_credential_id,
            updated_at = now();

        update public.issuance_batches
        set processed_count = processed_count + 1,
            succeeded = succeeded + 1
        where id = p_batch_id;

        return jsonb_build_object(
            'outcome', 'skipped',
            'credential_id', v_existing_credential_id
        );
    end if;

    if v_existing_credential_id is not null and p_duplicate_policy = 'error' then
        raise exception 'Duplicate recipient';
    end if;

    insert into public.credentials(
        id, organization_id, batch_id, achievement_id, recipient_id,
        status, issued_at, expires_at, credential_json, jws, kid,
        visibility, serial_number, content_hash, pdf_path
    )
    values (
        v_credential_id,
        v_org_id, p_batch_id, v_achievement_id, v_recipient_id,
        'issued', p_issued_at, p_expires_at, p_credential_json, p_jws, p_kid,
        coalesce(p_visibility, 'unlisted'), p_serial_number, p_content_hash, p_pdf_path
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
    set processed_count = processed_count + 1,
        succeeded = succeeded + 1
    where id = p_batch_id;

    return jsonb_build_object(
        'outcome', 'issued',
        'credential_id', v_credential_id
    );
end;
$$;

revoke all on function public.persist_issuance_row(
    uuid, integer, jsonb, text, text, text, text, text, boolean, text,
    uuid, text, timestamptz, timestamptz, public.credential_visibility,
    jsonb, text, text, text, text
) from public, anon;
grant execute on function public.persist_issuance_row(
    uuid, integer, jsonb, text, text, text, text, text, boolean, text,
    uuid, text, timestamptz, timestamptz, public.credential_visibility,
    jsonb, text, text, text, text
) to authenticated;

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

create or replace function public.anonymize_recipient(p_recipient_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    v_org_id uuid;
begin
    select organization_id into v_org_id
    from public.recipients where id = p_recipient_id for update;

    if v_org_id is null then raise exception 'Recipient not found'; end if;
    if not private.has_org_role(v_org_id, array['owner','admin']::public.organization_role[]) then
        raise exception 'Insufficient organization role';
    end if;

    update public.recipients
    set full_name = null, email = null, salt = null,
        public_name_consent = false, anonymized_at = now()
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

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
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
alter table public.verification_events enable row level security;
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
create policy "admin member insert" on public.organization_members for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));
create policy "admin member update" on public.organization_members for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]))
with check (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));
create policy "owner member delete" on public.organization_members for delete to authenticated
using (private.has_org_role(organization_id, array['owner']::public.organization_role[]));

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

grant all privileges on all tables in schema public to service_role;
