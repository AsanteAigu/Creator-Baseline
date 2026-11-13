-- LOCAL DEVELOPMENT ONLY. Never applied to a Supabase project.
--
-- Supabase provides the `auth` schema and the anon / authenticated / service_role roles.
-- This shim recreates the minimum the migrations depend on, so the schema (and its RLS)
-- can be exercised on a plain Postgres install without Docker. scripts/migrate.ts applies
-- it whenever the database is not a Supabase project. Every statement is idempotent.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create extension if not exists pgcrypto;

-- encrypted_password mirrors the GoTrue column (bcrypt), used only by local dev sign-in.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  created_at         timestamptz not null default now()
);
alter table auth.users add column if not exists encrypted_password text;

-- Mirrors Supabase's definition: the subject claim of the request JWT.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
