-- Rate limits every serverless instance shares (hardening review, batch 6).
--
-- The app's limits on sign-in links, customer portal links and the
-- break-glass password were each kept in one instance's memory: on Vercel
-- every warm instance had its own count and a cold start had none, so a
-- flood of sign-in emails to one inbox was barely slowed. These scopes now
-- also count here, in one row per key, through `rate_limit_hit`, which adds
-- the hit and answers in one atomic statement. apps/web/lib/rate-limit.ts
-- (sharedRateLimit) calls it with a hashed key (never an address or an IP in
-- the clear), and keeps working on its in-memory count if this hasn't been
-- run yet.
--
-- Only the service role can touch either: RLS on with no policies, and the
-- function's execute grant revoked from everyone else. Safe to re-run.

create table if not exists public.rate_limits (
  key text primary key,            -- sha256 of the scope and identity, hex
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- One hit against `p_key`: a fixed window of `p_window_seconds` that starts
-- with its first hit. Allowed while the window's hits (this one included)
-- are within `p_limit`; otherwise the seconds until the window ends.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := clock_timestamp();
  span interval := make_interval(secs => greatest(p_window_seconds, 1));
  rec public.rate_limits%rowtype;
begin
  insert into public.rate_limits as r (key, window_start, hits, updated_at)
  values (p_key, now_ts, 1, now_ts)
  on conflict (key) do update
    set window_start = case when r.window_start <= now_ts - span then now_ts else r.window_start end,
        hits = case when r.window_start <= now_ts - span then 1 else r.hits + 1 end,
        updated_at = now_ts
  returning * into rec;

  allowed := rec.hits <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (rec.window_start + span - now_ts)))::integer)
  end;

  -- Now and then, drop keys nobody has hit for a day (windows are hours at most).
  if random() < 0.01 then
    delete from public.rate_limits where updated_at < now_ts - interval '1 day';
  end if;

  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
