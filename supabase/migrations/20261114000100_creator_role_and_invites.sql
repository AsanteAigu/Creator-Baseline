-- Creator logins see only their own account (D-011, confirmed by the client 14 Nov 2026) and
-- members join through single-use invite links instead of a terminal script (D-040).

-- ---------------------------------------------------------------------------
-- creator role: a member tied to one creator
-- ---------------------------------------------------------------------------

alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('owner', 'admin', 'viewer', 'creator'));

-- Null until the creator connects their Instagram. Set null on purge, so a creator whose
-- account was deleted sees nothing rather than losing their login.
alter table public.workspace_members
  add column creator_id uuid references public.creators (id) on delete set null;
alter table public.workspace_members
  add constraint workspace_members_creator_only check (creator_id is null or role = 'creator');
create index workspace_members_creator_idx on public.workspace_members (creator_id) where creator_id is not null;

-- Every creator-scoped policy goes through this function, so narrowing it narrows them all:
-- staff see every creator in their workspace, a creator member only their own.
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
    where c.id = cid
      and m.user_id = auth.uid()
      and (m.role <> 'creator' or m.creator_id = cid)
  );
$$;

-- Was workspace membership alone; now the same rule as every child table.
drop policy creators_select on public.creators;
create policy creators_select on public.creators
  for select to authenticated
  using (public.can_access_creator(id));

-- A creator sees only their own membership row, not the rest of the agency.
drop policy workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (
    public.has_workspace_role(workspace_id, array['owner', 'admin', 'viewer'])
    or user_id = auth.uid()
  );

-- scoring_settings stays readable to every member: a creator's own account page shows the
-- weights its scores were computed with, and the settings name no creator.

-- ---------------------------------------------------------------------------
-- invites
-- ---------------------------------------------------------------------------

create table public.workspace_invites (
  id          uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email       text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role        text not null check (role in ('admin', 'viewer', 'creator')),
  -- sha256 of the link token; the token itself is shown once and never stored.
  token_hash  text not null unique,
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
alter table public.workspace_invites enable row level security;
create index workspace_invites_workspace_idx on public.workspace_invites (workspace_id, created_at desc);

create policy workspace_invites_select on public.workspace_invites
  for select to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

-- Writes go through the service layer after its role check; end users only ever read.
revoke all on public.workspace_invites from anon;
revoke all on public.workspace_invites from authenticated;
grant select (id, workspace_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by)
  on public.workspace_invites to authenticated;
