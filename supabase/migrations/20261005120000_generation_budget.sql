-- Surf Duel: spending caps for AI course generation.
--
-- claim_generation() checks every limit and, if all pass, counts the
-- generation, in one transaction under an advisory lock, so concurrent
-- requests can't both slip under a cap. The /api/generate-course function
-- calls it (service role) before every OpenAI call, and refuses to call
-- OpenAI if it can't.
--   lifetime     generations ever (generation_budget.total)
--   global day   generations by everyone in the last 24 h
--   per-IP       a daily cap and a short burst window per hashed IP

create table public.generation_budget (
  id smallint primary key default 1 check (id = 1),
  total bigint not null default 0
);

comment on table public.generation_budget is
  'Lifetime count of AI course generations, for the spending cap. Service role only.';

-- Count any attempts made before this migration too.
insert into public.generation_budget (id, total)
select 1, count(*) from public.generation_requests;

alter table public.generation_budget enable row level security;

revoke all on public.generation_budget from anon, authenticated;

create index generation_requests_created_at_idx
  on public.generation_requests (created_at desc);

create function public.claim_generation(
  p_ip_hash text,
  p_window_seconds integer,
  p_per_ip_window integer,
  p_per_ip_day integer,
  p_global_day integer,
  p_lifetime integer
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total bigint;
begin
  -- One claim at a time, so the caps are exact.
  perform pg_advisory_xact_lock(hashtext('surf_duel.claim_generation'));

  select total into v_total from public.generation_budget where id = 1 for update;
  if v_total is null or v_total >= p_lifetime then
    return 'lifetime';
  end if;

  if (select count(*) from public.generation_requests
      where created_at > now() - interval '1 day') >= p_global_day then
    return 'global-day';
  end if;

  if (select count(*) from public.generation_requests
      where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= p_per_ip_day then
    return 'ip-day';
  end if;

  if (select count(*) from public.generation_requests
      where ip_hash = p_ip_hash and created_at > now() - make_interval(secs => p_window_seconds)) >= p_per_ip_window then
    return 'ip-window';
  end if;

  insert into public.generation_requests (ip_hash) values (p_ip_hash);
  update public.generation_budget set total = total + 1 where id = 1;
  -- Rows older than two days no longer matter to any limit.
  delete from public.generation_requests where created_at < now() - interval '2 days';
  return 'ok';
end;
$$;

revoke all on function public.claim_generation(text, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_generation(text, integer, integer, integer, integer, integer) to service_role;
