# MS-CollabDash â€” Project & Task Management

A single client-side web application (HTML + CSS + JavaScript) for managing
projects, planned tasks, and logged work time. It runs entirely in the
browser, stores its data in **IndexedDB** (with an automatic `localStorage`
fallback), and is ready to be published as a **static site on GitHub Pages** â€”
no server, database server, or build step required.

Built by **Mostafa Sabry**.

---

## 1. Features

- **Login screen** with the brand logo and role-based dashboard views.
- **User management** (Admin / Owner only) â€” create, edit, disable, and
  delete accounts for the following roles:
  | Role | Key | Typical permissions |
  |---|---|---|
  | Admin | `admin` | Full access: users, projects, tasks, deletions |
  | Owner | `owner` | Full access: users, projects, tasks, deletions |
  | Project Manager | `project_manager` | Manage projects & tasks, delete data, no user management |
  | Product Owner | `product_owner` | Manage projects & tasks, no deletions, no user management |
  | Developer | `developer` | View assigned projects, update/log time on **own** assigned tasks |
  | Tester | `tester` | View assigned projects, update/log time on **own** assigned tasks |
  | Client | `client` | Read-only progress view for projects explicitly linked to the account |
- **Projects, Tasks & Time Logs** â€” create projects, plan tasks, assign them
  to a user, and log start/end time windows against each task.
- **Comment history** per project, with author and timestamp.
- **Dashboards** with live stats (project count, planned tasks, total hours).
- **Client portal view** â€” assign a client account to a project to show its status,
  task progress, and milestones without exposing internal finance or team notes.
- **Accessible responsive theme** â€” persistent light/dark modes, keyboard-accessible
  navigation, visible focus, and layouts that adapt to desktop, tablet, and mobile.
- **HTML report export** per project, and a full JSON **database
  export/import** for backups.
- **Phase 1 Supabase foundation** â€” a normalized shared-backend schema and
  browser client configuration are included under `supabase/` and `js/`.
- **Phase 2 Monitoring MVP** â€” searchable project monitoring, task priorities,
  dependencies, blockers, Kanban status movement, overdue/workload metrics,
  activity feeds, and local notifications.
- **Phase 3 Communication MVP** â€” threaded project replies, @mentions,
  decision records, meeting notes, and attachment links.
- **Phase 4 SDLC MVP** â€” requirements, acceptance criteria, test cases, bug
  records, approvals, and release planning.
- **Phase 5 freelance operations** â€” milestone planning, invoicing, billing
  status, and project value monitoring for client work and contractor delivery.

## 2. Project structure

```
index.html            Login screen + application shell (entry point)
assets/logo.png        Brand logo used in the header, login screen and favicon
css/styles.css         Responsive light/dark theme and component styles
js/theme.js            Persistent light/dark theme toggle
js/db.js               IndexedDB wrapper ("users", "projects", "meta" stores)
js/auth.js              Authentication, password hashing (SHA-256), roles
js/users.js            User management UI (Admin/Owner only)
js/app.js               Projects / tasks / time-log business logic & rendering
Arcive/                 Previous tool versions (kept for history, not used by the site)
```

## 3. Default demo accounts

The first time the app runs in a browser it seeds these accounts
(`js/auth.js` â†’ `DEFAULT_USERS`). **Change these passwords before sharing the
site publicly** (see Security notes below).

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin@123` | Admin |
| `owner` | `Owner@123` | Owner |
| `pmanager` | `PManager@123` | Project Manager |
| `powner` | `POwner@123` | Product Owner |
| `developer` | `Dev@123` | Developer |
| `tester` | `Tester@123` | Tester |

## 4. Phase 1 shared backend setup

The current UI still uses IndexedDB until the data/auth adapters are migrated.
Phase 1 prepares the production backend without placing secrets in the
repository:

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as Vercel Production
   environment variables. The Vercel build script writes them into the static
   browser configuration.
4. Never copy the `service_role` key into frontend code or commit it to GitHub.

The schema creates organizations, profiles, memberships, projects, tasks,
comments, time logs, activity events, decisions, meeting notes, and attachment
metadata. Row-level security is
enabled with read policies for authenticated members; write policies will be
added alongside the application operations so each workflow is authorized at
the database boundary.

### Shared Supabase workspace setup

The browser UI now uses Supabase Auth and the shared `app_users`,
`app_projects`, and `app_meta` tables when `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are configured. Run the complete `supabase/schema.sql`
file in the SQL Editor, then create the first user in **Authentication â†’
Users â†’ Add user**. Promote that user to an administrator in SQL:

```sql
update public.app_users
set role = 'admin', active = true
where id = 'AUTH_USER_UUID';
```

Replace `AUTH_USER_UUID` with the UUID shown for the Auth user. Additional
users can be created from the application through the protected
`create-user` Edge Function, and password/profile changes use
`update-user`.

### Deploy user-management Edge Functions

From the project folder, authenticate the Supabase CLI through `npx`:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set --env-file .env.supabase
npx supabase functions deploy create-user
npx supabase functions deploy update-user
npx supabase functions deploy delete-user
```

Before the `secrets set` command, create a local `.env.supabase` file with
this one line, replacing the value with your Supabase Secret key:

```text
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

The file is ignored by Git and should never be committed. The service-role
key is stored only as an Edge Function secret. Never put it in Vercel
environment variables or frontend files. The functions verify that the
caller is an active `admin` in `app_users` before creating accounts or
changing passwords.

### Phase 2 local test checklist

1. Start the site with `python -m http.server 8080`.
2. Sign in as `admin` or `pmanager`.
3. Create projects and tasks with different priorities, deadlines, and
  assignees.
4. Open **Kanban** in the monitoring workspace and drag tasks between status
  columns.
5. Open a task, add dependencies or a blocker, then resolve the blocker.
6. Test search, project status, priority, and assignee filters.
7. Assign a task to another demo user, log out, sign in as that user, and
  inspect the notification badge and notification list.

### Phase 3 local test checklist

1. Open a project and post a comment containing `@developer`.
2. Sign in as `developer` and verify the mention appears in Notifications.
3. Reply to a project comment.
4. Add a decision and a meeting note with action items.
5. Link a shared file URL under Attachments and open it in a new tab.
6. Confirm all communication records remain after refreshing the page.

Phase 3 stores attachment links locally for now. Supabase Storage upload,
private file access, and shared realtime threads will be connected when the
Supabase data/auth migration is implemented.

### Phase 4 local test checklist

1. Open a project and a task.
2. Add a requirement and acceptance criteria.
3. Add a test case, then mark it Passed or Failed.
4. Report a bug and verify it appears under the task.
5. Request an approval, then approve or reject it as a manager.
6. Plan a release with a version and release notes.
7. Refresh the page and confirm the SDLC records remain available.

### Phase 5 local test checklist

1. Open an individual project and review the new Finance Snapshot panel.
2. Add a milestone with a target date and amount, then mark it in progress or done.
3. Add an invoice with an amount and due date, then update it to Paid or Pending.
4. Confirm the collected, outstanding, and milestone totals update immediately.
5. Refresh the browser and verify the billing data remains stored locally.


### Teams, finance, to-do and dashboards (latest)
Run supabase/workspaces-finance.sql in the Supabase SQL editor **after** schema.sql, then redeploy the `create-user` and `update-user` Edge Functions (they now carry `team_id`).

- **Teams** (admin): isolated workspaces; users and projects belong to one team and only see their own team (enforced by RLS in Supabase, UI-filtered in local mode).
- **Task attachments**: every task has a type (Development / Test) and attachments (name + URL). Requirements, test cases and bug reports were removed from tasks.
- **My To-Do**: personal items plus tasks assigned to you (ticking an assigned task toggles Done / In Progress).
- **Finance**: Project Manager sets the budget and each user's percentage; input/output ledger per user; the client approves (or rejects) the budget and outputs stay blocked until approval. Budget edits reset approval to Pending.
- **Dashboard**: Project Manager and Client views with progress, tasks, budget and deadlines.
- Access: `manageFinance` (admin, PM), `approveBudget` (client), `manageTeams` / `viewAllTeams` (admin), `viewDashboard` (admin, owner, PM, client).

## 5. Data storage & security notes (read before publishing)

Without Supabase configuration, this is a **static site** and data lives only
in each visitor's browser (IndexedDB). With Supabase configuration, users,
projects, tasks, and time logs are stored in the shared Supabase workspace:

- Local fallback data is not synchronized with Supabase.
- Supabase Auth manages passwords; do not use the old demo passwords in shared
  mode.
- Row-level security protects the shared tables, but the current compatibility
  tables represent one shared workspace. Organization-specific isolation can
  be added when the normalized tables become the primary data model.

## 6. Run locally

Just open `index.html` in a browser, or serve the folder with any static
server, for example:

```powershell
# From the project folder
python -m http.server 8080
# then browse to http://localhost:8080
```

For shared Supabase mode, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` before
running the Vercel build script. Do not use the Supabase `service_role` key.

### Migrating existing browser data

1. Before enabling Supabase, sign in as the local admin and click **Export
  Database**.
2. Configure Supabase and deploy the updated site.
3. Create the first Auth user, promote it to `admin` using the SQL above, and
  sign in with that email.
4. Click **Import** and select the exported JSON backup. Projects and their
  nested tasks, comments, logs, and operations data will be uploaded to the
  shared workspace. Local password hashes are intentionally not imported;
  create users through Supabase Authentication.

## 7. Publish on GitHub Pages â€” step by step

1. **Create a GitHub repository**
   - Go to [github.com/new](https://github.com/new).
   - Name it (e.g. `freelasync`), keep it **Public** (GitHub Pages on the
     free plan requires a public repo unless you have GitHub Pro/Enterprise),
     then click **Create repository**.

2. **Push this project folder to the repository**

   Open a terminal in the project folder (`PRJ-01 - Dashboard Tool`) and run:

   ```powershell
   git init
   git add .
   git commit -m "Initial commit: MS-CollabDash"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

   Replace `<your-username>` and `<your-repo>` with your actual GitHub
   username and repository name.

3. **Enable GitHub Pages**
   - In your repository on GitHub, go to **Settings** â†’ **Pages** (left
     sidebar, under "Code and automation").
   - Under **Build and deployment â†’ Source**, choose **Deploy from a
     branch**.
   - Under **Branch**, select `main` and folder `/ (root)`, then click
     **Save**.

4. **Wait for the deployment**
   - GitHub will build and publish the site (usually takes 30â€“60 seconds).
   - Refresh the **Settings â†’ Pages** screen; a green banner will show your
     live URL, typically:
     ```
     https://<your-username>.github.io/<your-repo>/
     ```

5. **Verify the site**
   - Open the URL from step 4.
   - You should see the MS-CollabDash login screen with the logo.
   - Sign in with one of the demo accounts from section 3 to confirm
     everything works.

6. **Updating the site later**
   - Make your changes locally, then run:
     ```powershell
     git add .
     git commit -m "Update site"
     git push
     ```
   - GitHub Pages automatically redeploys on every push to `main`.

### Optional: custom domain

If you own a domain, add a `CNAME` file with your domain name to the project
root, then configure the domain's DNS with a `CNAME` record pointing to
`<your-username>.github.io` (or `A` records for an apex domain, per
[GitHub's custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)),
and set the custom domain under **Settings â†’ Pages â†’ Custom domain**.

## 8. Changing the default passwords / roles

Before publishing publicly, open `js/auth.js` and edit the `DEFAULT_USERS`
array to set your own usernames/passwords, or simply sign in as `admin` /
`owner` after first launch and use the **User Management** tab to edit or
delete the seeded accounts and create your real team accounts.

To set up a client dashboard, create a user with the **Client** role, then
select that account in **Client Portal Account** when creating or editing a
project. Client accounts see only linked projects and have a read-only
progress view. When using an existing Supabase project, run `supabase/client-access.sql` in
the SQL editor to apply the client-specific row policies. For new projects,
the same policies are included in `supabase/schema.sql`. The static IndexedDB
mode is intended for local/demo use and is not a server-side security boundary.

## Brand assets

Regenerate the logo and favicons (`assets/favicon-32.png`, `favicon-64.png`, `favicon.ico`, etc.) from `New Logo 2.jpg` with `pip install pillow` then `python scripts/generate-brand-assets.py`. Brand colors, Inter typography and the 8px spacing scale are CSS variables at the end of `css/styles.css`.
## Roles, approvals and financial report (latest)

- **User creation:** only Admin, Business Owner and Project Manager can create users. Admin can delete any user; a Business Owner can delete users only in teams they created (Project Managers can no longer delete users).
- **Teams:** only a Business Owner can create teams (Admins can view all). The owner has full authority over that team and its projects (manage, finance, delete). Teams store `owner_id`.
- **Approvals (Project page):** each request has an assignee who approves it. Decisions stay editable: Approve, Reject or Reopen at any time. The client's budget approval on the Finance tab can also be changed.
- **Finance tab:** Milestones moved here (Milestones and Invoices were removed from the Project page); allocation table has an *Other Allocations* row in every project and a *Logged hours* column; *Generate financial report* downloads a detailed HTML report (tasks, attachments, category summary, progress).
- **Deploy:** re-run `supabase/workspaces-finance.sql` and redeploy the `create-user` and `delete-user` edge functions.
