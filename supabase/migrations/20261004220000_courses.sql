-- Surf Duel, Phase 5: AI-generated courses, shared by a short code.
--
-- Reads are public (anyone with a code can race the course). Writes happen
-- only in the /api/generate-course serverless function, with the service-role
-- key, so there are no insert/update/delete policies for clients.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  -- 6 characters, no look-alikes (no I, O, 0, 1). Matches src/course/shareCode.ts.
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  prompt text not null check (char_length(prompt) between 1 and 200),
  -- A course that has already been through validateCourse (src/course/schema.ts).
  spec jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.courses is
  'AI-generated courses, readable by share code. Written only by /api/generate-course (service role).';

alter table public.courses enable row level security;

create policy "Anyone can read courses"
  on public.courses for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate on public.courses from anon, authenticated;

-- One row per generation attempt, for the per-IP rate limit. The IP is stored
-- only as a keyed hash. Service role only: no client access at all.
create table public.generation_requests (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

comment on table public.generation_requests is
  'Rate-limit log for /api/generate-course (hashed IPs). Service role only.';

create index generation_requests_ip_hash_created_at_idx
  on public.generation_requests (ip_hash, created_at desc);

alter table public.generation_requests enable row level security;

revoke all on public.generation_requests from anon, authenticated;
