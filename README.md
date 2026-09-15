# FREELASYNC — Project & Task Management Tool

A single client-side web application (HTML + CSS + JavaScript) for managing
projects, planned tasks, and logged work time. It runs entirely in the
browser, stores its data in **IndexedDB** (with an automatic `localStorage`
fallback), and is ready to be published as a **static site on GitHub Pages** —
no server, database server, or build step required.

Built by **Mostafa Sabry**.

---

## 1. Features

- **Login screen** with the FreelaSync logo and a role-based user directory.
- **User management** (Admin / Owner only) — create, edit, disable, and
  delete accounts for the following roles:
  | Role | Key | Typical permissions |
  |---|---|---|
  | Admin | `admin` | Full access: users, projects, tasks, deletions |
  | Owner | `owner` | Full access: users, projects, tasks, deletions |
  | Project Manager | `project_manager` | Manage projects & tasks, delete data, no user management |
  | Product Owner | `product_owner` | Manage projects & tasks, no deletions, no user management |
  | Developer | `developer` | View assigned projects, update/log time on **own** assigned tasks |
  | Tester | `tester` | View assigned projects, update/log time on **own** assigned tasks |
- **Projects, Tasks & Time Logs** — create projects, plan tasks, assign them
  to a user, and log start/end time windows against each task.
- **Comment history** per project, with author and timestamp.
- **Dashboards** with live stats (project count, planned tasks, total hours).
- **HTML report export** per project, and a full JSON **database
  export/import** for backups.
- **Phase 1 Supabase foundation** — a normalized shared-backend schema and
  browser client configuration are included under `supabase/` and `js/`.
- **Phase 2 Monitoring MVP** — searchable project monitoring, task priorities,
  dependencies, blockers, Kanban status movement, overdue/workload metrics,
  activity feeds, and local notifications.
- **Phase 3 Communication MVP** — threaded project replies, @mentions,
  decision records, meeting notes, and attachment links.
- **Phase 4 SDLC MVP** — requirements, acceptance criteria, test cases, bug
  records, approvals, and release planning.
- **Phase 5 freelance operations** — milestone planning, invoicing, billing
  status, and project value monitoring for client work and contractor delivery.
- **Theme matched to the brand logo** — navy blue (`#1f6fb2`) and teal/green
  (`#14b8a6`) accents on a dark UI.

## 2. Project structure

```
index.html            Login screen + application shell (entry point)
assets/logo.png        Brand logo used in the header, login screen and favicon
css/styles.css         All styling (dark theme, colors derived from the logo)
js/db.js               IndexedDB wrapper ("users", "projects", "meta" stores)
js/auth.js              Authentication, password hashing (SHA-256), roles
js/users.js            User management UI (Admin/Owner only)
js/app.js               Projects / tasks / time-log business logic & rendering
Arcive/                 Previous tool versions (kept for history, not used by the site)
```

## 3. Default demo accounts

The first time the app runs in a browser it seeds these accounts
(`js/auth.js` → `DEFAULT_USERS`). **Change these passwords before sharing the
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
3. In Supabase **Project Settings → API**, copy the project URL and the public
  `anon` key into `js/supabase-config.js`.
4. Never copy the `service_role` key into frontend code or commit it to GitHub.
5. The next phase will replace local login and browser storage with Supabase
  Auth and the tables created by this schema.

The schema creates organizations, profiles, memberships, projects, tasks,
comments, time logs, activity events, decisions, meeting notes, and attachment
metadata. Row-level security is
enabled with read policies for authenticated members; write policies will be
added alongside the application operations so each workflow is authorized at
the database boundary.

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

## 5. Data storage & security notes (read before publishing)

This is a **static site** — there is no backend server, so all data (users,
projects, tasks, time logs) lives **only in each visitor's own browser**
(IndexedDB). This means:

- Every visitor gets their own independent, empty database on first visit.
- Data is **not shared** between different people or devices automatically.
  Use **Export Database** / **Import** (top-right buttons) to move project
  data between browsers/computers.
- Passwords are hashed with SHA-256 client-side, but **anyone who opens the
  browser DevTools can read the IndexedDB contents**. Do not use this tool
  for sensitive/confidential data, and do not reuse real-world passwords for
  the demo accounts.
- If you need multi-user, server-synced data with real authentication, you
  would need to add a backend (e.g. Firebase, Supabase, or your own API) —
  this project intentionally has none so it can be hosted for free on GitHub
  Pages.

## 6. Run locally

Just open `index.html` in a browser, or serve the folder with any static
server, for example:

```powershell
# From the project folder
python -m http.server 8080
# then browse to http://localhost:8080
```

## 7. Publish on GitHub Pages — step by step

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
   git commit -m "Initial commit: FreelaSync static site"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

   Replace `<your-username>` and `<your-repo>` with your actual GitHub
   username and repository name.

3. **Enable GitHub Pages**
   - In your repository on GitHub, go to **Settings** → **Pages** (left
     sidebar, under "Code and automation").
   - Under **Build and deployment → Source**, choose **Deploy from a
     branch**.
   - Under **Branch**, select `main` and folder `/ (root)`, then click
     **Save**.

4. **Wait for the deployment**
   - GitHub will build and publish the site (usually takes 30–60 seconds).
   - Refresh the **Settings → Pages** screen; a green banner will show your
     live URL, typically:
     ```
     https://<your-username>.github.io/<your-repo>/
     ```

5. **Verify the site**
   - Open the URL from step 4.
   - You should see the FreelaSync login screen with the logo.
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
and set the custom domain under **Settings → Pages → Custom domain**.

## 8. Changing the default passwords / roles

Before publishing publicly, open `js/auth.js` and edit the `DEFAULT_USERS`
array to set your own usernames/passwords, or simply sign in as `admin` /
`owner` after first launch and use the **User Management** tab to edit or
delete the seeded accounts and create your real team accounts.
