-- The shape of every table in `public`, as JSON: columns (type, not null,
-- default), keys, unique constraints and indexes, foreign keys and check
-- constraints. schema-sync.mjs compares it with (or writes it to)
-- apps/web/lib/db/db-schema.generated.ts, which the local data backend
-- enforces. Read-only. Test harness only.
\pset tuples_only on
\pset format unaligned
select coalesce(json_object_agg(t.relname, json_build_object(
  'columns', (
    select json_agg(json_build_array(a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  ),
  'primaryKey', coalesce((
    select json_agg(a.attname order by k.ord)
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = t.oid and c.contype = 'p'
  ), '[]'::json),
  'unique', coalesce((
    select json_agg(json_build_object('name', c.conname, 'columns', (
      select json_agg(a.attname order by k.ord)
      from unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    )) order by c.conindid)
    from pg_constraint c
    where c.conrelid = t.oid and c.contype = 'u'
  ), '[]'::json),
  'uniqueIndexes', coalesce((
    select json_agg(i.indexrelid::regclass::text order by i.indexrelid)
    from pg_index i
    where i.indrelid = t.oid and i.indisunique and not i.indisprimary
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
  ), '[]'::json),
  'foreignKeys', coalesce((
    select json_agg(json_build_object(
      'name', c.conname,
      'column', (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]),
      'references', c.confrelid::regclass::text,
      'refColumn', (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1]),
      'onDelete', case c.confdeltype when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' when 'r' then 'restrict' else 'no action' end
    ) order by c.conname)
    from pg_constraint c
    where c.conrelid = t.oid and c.contype = 'f'
  ), '[]'::json),
  'checks', coalesce((
    select json_agg(c.conname order by c.conname)
    from pg_constraint c
    where c.conrelid = t.oid and c.contype = 'c'
  ), '[]'::json)
) order by t.relname), '{}'::json)
from pg_class t
where t.relnamespace = 'public'::regnamespace and t.relkind = 'r';
