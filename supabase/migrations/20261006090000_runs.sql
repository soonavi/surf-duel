-- Phase 6: leaderboards.
--
-- One row per player per course: their best run, with its ghost so others
-- can race it. Anyone can read the leaderboard columns (never player_id or
-- ip_hash); only the service role, via /api/submit-run and the submit_run
-- function below, can write. The API checks every run (server/submitRun.ts)
-- before it gets here.

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  -- courseKey(): the validated spec + layout version + default physics, so
  -- a leaderboard resets by itself when a course's geometry changes.
  course_key text not null check (course_key ~ '^c[0-9]{1,4}-[0-9a-z]{1,13}$'),
  -- Where the course came from ('shipped:speed-demon', 'code:K7M2QX'), for reference.
  course_ref text not null check (char_length(course_ref) <= 40),
  -- A random id the browser keeps; it only groups one player's runs (not secret, not shown).
  player_id uuid not null,
  player_name text not null check (char_length(player_name) between 1 and 16),
  time_ms integer not null check (time_ms between 1000 and 3600000),
  checkpoint_splits integer[] not null default '{}' check (cardinality(checkpoint_splits) <= 64),
  ghost text not null check (char_length(ghost) between 1 and 200000),
  ip_hash text not null check (char_length(ip_hash) <= 64),
  created_at timestamptz not null default now(),
  -- When this player's time on this course last improved (breaks ties: first there wins).
  updated_at timestamptz not null default now(),
  unique (course_key, player_id)
);

create index runs_leaderboard_idx on public.runs (course_key, time_ms, updated_at);

alter table public.runs enable row level security;
revoke all on public.runs from anon, authenticated;
grant select (id, course_key, player_name, time_ms, checkpoint_splits, ghost, updated_at) on public.runs to anon, authenticated;
create policy "leaderboards are public" on public.runs for select to anon, authenticated using (true);

-- Recent submissions, for the rate limits (IPs only as a keyed hash; pruned after two days).
create table public.run_submissions (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index run_submissions_ip_idx on public.run_submissions (ip_hash, created_at);
create index run_submissions_created_at_idx on public.run_submissions (created_at);

alter table public.run_submissions enable row level security;
revoke all on public.run_submissions from anon, authenticated;

-- Check the rate limits, then keep the player's best run on the course, in
-- one locked step. Returns:
--   status   'ok' (this run is their best), 'kept' (an earlier run is
--            faster; their name is still updated), 'ip-window' or 'global-day'
--   run_id   their leaderboard row
--   place    1 + runs strictly faster than their best
--   total    runs on this course
--   best_ms  their best time
create or replace function public.submit_run(
  p_course_key text,
  p_course_ref text,
  p_player_id uuid,
  p_player_name text,
  p_time_ms integer,
  p_splits integer[],
  p_ghost text,
  p_ip_hash text,
  p_window_seconds integer,
  p_per_ip_window integer,
  p_global_day integer
) returns table (status text, run_id uuid, place bigint, total bigint, best_ms integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_best integer;
begin
  perform pg_advisory_xact_lock(hashtext('surf_duel_submit_run'));

  if (select count(*) from public.run_submissions s where s.created_at > now() - interval '1 day') >= p_global_day then
    return query select 'global-day'::text, null::uuid, null::bigint, null::bigint, null::integer;
    return;
  end if;
  if (select count(*) from public.run_submissions s
      where s.ip_hash = p_ip_hash and s.created_at > now() - make_interval(secs => p_window_seconds)) >= p_per_ip_window then
    return query select 'ip-window'::text, null::uuid, null::bigint, null::bigint, null::integer;
    return;
  end if;

  insert into public.run_submissions (ip_hash) values (p_ip_hash);
  delete from public.run_submissions s where s.created_at < now() - interval '2 days';

  insert into public.runs as r (course_key, course_ref, player_id, player_name, time_ms, checkpoint_splits, ghost, ip_hash)
  values (p_course_key, p_course_ref, p_player_id, p_player_name, p_time_ms, p_splits, p_ghost, p_ip_hash)
  on conflict (course_key, player_id) do update set
    player_name = excluded.player_name,
    ip_hash = excluded.ip_hash,
    time_ms = least(r.time_ms, excluded.time_ms),
    checkpoint_splits = case when excluded.time_ms < r.time_ms then excluded.checkpoint_splits else r.checkpoint_splits end,
    ghost = case when excluded.time_ms < r.time_ms then excluded.ghost else r.ghost end,
    updated_at = case when excluded.time_ms < r.time_ms then now() else r.updated_at end
  returning r.id, r.time_ms into v_id, v_best;

  return query select
    (case when v_best = p_time_ms then 'ok' else 'kept' end)::text,
    v_id,
    (select count(*) + 1 from public.runs x where x.course_key = p_course_key and x.time_ms < v_best),
    (select count(*) from public.runs x where x.course_key = p_course_key),
    v_best;
end;
$$;

revoke execute on function public.submit_run(text, text, uuid, text, integer, integer[], text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_run(text, text, uuid, text, integer, integer[], text, text, integer, integer, integer) to service_role;
