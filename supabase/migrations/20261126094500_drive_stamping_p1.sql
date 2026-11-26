begin;

create type public.stamp_run_status as enum (
    'review_required',
    'approved',
    'processing',
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled'
);

create type public.stamp_file_status as enum (
    'pending',
    'processing',
    'completed',
    'failed',
    'deleted'
);

create type public.stamp_file_error_code as enum (
    'drive_forbidden',
    'drive_rate_limited',
    'file_missing',
    'duplicate_file',
    'extra_file',
    'case_collision',
    'pdf_invalid',
    'pdf_encrypted',
    'pdf_signed',
    'pdf_rotated',
    'page_limit',
    'page_size_mismatch',
    'qr_stamping_failed',
    'storage_upload_failed',
    'processing_lease_expired',
    'other'
);

alter table public.recipients
    add column anonymization_requested_at timestamptz,
    add column anonymization_requested_by uuid references auth.users(id);

create table public.qr_layouts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    achievement_id uuid not null,
    page_number integer not null,
    x_points numeric(9,3) not null,
    y_points numeric(9,3) not null,
    size_points numeric(9,3) not null,
    expected_page_width_points numeric(9,3) not null,
    expected_page_height_points numeric(9,3) not null,
    page_size_tolerance_points numeric(9,3) not null default 1,
    expected_rotation_degrees smallint not null default 0,
    updated_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, achievement_id),
    foreign key (organization_id, achievement_id)
        references public.achievements(organization_id, id)
        on delete restrict,
    constraint qr_layout_page_number_positive check (page_number > 0),
    constraint qr_layout_nonnegative_coordinates check (x_points >= 0 and y_points >= 0),
    constraint qr_layout_qr_size_mm check (size_points between 70.866 and 85.040),
    constraint qr_layout_page_dimensions_positive check (
        expected_page_width_points > 0 and expected_page_height_points > 0
    ),
    constraint qr_layout_tolerance_valid check (
        page_size_tolerance_points >= 0 and page_size_tolerance_points <= 72
    ),
    constraint qr_layout_rotation_is_zero check (expected_rotation_degrees = 0),
    constraint qr_layout_fits_page check (
        x_points + size_points <= expected_page_width_points
        and y_points + size_points <= expected_page_height_points
    )
);

create table public.stamp_runs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    achievement_id uuid not null,
    drive_folder_id text not null,
    idempotency_key text not null,
    created_by uuid not null references auth.users(id),
    status public.stamp_run_status not null default 'review_required',
    expected_file_count integer not null,
    processed_count integer not null default 0,
    succeeded_count integer not null default 0,
    failed_count integer not null default 0,
    review_sample_file_ids uuid[] not null default '{}',
    review_approved_at timestamptz,
    review_approved_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (organization_id, idempotency_key),
    foreign key (organization_id, achievement_id)
        references public.achievements(organization_id, id)
        on delete restrict,
    constraint stamp_run_drive_folder_id_valid check (
        drive_folder_id ~ '^[A-Za-z0-9_-]{10,255}$'
    ),
    constraint stamp_run_idempotency_key_valid check (
        idempotency_key ~ '^[0-9a-f]{64}$'
    ),
    constraint stamp_run_file_count_valid check (
        expected_file_count between 1 and 300
        and processed_count between 0 and expected_file_count
        and succeeded_count >= 0
        and failed_count >= 0
        and succeeded_count + failed_count <= processed_count
    ),
    constraint stamp_run_review_fields_valid check (
        (review_approved_at is null and review_approved_by is null
            and cardinality(review_sample_file_ids) = 0)
        or (review_approved_at is not null and review_approved_by is not null
            and cardinality(review_sample_file_ids) between 1 and 10)
    )
);

create table public.stamp_files (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    stamp_run_id uuid not null,
    credential_id uuid not null,
    recipient_id uuid not null,
    drive_file_id text,
    source_sha256 text,
    output_sha256 text,
    storage_path text,
    status public.stamp_file_status not null default 'pending',
    error_code public.stamp_file_error_code,
    attempt_count integer not null default 0,
    lease_expires_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    unique (stamp_run_id, drive_file_id),
    unique (stamp_run_id, credential_id),
    unique (storage_path),
    foreign key (organization_id, stamp_run_id)
        references public.stamp_runs(organization_id, id)
        on delete restrict,
    foreign key (organization_id, credential_id, recipient_id)
        references public.credentials(organization_id, id, recipient_id)
        on delete restrict,
    constraint stamp_file_drive_id_valid check (
        drive_file_id is null or drive_file_id ~ '^[A-Za-z0-9_-]{1,255}$'
    ),
    constraint stamp_file_hashes_valid check (
        (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$')
        and (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$')
    ),
    constraint stamp_file_path_is_uuid_only check (
        storage_path is null or storage_path =
            organization_id::text || '/' || stamp_run_id::text || '/' || id::text || '.pdf'
    ),
    constraint stamp_file_attempts_nonnegative check (attempt_count >= 0),
    constraint stamp_file_deletion_redacts_source check (
        status <> 'deleted'
        or (drive_file_id is null and source_sha256 is null and output_sha256 is null
            and storage_path is null and lease_expires_at is null)
    )
);

create index qr_layouts_org_idx on public.qr_layouts(organization_id, achievement_id);
create index stamp_runs_org_created_idx
    on public.stamp_runs(organization_id, created_at desc);
create index stamp_runs_status_idx on public.stamp_runs(organization_id, status);
create index stamp_files_run_idx on public.stamp_files(organization_id, stamp_run_id);
create index stamp_files_recipient_idx
    on public.stamp_files(organization_id, recipient_id);
create index stamp_files_status_idx
    on public.stamp_files(organization_id, status);

create trigger qr_layouts_updated_at
before update on public.qr_layouts
for each row execute function private.set_updated_at();

create trigger stamp_runs_updated_at
before update on public.stamp_runs
for each row execute function private.set_updated_at();

create trigger stamp_files_updated_at
before update on public.stamp_files
for each row execute function private.set_updated_at();

alter table public.qr_layouts enable row level security;
alter table public.stamp_runs enable row level security;
alter table public.stamp_files enable row level security;

create policy "issuer can read QR layouts"
on public.qr_layouts for select to authenticated
using (private.has_org_role(
    organization_id, array['owner','admin','issuer']::public.organization_role[]
));

create policy "issuer can read stamp runs"
on public.stamp_runs for select to authenticated
using (private.has_org_role(
    organization_id, array['owner','admin','issuer']::public.organization_role[]
));

create policy "issuer can read stamp files"
on public.stamp_files for select to authenticated
using (private.has_org_role(
    organization_id, array['owner','admin','issuer']::public.organization_role[]
));

revoke all on public.qr_layouts, public.stamp_runs, public.stamp_files
    from public, anon, authenticated;
grant select on public.qr_layouts, public.stamp_runs, public.stamp_files
    to authenticated;
grant all on public.qr_layouts, public.stamp_runs, public.stamp_files
    to service_role;

create or replace function public.save_qr_layout(
    p_organization_id uuid,
    p_achievement_id uuid,
    p_page_number integer,
    p_x_points numeric,
    p_y_points numeric,
    p_size_points numeric,
    p_expected_page_width_points numeric,
    p_expected_page_height_points numeric,
    p_page_size_tolerance_points numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null
       or not private.has_org_role(
           p_organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;

    insert into public.qr_layouts(
        organization_id, achievement_id, page_number, x_points, y_points,
        size_points, expected_page_width_points, expected_page_height_points,
        page_size_tolerance_points, expected_rotation_degrees, updated_by
    )
    values (
        p_organization_id, p_achievement_id, p_page_number, p_x_points, p_y_points,
        p_size_points, p_expected_page_width_points, p_expected_page_height_points,
        p_page_size_tolerance_points, 0, auth.uid()
    )
    on conflict (organization_id, achievement_id) do update
    set page_number = excluded.page_number,
        x_points = excluded.x_points,
        y_points = excluded.y_points,
        size_points = excluded.size_points,
        expected_page_width_points = excluded.expected_page_width_points,
        expected_page_height_points = excluded.expected_page_height_points,
        page_size_tolerance_points = excluded.page_size_tolerance_points,
        expected_rotation_degrees = 0,
        updated_by = auth.uid()
    returning id into v_id;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        p_organization_id, auth.uid(), 'stamp.qr_layout_saved',
        'achievement', p_achievement_id,
        jsonb_build_object('page_number', p_page_number, 'size_points', p_size_points)
    );

    return v_id;
end;
$$;

create or replace function public.create_stamp_run(
    p_organization_id uuid,
    p_achievement_id uuid,
    p_drive_folder_id text,
    p_expected_file_count integer,
    p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_run public.stamp_runs%rowtype;
    v_id uuid;
begin
    if auth.uid() is null
       or not private.has_org_role(
           p_organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;
    if p_drive_folder_id is null or p_drive_folder_id !~ '^[A-Za-z0-9_-]{10,255}$' then
        raise exception 'Invalid Drive folder ID';
    end if;
    if p_idempotency_key is null or p_idempotency_key !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid idempotency key';
    end if;
    if p_expected_file_count is null or p_expected_file_count not between 1 and 300 then
        raise exception 'Invalid expected file count';
    end if;
    if not exists (
        select 1
        from public.achievements a
        where a.organization_id = p_organization_id
          and a.id = p_achievement_id
    ) then
        raise exception 'Achievement not found in this organization';
    end if;
    if not exists (
        select 1
        from public.credentials c
        join public.recipients r
          on r.organization_id = c.organization_id
         and r.id = c.recipient_id
        where c.organization_id = p_organization_id
          and c.achievement_id = p_achievement_id
          and c.status = 'issued'
          and r.anonymized_at is null
          and r.anonymization_requested_at is null
    ) then
        raise exception 'Issue credentials before starting a stamping run';
    end if;
    if not exists (
        select 1 from public.qr_layouts q
        where q.organization_id = p_organization_id
          and q.achievement_id = p_achievement_id
    ) then
        raise exception 'Save a QR layout before starting a stamping run';
    end if;

    insert into public.stamp_runs(
        organization_id, achievement_id, drive_folder_id, idempotency_key,
        created_by, expected_file_count
    )
    values (
        p_organization_id, p_achievement_id, p_drive_folder_id, p_idempotency_key,
        auth.uid(), p_expected_file_count
    )
    on conflict (organization_id, idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then
        select * into v_run
        from public.stamp_runs
        where organization_id = p_organization_id
          and idempotency_key = p_idempotency_key
        for update;
        if v_run.achievement_id <> p_achievement_id
           or v_run.drive_folder_id <> p_drive_folder_id
           or v_run.expected_file_count <> p_expected_file_count then
            raise exception 'Idempotency key was reused with different run parameters';
        end if;
        return v_run.id;
    end if;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        p_organization_id, auth.uid(), 'stamp.run_created',
        'stamp_run', v_id, jsonb_build_object('expected_file_count', p_expected_file_count)
    );

    return v_id;
end;
$$;

create or replace function public.register_stamp_file(
    p_stamp_run_id uuid,
    p_credential_id uuid,
    p_drive_file_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_run public.stamp_runs%rowtype;
    v_existing public.stamp_files%rowtype;
    v_recipient_id uuid;
    v_file_id uuid;
begin
    select * into v_run
    from public.stamp_runs
    where id = p_stamp_run_id
    for update;
    if not found then raise exception 'Stamp run not found'; end if;
    if auth.uid() is null
       or not private.has_org_role(
           v_run.organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;
    if v_run.status <> 'review_required' then
        raise exception 'Files can only be registered before review approval';
    end if;
    if p_drive_file_id is null or p_drive_file_id !~ '^[A-Za-z0-9_-]{1,255}$' then
        raise exception 'Invalid Drive file ID';
    end if;

    select c.recipient_id into v_recipient_id
    from public.credentials c
    join public.recipients r
      on r.organization_id = c.organization_id
     and r.id = c.recipient_id
    where c.organization_id = v_run.organization_id
      and c.id = p_credential_id
      and c.achievement_id = v_run.achievement_id
      and c.status = 'issued'
      and r.anonymized_at is null
      and r.anonymization_requested_at is null
    for key share of r;
    if not found then
        raise exception 'Credential is not issued or available for this achievement';
    end if;

    select * into v_existing
    from public.stamp_files
    where stamp_run_id = p_stamp_run_id
      and drive_file_id = p_drive_file_id
    for update;
    if found then
        if v_existing.credential_id <> p_credential_id then
            raise exception 'Drive file is already mapped to a different credential';
        end if;
        return v_existing.id;
    end if;

    if exists (
        select 1 from public.stamp_files
        where stamp_run_id = p_stamp_run_id
          and credential_id = p_credential_id
    ) then
        raise exception 'Credential is already mapped to a different Drive file';
    end if;
    if (select count(*) from public.stamp_files where stamp_run_id = p_stamp_run_id)
       >= v_run.expected_file_count then
        raise exception 'Stamp run contains more files than expected';
    end if;

    v_file_id := gen_random_uuid();
    insert into public.stamp_files(
        id, organization_id, stamp_run_id, credential_id, recipient_id,
        drive_file_id, storage_path
    )
    values (
        v_file_id, v_run.organization_id, p_stamp_run_id, p_credential_id, v_recipient_id,
        p_drive_file_id,
        v_run.organization_id::text || '/' || p_stamp_run_id::text || '/' || v_file_id::text || '.pdf'
    );

    return v_file_id;
end;
$$;

create or replace function public.approve_stamp_run_review(
    p_stamp_run_id uuid,
    p_sampled_file_ids uuid[],
    p_acknowledged boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_run public.stamp_runs%rowtype;
    v_file_count integer;
    v_sample_count integer;
    v_distinct_sample_count integer;
begin
    select * into v_run
    from public.stamp_runs
    where id = p_stamp_run_id
    for update;
    if not found then raise exception 'Stamp run not found'; end if;
    if auth.uid() is null
       or not private.has_org_role(
           v_run.organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;
    if v_run.status <> 'review_required' then
        raise exception 'Stamp run review is not pending';
    end if;
    if p_acknowledged is distinct from true then
        raise exception 'Review must be explicitly approved';
    end if;

    select count(*)::integer into v_file_count
    from public.stamp_files
    where stamp_run_id = p_stamp_run_id
      and status = 'pending';
    if v_file_count <> v_run.expected_file_count then
        raise exception 'Every CSV row must match exactly one file before approval';
    end if;

    v_sample_count := coalesce(cardinality(p_sampled_file_ids), 0);
    select count(distinct sampled_id)::integer into v_distinct_sample_count
    from unnest(coalesce(p_sampled_file_ids, '{}'::uuid[])) as sampled(sampled_id);
    if v_sample_count <> least(10, v_run.expected_file_count)
       or v_distinct_sample_count <> v_sample_count
       or exists (
           select 1
           from unnest(coalesce(p_sampled_file_ids, '{}'::uuid[])) as sampled(sampled_id)
           where not exists (
               select 1 from public.stamp_files sf
               where sf.id = sampled.sampled_id
                 and sf.stamp_run_id = p_stamp_run_id
           )
       ) then
        raise exception 'Review sample must contain the required distinct files';
    end if;

    update public.stamp_runs
    set status = 'approved',
        review_sample_file_ids = p_sampled_file_ids,
        review_approved_at = now(),
        review_approved_by = auth.uid()
    where id = p_stamp_run_id;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id, metadata
    )
    values (
        v_run.organization_id, auth.uid(), 'stamp.run_review_approved',
        'stamp_run', p_stamp_run_id,
        jsonb_build_object('sample_count', v_sample_count, 'file_count', v_file_count)
    );
end;
$$;

create or replace function public.claim_stamp_file(
    p_stamp_file_id uuid,
    p_source_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_file public.stamp_files%rowtype;
    v_run public.stamp_runs%rowtype;
    v_recipient public.recipients%rowtype;
begin
    select * into v_file
    from public.stamp_files
    where id = p_stamp_file_id;
    if not found then raise exception 'Stamp file not found'; end if;

    if auth.uid() is null
       or not private.has_org_role(
           v_file.organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;

    select * into v_recipient
    from public.recipients
    where organization_id = v_file.organization_id
      and id = v_file.recipient_id
    for key share;
    if not found or v_recipient.anonymized_at is not null
       or v_recipient.anonymization_requested_at is not null then
        raise exception 'Recipient is unavailable for stamping';
    end if;
    if p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid source PDF hash';
    end if;

    select * into v_file
    from public.stamp_files
    where id = p_stamp_file_id
    for update;
    if not found then raise exception 'Stamp file not found'; end if;
    if v_file.source_sha256 is not null and v_file.source_sha256 <> p_source_sha256 then
        raise exception 'Drive PDF changed after the file was registered';
    end if;
    select * into v_run
    from public.stamp_runs
    where id = v_file.stamp_run_id
    for update;
    if v_run.status not in ('approved', 'processing', 'completed_with_errors') then
        raise exception 'Stamp run is not approved for processing';
    end if;
    if v_file.status = 'completed' or v_file.status = 'deleted' then
        raise exception 'Stamp file is not retryable';
    end if;
    if v_file.status = 'processing' and v_file.lease_expires_at > now() then
        raise exception 'Stamp file is already processing';
    end if;

    update public.stamp_files
    set status = 'processing',
        source_sha256 = p_source_sha256,
        attempt_count = attempt_count + 1,
        lease_expires_at = now() + interval '5 minutes',
        error_code = null
    where id = p_stamp_file_id
    returning * into v_file;

    update public.stamp_runs
    set status = 'processing'
    where id = v_run.id;

    return jsonb_build_object(
        'stampFileId', v_file.id,
        'storagePath', v_file.storage_path,
        'attemptCount', v_file.attempt_count
    );
end;
$$;

create or replace function public.complete_stamp_file(
    p_stamp_file_id uuid,
    p_success boolean,
    p_output_sha256 text,
    p_error_code public.stamp_file_error_code default null
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
    select * into v_file
    from public.stamp_files
    where id = p_stamp_file_id
    for update;
    if not found then raise exception 'Stamp file not found'; end if;
    select * into v_run
    from public.stamp_runs
    where id = v_file.stamp_run_id
    for update;
    if auth.uid() is null
       or not private.has_org_role(
           v_file.organization_id,
           array['owner','admin','issuer']::public.organization_role[]
       ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;
    if v_file.status in ('completed', 'failed', 'deleted') then
        return;
    end if;
    if v_file.status <> 'processing' then
        raise exception 'Stamp file is not being processed';
    end if;

    if p_success then
        if p_output_sha256 is null or p_output_sha256 !~ '^[0-9a-f]{64}$'
           or p_error_code is not null then
            raise exception 'Successful stamp result is invalid';
        end if;
        if not exists (
            select 1 from storage.objects o
            where o.bucket_id = 'stamped-certificate-pdfs'
              and o.name = v_file.storage_path
        ) then
            raise exception 'Stamped PDF is not present in private Storage';
        end if;
        update public.stamp_files
        set status = 'completed',
            output_sha256 = p_output_sha256,
            error_code = null,
            lease_expires_at = null,
            completed_at = now()
        where id = p_stamp_file_id;
    else
        if p_error_code is null or p_output_sha256 is not null then
            raise exception 'Failed stamp result requires a sanitized error code';
        end if;
        update public.stamp_files
        set status = 'failed',
            error_code = p_error_code,
            lease_expires_at = null,
            completed_at = now()
        where id = p_stamp_file_id;
    end if;

    select
        count(*) filter (where sf.status in ('completed', 'failed'))::integer,
        count(*) filter (where sf.status = 'completed')::integer,
        count(*) filter (where sf.status = 'failed')::integer
    into v_processed, v_succeeded, v_failed
    from public.stamp_files sf
    where sf.stamp_run_id = v_file.stamp_run_id;

    v_final_status := case
        when v_processed < v_run.expected_file_count then 'processing'::public.stamp_run_status
        when v_failed > 0 then 'completed_with_errors'::public.stamp_run_status
        else 'completed'::public.stamp_run_status
    end;

    update public.stamp_runs
    set processed_count = v_processed,
        succeeded_count = v_succeeded,
        failed_count = v_failed,
        status = v_final_status
    where id = v_file.stamp_run_id;

    if v_processed = v_run.expected_file_count
       and v_run.status is distinct from v_final_status then
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

revoke all on function public.save_qr_layout(
    uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, numeric
) from public, anon;
revoke all on function public.create_stamp_run(uuid, uuid, text, integer, text)
    from public, anon;
revoke all on function public.register_stamp_file(uuid, uuid, text)
    from public, anon;
revoke all on function public.approve_stamp_run_review(uuid, uuid[], boolean)
    from public, anon;
revoke all on function public.claim_stamp_file(uuid, text) from public, anon;
revoke all on function public.complete_stamp_file(
    uuid, boolean, text, public.stamp_file_error_code
) from public, anon;
grant execute on function public.save_qr_layout(
    uuid, uuid, integer, numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated;
grant execute on function public.create_stamp_run(uuid, uuid, text, integer, text)
    to authenticated;
grant execute on function public.register_stamp_file(uuid, uuid, text)
    to authenticated;
grant execute on function public.approve_stamp_run_review(uuid, uuid[], boolean)
    to authenticated;
grant execute on function public.claim_stamp_file(uuid, text) to authenticated;
grant execute on function public.complete_stamp_file(
    uuid, boolean, text, public.stamp_file_error_code
) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
    'stamped-certificate-pdfs',
    'stamped-certificate-pdfs',
    false,
    15728640,
    array['application/pdf']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "issuer can read stamped certificate PDFs"
on storage.objects for select to authenticated
using (
    bucket_id = 'stamped-certificate-pdfs'
    and exists (
        select 1
        from public.stamp_files sf
        join public.recipients r
          on r.organization_id = sf.organization_id
         and r.id = sf.recipient_id
        where sf.storage_path = storage.objects.name
          and sf.status = 'completed'
          and r.anonymized_at is null
          and r.anonymization_requested_at is null
          and private.has_org_role(
              sf.organization_id,
              array['owner','admin','issuer']::public.organization_role[]
          )
    )
);

create or replace function public.prepare_recipient_anonymization(
    p_actor_id uuid,
    p_recipient_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_org_id uuid;
    v_anonymized_at timestamptz;
    v_pending_at timestamptz;
    v_email text;
    v_storage_paths text[];
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;

    select organization_id, email, anonymized_at, anonymization_requested_at
    into v_org_id, v_email, v_anonymized_at, v_pending_at
    from public.recipients
    where id = p_recipient_id
    for update;
    if v_org_id is null then raise exception 'Recipient not found'; end if;
    if not private.user_has_org_role(
        p_actor_id, v_org_id, array['owner','admin']::public.organization_role[]
    ) then
        raise exception 'Insufficient organization role' using errcode = '42501';
    end if;
    if v_anonymized_at is not null then
        return jsonb_build_object(
            'organizationId', v_org_id,
            'storagePaths', '[]'::jsonb,
            'alreadyAnonymized', true
        );
    end if;

    if exists (
        select 1
        from public.stamp_files sf
        where sf.organization_id = v_org_id
          and sf.recipient_id = p_recipient_id
          and sf.status = 'processing'
          and sf.lease_expires_at > now()
    ) then
        raise exception 'A stamped PDF is still processing; retry anonymization shortly';
    end if;

    update public.stamp_files sf
    set status = 'failed',
        error_code = 'processing_lease_expired',
        lease_expires_at = null,
        completed_at = now()
    where sf.organization_id = v_org_id
      and sf.recipient_id = p_recipient_id
      and sf.status = 'processing'
      and sf.lease_expires_at <= now();

    if v_pending_at is null then
        update public.recipients
        set anonymization_requested_at = now(),
            anonymization_requested_by = p_actor_id
        where id = p_recipient_id;

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

        delete from public.recipient_access_tokens
        where organization_id = v_org_id
          and recipient_id = p_recipient_id;
        delete from public.recipient_management_sessions
        where organization_id = v_org_id
          and recipient_id = p_recipient_id;

        insert into public.audit_logs(
            organization_id, actor_id, action, entity_type, entity_id
        )
        values (
            v_org_id, p_actor_id, 'recipient.anonymization_requested',
            'recipient', p_recipient_id
        );
    elsif v_pending_at is not null then
        update public.recipients
        set anonymization_requested_by = p_actor_id
        where id = p_recipient_id;
    end if;

    select coalesce(array_agg(sf.storage_path), '{}'::text[])
    into v_storage_paths
    from public.stamp_files sf
    where sf.organization_id = v_org_id
      and sf.recipient_id = p_recipient_id
      and sf.storage_path is not null;

    return jsonb_build_object(
        'organizationId', v_org_id,
        'storagePaths', to_jsonb(v_storage_paths),
        'alreadyAnonymized', false
    );
end;
$$;

create or replace function public.complete_recipient_anonymization(
    p_actor_id uuid,
    p_recipient_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_org_id uuid;
    v_email text;
    v_anonymized_at timestamptz;
    v_pending_by uuid;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'Service role required' using errcode = '42501';
    end if;

    select organization_id, email, anonymized_at, anonymization_requested_by
    into v_org_id, v_email, v_anonymized_at, v_pending_by
    from public.recipients
    where id = p_recipient_id
    for update;
    if v_org_id is null then raise exception 'Recipient not found'; end if;
    if v_anonymized_at is not null then return; end if;
    if v_pending_by is distinct from p_actor_id then
        raise exception 'Recipient anonymization has not been prepared';
    end if;

    insert into public.revocations(organization_id, credential_id, reason, revoked_by)
    select v_org_id, c.id, 'Recipient data anonymized', p_actor_id
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

    update public.stamp_files
    set status = 'deleted',
        drive_file_id = null,
        source_sha256 = null,
        output_sha256 = null,
        storage_path = null,
        error_code = null,
        lease_expires_at = null,
        completed_at = now()
    where organization_id = v_org_id
      and recipient_id = p_recipient_id;

    update public.recipients
    set full_name = null,
        email = null,
        email_hash = null,
        salt = null,
        anonymized_at = now(),
        anonymization_requested_at = null,
        anonymization_requested_by = null
    where id = p_recipient_id;

    insert into public.audit_logs(
        organization_id, actor_id, action, entity_type, entity_id
    )
    values (
        v_org_id, p_actor_id, 'recipient.anonymized',
        'recipient', p_recipient_id
    );
end;
$$;

drop function public.anonymize_recipient(uuid);

revoke all on function public.prepare_recipient_anonymization(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.complete_recipient_anonymization(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.prepare_recipient_anonymization(uuid, uuid)
    to service_role;
grant execute on function public.complete_recipient_anonymization(uuid, uuid)
    to service_role;

create or replace function private.prevent_stamping_during_anonymization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_anonymized_at timestamptz;
    v_requested_at timestamptz;
begin
    if new.recipient_id is null then return new; end if;
    if tg_table_name = 'credential_name_consent_events' then
        if new.event_type = 'withdrawn' then return new; end if;
    end if;

    select r.anonymized_at, r.anonymization_requested_at
    into v_anonymized_at, v_requested_at
    from public.recipients r
    where r.organization_id = new.organization_id
      and r.id = new.recipient_id
    for key share;

    if found and (v_anonymized_at is not null or v_requested_at is not null) then
        raise exception 'Recipient is unavailable';
    end if;
    return new;
end;
$$;

create trigger credentials_prevent_anonymization_race
before insert or update of recipient_id on public.credentials
for each row execute function private.prevent_stamping_during_anonymization();

create trigger recipient_access_tokens_prevent_anonymization_race
before insert or update of recipient_id on public.recipient_access_tokens
for each row execute function private.prevent_stamping_during_anonymization();

create trigger recipient_management_sessions_prevent_anonymization_race
before insert or update of recipient_id on public.recipient_management_sessions
for each row execute function private.prevent_stamping_during_anonymization();

create trigger credential_name_consents_prevent_anonymization_race
before insert or update of recipient_id on private.credential_name_consent_events
for each row execute function private.prevent_stamping_during_anonymization();

revoke all on function private.prevent_stamping_during_anonymization()
    from public, anon, authenticated;

commit;
