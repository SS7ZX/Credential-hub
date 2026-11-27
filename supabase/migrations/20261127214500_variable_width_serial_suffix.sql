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
returns jsonb
language plpgsql
security definer
set search_path = ''
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
    v_serial_suffix text;
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
    where batch_id = p_batch_id
      and row_number = p_row_number
    for update;

    if not found then
        raise exception 'Issuance row has not been staged';
    end if;
    if v_existing_row.idempotency_key is distinct from p_idempotency_key
       or v_existing_row.payload is distinct from p_payload then
        raise exception 'Staged issuance row changed';
    end if;
    if v_existing_row.status = 'succeeded' then
        return jsonb_build_object(
            'outcome', 'replayed',
            'credential_id', v_existing_row.credential_id
        );
    end if;
    if v_existing_row.status not in ('pending', 'failed') then
        raise exception 'Staged issuance row cannot be processed';
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
                + case when v_existing_row.status = 'pending' then 1 else 0 end,
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

    v_serial_suffix := pg_catalog.lpad(
        v_serial_number::text,
        greatest(6, pg_catalog.length(v_serial_number::text)),
        '0'
    );

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
        v_serial_prefix || '-' || extract(year from now())::text || '-' || v_serial_suffix,
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
            + case when v_existing_row.status = 'pending' then 1 else 0 end,
        succeeded = succeeded
            + case when v_existing_row.status is distinct from 'succeeded' then 1 else 0 end,
        failed = failed
            - case when v_existing_row.status = 'failed' then 1 else 0 end
    where id = p_batch_id;

    return jsonb_build_object(
        'outcome', 'issued',
        'credential_id', v_credential_id,
        'serial_number',
            v_serial_prefix || '-' || extract(year from now())::text || '-' || v_serial_suffix
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
