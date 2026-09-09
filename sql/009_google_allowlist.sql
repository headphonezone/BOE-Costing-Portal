-- ---------------------------------------------------------------------------
-- BOE Costing Portal -- migration 009: who may sign in with Google
--
-- WHY THIS EXISTS
--
-- Password accounts are closed by construction: one exists only because an
-- administrator created it, so `to authenticated` was a sufficient test.
--
-- Google sign-in removes that property. Anyone on earth with a Google account
-- can complete the OAuth flow and arrive holding a valid `authenticated`
-- token. Without this migration, moving to Google would silently reopen every
-- table that migration 006 closed -- to a far larger set of people than before
-- it was closed.
--
-- So being signed in stops being the test. Being signed in AND on the list is.
--
-- Two ways onto the list, because both are wanted:
--   * a whole email domain, for colleagues on the company domain
--   * a single address, for anyone outside it
--
-- Someone who signs in without being on either simply sees nothing -- every
-- policy refuses them. That is deliberate: it is a real Google identity, so
-- rejecting them at the door would be a lie about whether they authenticated.
--
-- Idempotent: re-running changes nothing.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. The list
--
-- Readable by any signed-in user so the interface can explain itself to
-- someone who is not on it. Writable only through service_role.
-- ---------------------------------------------------------------------------
create table if not exists app_allowed_domains (
  domain     text primary key,
  added_at   timestamptz not null default now()
);

create table if not exists app_allowed_emails (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now()
);

alter table app_allowed_domains enable row level security;
alter table app_allowed_emails  enable row level security;

drop policy if exists app_allowed_domains_read on app_allowed_domains;
create policy app_allowed_domains_read on app_allowed_domains
  for select to authenticated using (true);

drop policy if exists app_allowed_emails_read on app_allowed_emails;
create policy app_allowed_emails_read on app_allowed_emails
  for select to authenticated using (true);

insert into app_allowed_domains (domain) values ('ferrarivideo.com')
on conflict (domain) do nothing;

-- The administrator, in case the domain entry is ever removed.
insert into app_allowed_emails (email, note) values
  ('data@ferrarivideo.com', 'administrator')
on conflict (email) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The test
--
-- Reads the address from the JWT rather than auth.users, so it costs no join
-- and works for any provider. Case-folded, because Google will not agree with
-- a hand-typed allowlist entry on capitalisation.
-- ---------------------------------------------------------------------------
create or replace function is_member()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with me as (
    select lower(coalesce(auth.jwt() ->> 'email', '')) as email
  )
  select
    exists (select 1 from me where me.email <> '')
    and (
      exists (
        select 1 from app_allowed_emails a, me
        where lower(a.email) = me.email
      )
      or exists (
        select 1 from app_allowed_domains d, me
        where me.email like '%@' || lower(d.domain)
      )
    );
$$;

grant execute on function is_member() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Every policy now requires membership, not merely a session
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['boes','boe_items','boe_licences',
                           'boe_variable_fields','boe_documents']
  loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (is_member())',
      t || '_read', t);
  end loop;
end $$;

drop policy if exists boe_scenarios_all      on boe_scenarios;
drop policy if exists boe_scenario_items_all on boe_scenario_items;

create policy boe_scenarios_all on boe_scenarios
  for all to authenticated
  using (is_member() and scenario_has_access(id))
  with check (is_member() and scenario_has_access(id));

create policy boe_scenario_items_all on boe_scenario_items
  for all to authenticated
  using (is_member() and scenario_has_access(scenario_id))
  with check (is_member() and scenario_has_access(scenario_id));


-- ---------------------------------------------------------------------------
-- 4. An administrator must also be a member
--
-- Otherwise an address removed from the allowlist would keep full access
-- through app_admins, which is the opposite of what removing it means.
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select is_member()
     and exists (select 1 from app_admins a where a.user_id = auth.uid());
$$;


-- ---------------------------------------------------------------------------
-- 5. Keep app_admins in step with Google identities
--
-- An administrator who has only ever signed in with a password has one user
-- id; signing in with Google for the first time may create another. Matching
-- on the address rather than the id keeps the row correct either way.
-- ---------------------------------------------------------------------------
create or replace function sync_admin_ids()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into app_admins (user_id, email)
  select u.id, u.email
  from auth.users u
  join app_admins a on lower(a.email) = lower(u.email)
  on conflict (user_id) do nothing;
$$;

select sync_admin_ids();


-- ---------------------------------------------------------------------------
-- 6. Verify
--
--   select is_member();   -- true for you, false for a stranger's Google account
--   select is_admin();
--
-- Signed in from outside the allowlist, every select must return no rows.
-- ---------------------------------------------------------------------------
