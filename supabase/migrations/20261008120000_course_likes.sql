-- Thumbs up on shared courses, and the Popular list on the home screen.
--
-- courses.likes is the count the Popular list sorts by (anyone can read it,
-- like the rest of courses). Who liked what lives in course_likes, which
-- clients can't read at all: only like_course() (service role, called by
-- /api/like-course) writes either table, in one locked step.

alter table public.courses add column likes integer not null default 0 check (likes >= 0);

create index courses_popular_idx on public.courses (likes desc, created_at desc);

create table public.course_likes (
  course_code text not null references public.courses (code) on delete cascade,
  -- The browser's leaderboard id (Profile.boardId): one like per player per course.
  player_id uuid not null,
  ip_hash text not null check (char_length(ip_hash) <= 64),
  created_at timestamptz not null default now(),
  primary key (course_code, player_id)
);

comment on table public.course_likes is
  'Who liked which shared course (hashed IPs). Written only by like_course() (service role).';

create index course_likes_ip_idx on public.course_likes (course_code, ip_hash);

alter table public.course_likes enable row level security;
revoke all on public.course_likes from anon, authenticated;

-- Recent like requests, for the rate limits (IPs only as a keyed hash; pruned after two days).
create table public.like_requests (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index like_requests_ip_idx on public.like_requests (ip_hash, created_at);
create index like_requests_created_at_idx on public.like_requests (created_at);

alter table public.like_requests enable row level security;
revoke all on public.like_requests from anon, authenticated;

-- Check the limits, then set or clear this player's like and recount. Returns:
--   status  'ok', 'not-found', 'ip-window', 'global-day', or 'ip-course'
--           (enough players on this network already like the course)
--   liked   the player's like after this call
--   likes   the course's count after this call (null for 'not-found' and the rate limits)
create function public.like_course(
  p_code text,
  p_player_id uuid,
  p_like boolean,
  p_ip_hash text,
  p_window_seconds integer,
  p_per_ip_window integer,
  p_per_ip_course integer,
  p_global_day integer
) returns table (status text, liked boolean, likes integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_likes integer;
begin
  perform pg_advisory_xact_lock(hashtext('surf_duel_like_course'));

  if not exists (select 1 from public.courses c where c.code = p_code) then
    return query select 'not-found'::text, null::boolean, null::integer;
    return;
  end if;
  if (select count(*) from public.like_requests r where r.created_at > now() - interval '1 day') >= p_global_day then
    return query select 'global-day'::text, null::boolean, null::integer;
    return;
  end if;
  if (select count(*) from public.like_requests r
      where r.ip_hash = p_ip_hash and r.created_at > now() - make_interval(secs => p_window_seconds)) >= p_per_ip_window then
    return query select 'ip-window'::text, null::boolean, null::integer;
    return;
  end if;

  insert into public.like_requests (ip_hash) values (p_ip_hash);
  delete from public.like_requests r where r.created_at < now() - interval '2 days';

  if p_like then
    if not exists (select 1 from public.course_likes l where l.course_code = p_code and l.player_id = p_player_id) then
      if (select count(*) from public.course_likes l where l.course_code = p_code and l.ip_hash = p_ip_hash) >= p_per_ip_course then
        return query select 'ip-course'::text, false, (select c.likes from public.courses c where c.code = p_code);
        return;
      end if;
      insert into public.course_likes (course_code, player_id, ip_hash) values (p_code, p_player_id, p_ip_hash);
    end if;
  else
    delete from public.course_likes l where l.course_code = p_code and l.player_id = p_player_id;
  end if;

  update public.courses c
    set likes = (select count(*) from public.course_likes l where l.course_code = p_code)
    where c.code = p_code
    returning c.likes into v_likes;

  return query select 'ok'::text, p_like, v_likes;
end;
$$;

revoke execute on function public.like_course(text, uuid, boolean, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.like_course(text, uuid, boolean, text, integer, integer, integer, integer) to service_role;
