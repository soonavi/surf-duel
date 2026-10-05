-- Phase 7: assist mode. Runs set with it stay on the same leaderboard, with a badge.
alter table public.runs add column assist boolean not null default false;
grant select (assist) on public.runs to anon, authenticated;

-- submit_run gains p_assist; the flag travels with the best run.
drop function public.submit_run(text, text, uuid, text, integer, integer[], text, text, integer, integer, integer);

create function public.submit_run(
  p_course_key text,
  p_course_ref text,
  p_player_id uuid,
  p_player_name text,
  p_time_ms integer,
  p_splits integer[],
  p_ghost text,
  p_assist boolean,
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

  insert into public.runs as r (course_key, course_ref, player_id, player_name, time_ms, checkpoint_splits, ghost, assist, ip_hash)
  values (p_course_key, p_course_ref, p_player_id, p_player_name, p_time_ms, p_splits, p_ghost, p_assist, p_ip_hash)
  on conflict (course_key, player_id) do update set
    player_name = excluded.player_name,
    ip_hash = excluded.ip_hash,
    time_ms = least(r.time_ms, excluded.time_ms),
    checkpoint_splits = case when excluded.time_ms < r.time_ms then excluded.checkpoint_splits else r.checkpoint_splits end,
    ghost = case when excluded.time_ms < r.time_ms then excluded.ghost else r.ghost end,
    assist = case when excluded.time_ms < r.time_ms then excluded.assist else r.assist end,
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

revoke execute on function public.submit_run(text, text, uuid, text, integer, integer[], text, boolean, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.submit_run(text, text, uuid, text, integer, integer[], text, boolean, text, integer, integer, integer) to service_role;
