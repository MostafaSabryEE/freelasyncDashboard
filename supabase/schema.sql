-- FreelaSync Phase 1 foundation schema.
-- Run this file in the Supabase SQL Editor after creating a project.

create extension if not exists pgcrypto;

create type public.member_role as enum (
    'admin',
    'owner',
    'project_manager',
    'product_owner',
    'developer',
    'tester',
    'client'
);

create type public.project_status as enum (
    'Not Started',
    'In Progress',
    'Blocked',
    'Cancelled',
    'Reviewing',
    'Delivered',
    'On Hold'
);

create type public.task_status as enum (
    'Not Started',
    'In Progress',
    'Blocked',
    'Cancelled',
    'Done',
    'On Hold'
);

create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(trim(name)) between 2 and 120),
    created_at timestamptz not null default now(),
    created_by uuid not null references auth.users(id)
);

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null check (char_length(trim(full_name)) between 2 and 120),
    time_zone text not null default 'UTC',
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.organization_members (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    role public.member_role not null default 'developer',
    created_at timestamptz not null default now(),
    primary key (organization_id, user_id)
);

create table public.projects (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    name text not null check (char_length(trim(name)) between 2 and 160),
    client_name text not null check (char_length(trim(client_name)) between 2 and 160),
    project_type text not null default 'Hourly',
    status public.project_status not null default 'Not Started',
    deadline date,
    created_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.project_members (
    project_id uuid not null references public.projects(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (project_id, user_id)
);

create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    title text not null check (char_length(trim(title)) between 2 and 240),
    status public.task_status not null default 'Not Started',
    deadline date,
    assigned_to uuid references public.profiles(id),
    description text,
    created_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.project_comments (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    author_id uuid not null references public.profiles(id),
    body text not null check (char_length(trim(body)) between 1 and 10000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.project_decisions (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    title text not null check (char_length(trim(title)) between 2 and 240),
    rationale text not null check (char_length(trim(rationale)) between 1 and 10000),
    status text not null default 'Recorded',
    author_id uuid not null references public.profiles(id),
    created_at timestamptz not null default now()
);

create table public.meeting_notes (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    subject text not null check (char_length(trim(subject)) between 2 and 240),
    notes text not null check (char_length(trim(notes)) between 1 and 20000),
    author_id uuid not null references public.profiles(id),
    created_at timestamptz not null default now()
);

create table public.attachments (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    task_id uuid references public.tasks(id) on delete cascade,
    name text not null check (char_length(trim(name)) between 1 and 240),
    storage_path text not null,
    content_type text,
    size_bytes bigint,
    uploaded_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now()
);

create table public.requirements (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    task_id uuid references public.tasks(id) on delete cascade,
    title text not null,
    acceptance_criteria text not null,
    status text not null default 'Open',
    created_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now()
);

create table public.test_cases (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    task_id uuid references public.tasks(id) on delete cascade,
    title text not null,
    expected_result text not null,
    status text not null default 'Not Run',
    executed_by uuid references public.profiles(id),
    executed_at timestamptz,
    created_at timestamptz not null default now()
);

create table public.bugs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    task_id uuid references public.tasks(id) on delete cascade,
    title text not null,
    details text not null,
    severity text not null default 'Medium',
    status text not null default 'Open',
    reported_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now()
);

create table public.project_approvals (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    subject text not null,
    status text not null default 'Pending',
    requested_by uuid not null references public.profiles(id),
    decided_by uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    decided_at timestamptz
);

create table public.releases (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    version text not null,
    notes text not null,
    status text not null default 'Planned',
    planned_date date,
    created_by uuid not null references public.profiles(id),
    created_at timestamptz not null default now()
);

create table public.time_logs (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.tasks(id) on delete cascade,
    logged_by uuid not null references public.profiles(id),
    started_at timestamptz not null,
    ended_at timestamptz not null,
    comment text,
    created_at timestamptz not null default now(),
    constraint time_logs_valid_window check (ended_at > started_at)
);

create table public.activity_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    project_id uuid references public.projects(id) on delete cascade,
    actor_id uuid not null references public.profiles(id),
    event_type text not null,
    entity_type text not null,
    entity_id uuid,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index projects_organization_id_idx on public.projects(organization_id);
create index tasks_project_id_idx on public.tasks(project_id);
create index tasks_assigned_to_idx on public.tasks(assigned_to);
create index project_comments_project_id_idx on public.project_comments(project_id, created_at desc);
create index project_decisions_project_id_idx on public.project_decisions(project_id, created_at desc);
create index meeting_notes_project_id_idx on public.meeting_notes(project_id, created_at desc);
create index attachments_project_id_idx on public.attachments(project_id, created_at desc);
create index requirements_project_id_idx on public.requirements(project_id, created_at desc);
create index test_cases_project_id_idx on public.test_cases(project_id, created_at desc);
create index bugs_project_id_idx on public.bugs(project_id, created_at desc);
create index project_approvals_project_id_idx on public.project_approvals(project_id, created_at desc);
create index releases_project_id_idx on public.releases(project_id, created_at desc);
create index time_logs_task_id_idx on public.time_logs(task_id, started_at desc);
create index activity_events_organization_id_idx on public.activity_events(organization_id, created_at desc);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.organization_members
        where organization_id = target_organization_id
          and user_id = auth.uid()
    );
$$;

create or replace function public.is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.project_members
        where project_id = target_project_id
          and user_id = auth.uid()
    ) or exists (
        select 1
        from public.projects p
        join public.organization_members om on om.organization_id = p.organization_id
        where p.id = target_project_id
          and om.user_id = auth.uid()
    );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.project_comments enable row level security;
alter table public.project_decisions enable row level security;
alter table public.meeting_notes enable row level security;
alter table public.attachments enable row level security;
alter table public.requirements enable row level security;
alter table public.test_cases enable row level security;
alter table public.bugs enable row level security;
alter table public.project_approvals enable row level security;
alter table public.releases enable row level security;
alter table public.time_logs enable row level security;
alter table public.activity_events enable row level security;

create policy "Users can read their own profile"
    on public.profiles for select using (id = auth.uid());

create policy "Members can read their organizations"
    on public.organizations for select using (public.is_organization_member(id));

create policy "Members can read organization membership"
    on public.organization_members for select using (public.is_organization_member(organization_id));

create policy "Members can read projects"
    on public.projects for select using (public.is_organization_member(organization_id));

create policy "Members can read project membership"
    on public.project_members for select using (public.is_project_member(project_id));

create policy "Members can read tasks"
    on public.tasks for select using (public.is_project_member(project_id));

create policy "Members can read project comments"
    on public.project_comments for select using (public.is_project_member(project_id));

create policy "Members can read project decisions"
    on public.project_decisions for select using (public.is_project_member(project_id));

create policy "Members can read meeting notes"
    on public.meeting_notes for select using (public.is_project_member(project_id));

create policy "Members can read attachments"
    on public.attachments for select using (public.is_project_member(project_id));

create policy "Members can read requirements"
    on public.requirements for select using (public.is_project_member(project_id));

create policy "Members can read test cases"
    on public.test_cases for select using (public.is_project_member(project_id));

create policy "Members can read bugs"
    on public.bugs for select using (public.is_project_member(project_id));

create policy "Members can read project approvals"
    on public.project_approvals for select using (public.is_project_member(project_id));

create policy "Members can read releases"
    on public.releases for select using (public.is_project_member(project_id));

create policy "Members can read time logs"
    on public.time_logs for select using (
        exists (
            select 1 from public.tasks t
            where t.id = task_id and public.is_project_member(t.project_id)
        )
    );

create policy "Members can read activity events"
    on public.activity_events for select using (public.is_organization_member(organization_id));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
    return new;
end;
$$;

create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();