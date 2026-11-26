do $$
declare
    missing_tables text;
begin
    select string_agg(
        format('%I.%I', n.nspname, c.relname),
        ', ' order by n.nspname, c.relname
    )
    into missing_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and (
          n.nspname in ('public', 'private')
          or (n.nspname = 'storage' and c.relname = 'objects')
      )
      and not c.relrowsecurity;

    if missing_tables is not null then
        raise exception 'RLS is disabled on application table(s): %', missing_tables;
    end if;

    raise notice 'PASS: RLS is enabled on all public/private tables and storage.objects';
end;
$$;
