-- Creator Baseline v1 — initial schema.
--
-- Conventions (BUILD_PROMPT.md §4):
--   * uuid PKs via gen_random_uuid(), timestamptz everywhere, numeric (never float) for rates/scores.
--   * RLS is enabled in the same statement block that creates each table.
--   * Every tenant row is reachable only through workspace_members.
--   * Enumerations are text + CHECK so they can evolve without enum migrations.
--   * Nothing from a comment is stored except aggregates.
--
-- Expects Supabase's `auth` schema (auth.users, auth.uid()) and the roles
-- anon / authenticated / service_role. For plain local Postgres see supabase/local/auth-shim.sql.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- workspaces + membership
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'admin', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table public.workspace_members enable row level security;
create index workspace_members_user_idx on public.workspace_members (user_id);

-- SECURITY DEFINER so policies can consult membership without recursing through
-- workspace_members' own RLS. search_path is pinned to stop shadowing attacks.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(ws uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- creators
-- ---------------------------------------------------------------------------

create table public.creators (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  ig_user_id              text not null,
  username                text not null,
  display_name            text,
  avatar_url              text,
  -- AES-256-GCM. Null for fixture creators in mock mode. Never selectable by end users (see grants).
  access_token_ciphertext text,
  token_iv                text,
  token_expires_at        timestamptz,
  status                  text not null default 'active'
                          check (status in ('active', 'needs_reauth', 'disconnected')),
  connected_at            timestamptz not null default now(),
  last_synced_at          timestamptz,
  unique (workspace_id, ig_user_id),
  check ((access_token_ciphertext is null) = (token_iv is null))
);
alter table public.creators enable row level security;
create index creators_workspace_idx on public.creators (workspace_id);

create or replace function public.can_access_creator(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.creators c
    join public.workspace_members m on m.workspace_id = c.workspace_id
    where c.id = cid and m.user_id = auth.uid()
  );
$$;

create policy creators_select on public.creators
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- runs (declared before metrics/scores, which reference it)
-- ---------------------------------------------------------------------------

create table public.runs (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.creators (id) on delete cascade,
  trigger       text not null check (trigger in ('schedule', 'manual')),
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'succeeded', 'failed')),
  -- Idempotency key for ingestCreator: one run per creator per window (DECISIONS.md D-004).
  window_start  timestamptz not null,
  started_at    timestamptz,
  finished_at   timestamptz,
  error_code    text,
  error_message text,
  posts_seen    integer not null default 0 check (posts_seen >= 0),
  posts_scored  integer not null default 0 check (posts_scored >= 0),
  created_at    timestamptz not null default now(),
  unique (creator_id, window_start)
);
alter table public.runs enable row level security;
create index runs_creator_started_idx on public.runs (creator_id, started_at desc);

create policy runs_select on public.runs
  for select to authenticated
  using (public.can_access_creator(creator_id));

-- ---------------------------------------------------------------------------
-- posts + metrics
-- ---------------------------------------------------------------------------

create table public.posts (
  id              uuid primary key default gen_random_uuid(),
  creator_id      uuid not null references public.creators (id) on delete cascade,
  ig_media_id     text not null unique,
  format          text not null check (format in ('reel', 'image', 'carousel')),
  permalink       text,
  posted_at       timestamptz not null,
  caption_excerpt text check (char_length(caption_excerpt) <= 300),
  duration_ms     integer check (duration_ms is null or duration_ms > 0)
);
alter table public.posts enable row level security;
create index posts_creator_posted_idx on public.posts (creator_id, posted_at desc);

create policy posts_select on public.posts
  for select to authenticated
  using (public.can_access_creator(creator_id));

-- Append-only: one snapshot per post per run. Rates are derived at read time.
create table public.post_metrics (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  run_id            uuid not null references public.runs (id) on delete cascade,
  captured_at       timestamptz not null default now(),
  reach             integer not null check (reach >= 0),
  likes             integer not null check (likes >= 0),
  comments          integer not null check (comments >= 0),
  shares            integer not null check (shares >= 0),
  saves             integer not null check (saves >= 0),
  avg_watch_time_ms integer check (avg_watch_time_ms is null or avg_watch_time_ms >= 0),
  video_views       integer check (video_views is null or video_views >= 0),
  unique (post_id, run_id)
);
alter table public.post_metrics enable row level security;
create index post_metrics_post_captured_idx on public.post_metrics (post_id, captured_at desc);
create index post_metrics_run_idx on public.post_metrics (run_id);

create or replace function public.post_metrics_forbid_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'post_metrics is append-only';
end;
$$;

create trigger post_metrics_append_only
  before update on public.post_metrics
  for each row execute function public.post_metrics_forbid_update();

create policy post_metrics_select on public.post_metrics
  for select to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_metrics.post_id and public.can_access_creator(p.creator_id)
  ));

-- ---------------------------------------------------------------------------
-- baselines + scores
-- ---------------------------------------------------------------------------

create table public.baselines (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.creators (id) on delete cascade,
  run_id            uuid not null references public.runs (id) on delete cascade,
  format            text not null check (format in ('reel', 'image', 'carousel')),
  computed_at       timestamptz not null default now(),
  n_posts           integer not null check (n_posts >= 0),
  median_reach      numeric,
  median_likes      numeric,
  median_comments   numeric,
  median_shares     numeric,
  median_saves      numeric,
  median_watch_rate numeric,
  unique (run_id, format)
);
alter table public.baselines enable row level security;
create index baselines_creator_format_idx on public.baselines (creator_id, format, computed_at desc);

create policy baselines_select on public.baselines
  for select to authenticated
  using (public.can_access_creator(creator_id));

create table public.post_scores (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.posts (id) on delete cascade,
  run_id           uuid not null references public.runs (id) on delete cascade,
  -- Null when the label is too_early or baseline_building.
  score            numeric(6, 4),
  label            text not null
                   check (label in ('strong', 'normal', 'weak', 'too_early', 'baseline_building')),
  r_values         jsonb not null default '{}'::jsonb check (jsonb_typeof(r_values) = 'object'),
  weights_snapshot jsonb not null check (jsonb_typeof(weights_snapshot) = 'object'),
  signals_used     text[] not null default '{}',
  computed_at      timestamptz not null default now(),
  unique (post_id, run_id),
  check ((score is null) = (label in ('too_early', 'baseline_building')))
);
alter table public.post_scores enable row level security;
create index post_scores_post_computed_idx on public.post_scores (post_id, computed_at desc);
create index post_scores_run_idx on public.post_scores (run_id);

create policy post_scores_select on public.post_scores
  for select to authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_scores.post_id and public.can_access_creator(p.creator_id)
  ));

-- ---------------------------------------------------------------------------
-- AI outputs
-- ---------------------------------------------------------------------------

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references public.creators (id) on delete cascade,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  headline         text,
  what_working     jsonb,
  what_not_working jsonb,
  themes           jsonb,
  sentiment        jsonb,
  model            text,
  prompt_version   text,
  created_at       timestamptz not null default now(),
  unique (creator_id, period_start, period_end),
  check (period_end > period_start)
);
alter table public.reports enable row level security;
create index reports_creator_created_idx on public.reports (creator_id, created_at desc);

create policy reports_select on public.reports
  for select to authenticated
  using (public.can_access_creator(creator_id));

create table public.content_plans (
  id             uuid primary key default gen_random_uuid(),
  creator_id     uuid not null references public.creators (id) on delete cascade,
  week_start     date not null,
  summary        text,
  model          text,
  prompt_version text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (creator_id, week_start)
);
alter table public.content_plans enable row level security;

create trigger content_plans_updated_at
  before update on public.content_plans
  for each row execute function public.set_updated_at();

create policy content_plans_select on public.content_plans
  for select to authenticated
  using (public.can_access_creator(creator_id));

create table public.plan_suggestions (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.content_plans (id) on delete cascade,
  title          text not null check (char_length(title) <= 200),
  format         text not null check (format in ('reel', 'image', 'carousel')),
  hook           text,
  reason         text,
  data_ref       text,
  suggested_date date,
  status         text not null default 'proposed' check (status in ('proposed', 'used', 'not_used')),
  decided_at     timestamptz,
  decided_by     uuid references auth.users (id) on delete set null
);
alter table public.plan_suggestions enable row level security;
create index plan_suggestions_plan_idx on public.plan_suggestions (plan_id);

create policy plan_suggestions_select on public.plan_suggestions
  for select to authenticated
  using (exists (
    select 1 from public.content_plans cp
    where cp.id = plan_suggestions.plan_id and public.can_access_creator(cp.creator_id)
  ));

-- Any member may mark a suggestion used / not used (DECISIONS.md D-006).
create policy plan_suggestions_update on public.plan_suggestions
  for update to authenticated
  using (exists (
    select 1 from public.content_plans cp
    where cp.id = plan_suggestions.plan_id and public.can_access_creator(cp.creator_id)
  ))
  with check (exists (
    select 1 from public.content_plans cp
    where cp.id = plan_suggestions.plan_id and public.can_access_creator(cp.creator_id)
  ));

-- Aggregates only. There is deliberately no column that could hold comment text or usernames.
create table public.comment_insights (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null unique references public.runs (id) on delete cascade,
  creator_id         uuid not null references public.creators (id) on delete cascade,
  sentiment_positive integer not null default 0 check (sentiment_positive >= 0),
  sentiment_neutral  integer not null default 0 check (sentiment_neutral >= 0),
  sentiment_negative integer not null default 0 check (sentiment_negative >= 0),
  themes             jsonb not null default '[]'::jsonb check (jsonb_typeof(themes) = 'array'),
  comments_sampled   integer not null default 0 check (comments_sampled between 0 and 300),
  model              text,
  created_at         timestamptz not null default now()
);
alter table public.comment_insights enable row level security;
create index comment_insights_creator_idx on public.comment_insights (creator_id, created_at desc);

create policy comment_insights_select on public.comment_insights
  for select to authenticated
  using (public.can_access_creator(creator_id));

-- ---------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------

create table public.scoring_settings (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null unique references public.workspaces (id) on delete cascade,
  weights               jsonb not null default
    '{"watch_time":0.35,"sends":0.25,"saves":0.20,"likes":0.10,"comments":0.10}'::jsonb
    check (jsonb_typeof(weights) = 'object'),
  photo_weights         jsonb not null default
    '{"sends":0.40,"saves":0.30,"likes":0.15,"comments":0.15}'::jsonb
    check (jsonb_typeof(photo_weights) = 'object'),
  cap                   numeric(6, 4) not null default 5.0 check (cap > 0),
  strong_cutoff         numeric(6, 4) not null default 1.5,
  weak_cutoff           numeric(6, 4) not null default 0.9,
  min_age_hours         integer not null default 24 check (min_age_hours between 0 and 720),
  median_window         integer not null default 30 check (median_window between 5 and 200),
  -- Minimum interval between syncs, read by the hourly scheduleTick (DECISIONS.md D-007).
  schedule_cron         text not null default '6 hours'
                        check (schedule_cron in ('1 hour', '3 hours', '6 hours', '12 hours', '24 hours')),
  ai_monthly_budget_usd numeric(10, 2) not null default 50 check (ai_monthly_budget_usd >= 0),
  updated_at            timestamptz not null default now(),
  check (weak_cutoff > 0 and weak_cutoff < strong_cutoff)
);
alter table public.scoring_settings enable row level security;

create trigger scoring_settings_updated_at
  before update on public.scoring_settings
  for each row execute function public.set_updated_at();

create policy scoring_settings_select on public.scoring_settings
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy scoring_settings_update on public.scoring_settings
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']))
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- ledgers
-- ---------------------------------------------------------------------------

create table public.ai_calls (
  id            uuid primary key default gen_random_uuid(),
  -- Added beyond §4 so the monthly budget is per workspace (DECISIONS.md D-003).
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  purpose       text not null check (purpose in ('themes', 'report', 'plan')),
  model         text not null,
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd      numeric(10, 6) not null default 0 check (cost_usd >= 0),
  latency_ms    integer not null default 0 check (latency_ms >= 0),
  ok            boolean not null,
  created_at    timestamptz not null default now()
);
alter table public.ai_calls enable row level security;
create index ai_calls_workspace_created_idx on public.ai_calls (workspace_id, created_at desc);

create policy ai_calls_select on public.ai_calls
  for select to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action        text not null,
  subject       text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create index audit_log_workspace_created_idx on public.audit_log (workspace_id, created_at desc);

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

-- creator_id is intentionally NOT a foreign key: the record must outlive the purge it documents.
create table public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  creator_id   uuid not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.deletion_requests enable row level security;
create index deletion_requests_creator_idx on public.deletion_requests (creator_id);

create policy deletion_requests_select on public.deletion_requests
  for select to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants broad table privileges by default; RLS is the real gate,
-- these narrow it further as defence in depth.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

revoke all on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant update (status, decided_at, decided_by) on public.plan_suggestions to authenticated;
grant update (weights, photo_weights, cap, strong_cutoff, weak_cutoff, min_age_hours,
              median_window, schedule_cron, ai_monthly_budget_usd)
  on public.scoring_settings to authenticated;

-- Token columns are never readable through a user session.
revoke select on public.creators from authenticated;
grant select (id, workspace_id, ig_user_id, username, display_name, avatar_url,
              token_expires_at, status, connected_at, last_synced_at)
  on public.creators to authenticated;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated;
grant execute on function public.can_access_creator(uuid) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
