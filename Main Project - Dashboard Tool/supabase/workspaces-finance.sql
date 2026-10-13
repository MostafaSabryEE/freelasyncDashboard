-- MS-CollabDash: teams (workspaces), personal to-dos and client budget approval.
-- Run after schema.sql and client-access.sql. Safe to re-run.

-- 1. Teams ---------------------------------------------------------------
create table if not exists public.app_teams (
    id text primary key,
    name text not null unique,
    created_at timestamptz not null default now()
);

-- The Business Owner who created the team; only they (and admins) have authority over it.
alter table public.app_teams add column if not exists owner_id uuid references auth.users(id) on delete set null;

insert into public.app_teams (id, name) values ('T-001', 'Default Team')
on conflict (id) do nothing;

alter table public.app_users
    add column if not exists team_id text not null default 'T-001' references public.app_teams(id);

create or replace function public.current_app_team()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select team_id from public.app_users
    where id = auth.uid() and active = true;
$$;

-- Admin, member of the team, or the Business Owner who owns the team.
create or replace function public.can_access_team(p_team text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.is_app_admin()
        or p_team = public.current_app_team()
        or exists (
            select 1 from public.app_teams t
            join public.app_users u on u.id = auth.uid() and u.active = true and u.role = 'owner'
            where t.id = p_team and t.owner_id = auth.uid()
        );
$$;

-- Business Owner of the given team (used for delete rules).
create or replace function public.owns_team(p_team text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.app_teams t
        join public.app_users u on u.id = auth.uid() and u.active = true and u.role = 'owner'
        where t.id = p_team and t.owner_id = auth.uid()
    );
$$;

alter table public.app_teams enable row level security;

drop policy if exists "Users can read their team" on public.app_teams;
create policy "Users can read their team"
    on public.app_teams for select to authenticated
    using (public.can_access_team(id));

-- Only Business Owners create teams; they fully manage the teams they created.
drop policy if exists "Admins manage teams" on public.app_teams;
drop policy if exists "Owners create teams" on public.app_teams;
create policy "Owners create teams"
    on public.app_teams for insert to authenticated
    with check (owner_id = auth.uid() and public.current_app_role() = 'owner');

drop policy if exists "Owners update their teams" on public.app_teams;
create policy "Owners update their teams"
    on public.app_teams for update to authenticated
    using (public.owns_team(id))
    with check (owner_id = auth.uid());

drop policy if exists "Owners delete their teams" on public.app_teams;
create policy "Owners delete their teams"
    on public.app_teams for delete to authenticated
    using (public.owns_team(id));

-- Claim the seeded default team for the first owner (if nobody owns it yet).
update public.app_teams
set owner_id = (select id from public.app_users where role = 'owner' and team_id = 'T-001' order by created_at limit 1)
where id = 'T-001' and owner_id is null;

-- 2. Team isolation on users and projects -------------------------------
drop policy if exists "Authenticated users can read app users" on public.app_users;
create policy "Authenticated users can read app users"
    on public.app_users for select to authenticated
    using (
        id = auth.uid()
        or public.is_app_admin()
        or (active = true and public.can_access_team(team_id))
    );

-- Business Owners delete users inside the teams they own; admins delete anyone.
drop policy if exists "Owners delete users in their teams" on public.app_users;
create policy "Owners delete users in their teams"
    on public.app_users for delete to authenticated
    using (role <> 'admin' and id <> auth.uid() and public.owns_team(team_id));

drop policy if exists "Authenticated users can read app projects" on public.app_projects;
create policy "Authenticated users can read app projects"
    on public.app_projects for select to authenticated
    using (
        public.is_app_admin()
        or (
            public.can_access_team(coalesce(data ->> 'teamId', 'T-001'))
            and (not public.is_app_client() or data ->> 'clientUserId' = auth.uid()::text)
        )
    );

drop policy if exists "Authenticated users can create app projects" on public.app_projects;
create policy "Authenticated users can create app projects"
    on public.app_projects for insert to authenticated
    with check (
        not public.is_app_client()
        and updated_by = auth.uid()
        and public.can_access_team(coalesce(data ->> 'teamId', 'T-001'))
    );

drop policy if exists "Authenticated users can update app projects" on public.app_projects;
create policy "Authenticated users can update app projects"
    on public.app_projects for update to authenticated
    using (
        not public.is_app_client()
        and public.can_access_team(coalesce(data ->> 'teamId', 'T-001'))
    )
    with check (
        not public.is_app_client()
        and updated_by = auth.uid()
        and public.can_access_team(coalesce(data ->> 'teamId', 'T-001'))
    );

-- Business Owners may delete any project inside a team they own.
drop policy if exists "Owners delete projects in their teams" on public.app_projects;
create policy "Owners delete projects in their teams"
    on public.app_projects for delete to authenticated
    using (public.owns_team(coalesce(data ->> 'teamId', 'T-001')));

-- Only administrators may move a user between teams.
create or replace function public.prevent_app_user_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.role is distinct from new.role
       or old.active is distinct from new.active
       or old.team_id is distinct from new.team_id then
        if auth.role() <> 'service_role' and not public.is_app_admin() then
            raise exception 'Only administrators can change user roles, status or team';
        end if;
    end if;
    return new;
end;
$$;

-- 3. Personal to-do items (private to their owner) ----------------------
create table if not exists public.app_todos (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    done boolean not null default false,
    created_at timestamptz not null default now()
);

alter table public.app_todos enable row level security;

drop policy if exists "Users manage their own todos" on public.app_todos;
create policy "Users manage their own todos"
    on public.app_todos for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- 4. Client budget approval ----------------------------------------------
-- Clients cannot write app_projects directly, so the decision goes through
-- this function, which only touches data.budgetApproval of their own project.
create or replace function public.approve_project_budget(p_project_id text, p_decision text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user public.app_users%rowtype;
    v_data jsonb;
begin
    if p_decision not in ('Approved', 'Rejected') then
        raise exception 'Invalid decision';
    end if;

    select * into v_user from public.app_users where id = auth.uid() and active = true;
    if not found or v_user.role::text <> 'client' then
        raise exception 'Only the client can decide on the budget';
    end if;

    select data into v_data from public.app_projects where id = p_project_id for update;
    if v_data is null or v_data ->> 'clientUserId' is distinct from auth.uid()::text then
        raise exception 'Project not found for this client';
    end if;

    v_data := jsonb_set(v_data, '{budgetApproval}', jsonb_build_object(
        'status', p_decision,
        'by', v_user.full_name,
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'note', left(coalesce(p_note, ''), 200)
    ));

    update public.app_projects set data = v_data, updated_at = now() where id = p_project_id;
    return v_data -> 'budgetApproval';
end;
$$;

revoke all on function public.approve_project_budget(text, text, text) from public;
grant execute on function public.approve_project_budget(text, text, text) to authenticated;

-- 5. Realtime ---------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'app_teams') then
        alter publication supabase_realtime add table public.app_teams;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'app_todos') then
        alter publication supabase_realtime add table public.app_todos;
    end if;
end;
$$;
