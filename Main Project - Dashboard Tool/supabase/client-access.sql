-- Restrict client accounts to assigned app_projects and prevent client writes.
-- Run after schema.sql on an existing Supabase project.

create or replace function public.is_app_client()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.app_users
        where id = auth.uid() and role = 'client' and active = true
    );
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select role::text from public.app_users
    where id = auth.uid() and active = true;
$$;

drop policy if exists "Users can update their own app profile" on public.app_users;
create policy "Users can update their own app profile"
    on public.app_users for update to authenticated
    using (id = auth.uid() or public.is_app_admin())
    with check (
        public.is_app_admin()
        or (id = auth.uid() and role::text = public.current_app_role() and active = true)
    );

drop policy if exists "Authenticated users can read app projects" on public.app_projects;
create policy "Authenticated users can read app projects"
    on public.app_projects for select to authenticated
    using (
        public.is_app_admin()
        or not public.is_app_client()
        or data ->> 'clientUserId' = auth.uid()::text
    );

drop policy if exists "Authenticated users can create app projects" on public.app_projects;
create policy "Authenticated users can create app projects"
    on public.app_projects for insert to authenticated
    with check (not public.is_app_client() and updated_by = auth.uid());

drop policy if exists "Authenticated users can update app projects" on public.app_projects;
create policy "Authenticated users can update app projects"
    on public.app_projects for update to authenticated
    using (not public.is_app_client())
    with check (not public.is_app_client() and updated_by = auth.uid());
