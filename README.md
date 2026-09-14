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

## 4. Data storage & security notes (read before publishing)

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

## 5. Run locally

Just open `index.html` in a browser, or serve the folder with any static
server, for example:

```powershell
# From the project folder
python -m http.server 8080
# then browse to http://localhost:8080
```

## 6. Publish on GitHub Pages — step by step

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

## 7. Changing the default passwords / roles

Before publishing publicly, open `js/auth.js` and edit the `DEFAULT_USERS`
array to set your own usernames/passwords, or simply sign in as `admin` /
`owner` after first launch and use the **User Management** tab to edit or
delete the seeded accounts and create your real team accounts.
