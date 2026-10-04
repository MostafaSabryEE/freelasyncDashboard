"use strict";
/*
 * Authentication & role-based access control for FreelaSync.
 * Client-side only (static GitHub Pages site) -- see README for the
 * security limitations of storing accounts entirely in the browser.
 */
const FreelaAuth = (() => {
    const SESSION_KEY = "freelasync_session";

    const ROLES = {
        admin: {
            label: "Admin",
            manageUsers: true,
            manageProjects: true,
            manageTasks: true,
            manageOwnTasksOnly: false,
            deleteData: true,
            monitorAllProjects: true,
            assignTasks: true,
            addComments: true,
            approveInvoices: true,
            submitInvoices: true
        },
        owner: {
            label: "Owner",
            manageUsers: true,
            manageProjects: false,
            manageTasks: false,
            manageOwnTasksOnly: false,
            deleteData: false,
            monitorAllProjects: true,
            assignTasks: true,
            addComments: true,
            approveInvoices: true,
            submitInvoices: true
        },
        project_manager: {
            label: "Project Manager",
            manageUsers: true,
            manageProjects: true,
            manageTasks: true,
            manageOwnTasksOnly: false,
            deleteData: false,
            monitorAllProjects: true,
            assignTasks: true,
            addComments: true,
            approveInvoices: false,
            submitInvoices: true
        },
        developer: {
            label: "Developer",
            manageUsers: true,
            manageProjects: false,
            manageTasks: true,
            manageOwnTasksOnly: true,
            deleteData: false
        },
        tester: {
            label: "Tester",
            manageUsers: true,
            manageProjects: false,
            manageTasks: true,
            manageOwnTasksOnly: true,
            deleteData: false
        }
    };

    const DEFAULT_USERS = [
        { username: "admin", fullName: "System Administrator", role: "admin", password: "Admin@123" },
        { username: "owner", fullName: "Business Owner", role: "owner", password: "Owner@123" },
        { username: "pmanager", fullName: "Project Manager", role: "project_manager", password: "PManager@123" },
        { username: "developer", fullName: "Developer", role: "developer", password: "Dev@123" },
        { username: "tester", fullName: "QA Tester", role: "tester", password: "Tester@123" }
    ];

    let _currentUser = null;

    async function sha256(text) {
        const enc = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest("SHA-256", enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async function seedDefaultUsers() {
        if (FreelaDB.remoteReady()) return;
        const existing = await FreelaDB.getAll("users");
        const activeExisting = existing.filter(item => item.role !== "product_owner");
        for (const user of existing.filter(item => item.role === "product_owner")) {
            await FreelaDB.remove("users", user.id);
        }
        if (activeExisting.length > 0) return;

        let n = 0;
        for (const u of DEFAULT_USERS) {
            n++;
            const passwordHash = await sha256(u.password);
            await FreelaDB.put("users", {
                id: `U-${String(n).padStart(3, "0")}`,
                username: u.username,
                fullName: u.fullName,
                role: u.role,
                passwordHash,
                createdAt: new Date().toISOString(),
                active: true
            });
        }
        await FreelaDB.put("meta", { key: "userSeq", value: n });
    }

    async function nextUserId() {
        const meta = await FreelaDB.get("meta", "userSeq");
        const next = (meta ? meta.value : 0) + 1;
        await FreelaDB.put("meta", { key: "userSeq", value: next });
        return `U-${String(next).padStart(3, "0")}`;
    }

    async function login(username, password) {
        const client = typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
        if (client) {
            const email = username.trim();
            if (!email.includes("@")) return { ok: false, msg: "Enter the email address used for your Supabase account." };
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error) return { ok: false, msg: error.message };
            const { data: profile, error: profileError } = await client.from("app_users").select("*").eq("id", data.user.id).single();
            if (profileError || !profile || profile.active === false) {
                await client.auth.signOut();
                return { ok: false, msg: "Your account profile is not active yet." };
            }
            _currentUser = { id: profile.id, username: profile.username, fullName: profile.full_name, role: profile.role, active: profile.active, notifications: profile.notifications || [], createdAt: profile.created_at };
            return { ok: true, user: _currentUser };
        }
        const users = await FreelaDB.getAll("users");
        const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.active !== false);
        if (!user) return { ok: false, msg: "Invalid username or password." };

        const hash = await sha256(password);
        if (hash !== user.passwordHash) return { ok: false, msg: "Invalid username or password." };

        _currentUser = user;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username }));
        return { ok: true, user };
    }

    async function logout() {
        _currentUser = null;
        sessionStorage.removeItem(SESSION_KEY);
        const client = typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
        if (client) await client.auth.signOut();
    }

    async function restoreSession() {
        const client = typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
        if (client) {
            const { data } = await client.auth.getSession();
            if (!data.session) return null;
            const { data: profile } = await client.from("app_users").select("*").eq("id", data.session.user.id).maybeSingle();
            if (!profile || profile.active === false) return null;
            _currentUser = { id: profile.id, username: profile.username, fullName: profile.full_name, role: profile.role, active: profile.active, notifications: profile.notifications || [], createdAt: profile.created_at };
            return _currentUser;
        }
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        try {
            const { id } = JSON.parse(raw);
            const user = await FreelaDB.get("users", id);
            if (user && user.active !== false) {
                _currentUser = user;
                return user;
            }
        } catch (e) { /* ignore corrupt session */ }
        sessionStorage.removeItem(SESSION_KEY);
        return null;
    }

    function getCurrentUser() {
        return _currentUser;
    }

    function updateCachedUser(user) {
        _currentUser = user;
    }

    function getPermissions() {
        if (!_currentUser) return ROLES.tester;
        return ROLES[_currentUser.role] || ROLES.tester;
    }

    function roleLabel(roleKey) {
        return (ROLES[roleKey] && ROLES[roleKey].label) || roleKey;
    }

    function canCreateRole(role) {
        const currentRole = _currentUser?.role;
        if (currentRole === "admin") return Boolean(ROLES[role]);
        return ["project_manager", "owner", "tester", "developer"].includes(currentRole) && ["owner", "project_manager", "developer", "tester"].includes(role);
    }

    function canDeleteUser(user) {
        if (_currentUser?.role === "admin") return user?.id !== _currentUser.id;
        return _currentUser?.role === "project_manager" && ["owner", "tester", "developer"].includes(user?.role);
    }

    async function invokeAdminFunction(name, body) {
        const client = typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
        if (!client) return null;
        const { data, error } = await client.functions.invoke(name, { body });
        if (error) {
            let message = error.message || "Request failed.";
            if (error.context) {
                try {
                    const details = await error.context.json();
                    message = details.error || message;
                } catch (e) { /* keep the original message */ }
            }
            return { ok: false, msg: message };
        }
        return { ok: true, user: data?.user };
    }

    async function createUser({ username, fullName, role, password }) {
        if (!getPermissions().manageUsers) return { ok: false, msg: "You do not have permission to manage users." };
        const client = typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
        if (client) {
            if (!canCreateRole(role)) return { ok: false, msg: "You do not have permission to create this role." };
            return invokeAdminFunction("create-user", { email: username, username, fullName, role, password });
        }
        if (!ROLES[role]) return { ok: false, msg: "Invalid user role." };
        if (_currentUser?.role === "project_manager" && role === "admin") {
            return { ok: false, msg: "Project Managers cannot create Admin accounts." };
        }
        const users = await FreelaDB.getAll("users");
        if (users.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
            return { ok: false, msg: "Username already exists." };
        }
        const id = await nextUserId();
        const passwordHash = await sha256(password);
        const record = { id, username: username.trim(), fullName: fullName.trim(), role, passwordHash, createdAt: new Date().toISOString(), active: true };
        await FreelaDB.put("users", record);
        return { ok: true, user: record };
    }

    async function updateUser(id, { fullName, role, password, active }) {
        if (!getPermissions().manageUsers) return { ok: false, msg: "You do not have permission to manage users." };
        const client = typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
        if (client) {
            if (_currentUser?.role !== "admin" && (id !== _currentUser?.id || !password)) return { ok: false, msg: "You can change only your own password." };
            if (!ROLES[role]) return { ok: false, msg: "Invalid user role." };
            const result = await invokeAdminFunction("update-user", { userId: id, fullName, role, password, active });
            if (!result?.ok) return result || { ok: false, msg: "Request failed." };
            const data = result.user;
            const user = { id: data.id, username: data.username, fullName: data.full_name, role: data.role, active: data.active, notifications: data.notifications || [], createdAt: data.created_at };
            if (_currentUser?.id === id) _currentUser = user;
            return { ok: true, user };
        }
        const user = await FreelaDB.get("users", id);
        if (!user) return { ok: false, msg: "User not found." };
        if (_currentUser?.role !== "admin") {
            if (id !== _currentUser?.id || !password) return { ok: false, msg: "You can change only your own password." };
            user.passwordHash = await sha256(password);
            await FreelaDB.put("users", user);
            if (_currentUser && _currentUser.id === id) _currentUser = user;
            return { ok: true, user };
        }
        if (role !== undefined && !ROLES[role]) return { ok: false, msg: "Invalid user role." };
        if (_currentUser?.role === "project_manager" && (user.role === "admin" || role === "admin")) {
            return { ok: false, msg: "Project Managers cannot edit Admin accounts." };
        }
        if (fullName !== undefined) user.fullName = fullName.trim();
        if (role !== undefined) user.role = role;
        if (active !== undefined) user.active = active;
        if (password) user.passwordHash = await sha256(password);
        await FreelaDB.put("users", user);
        if (_currentUser && _currentUser.id === id) _currentUser = user;
        return { ok: true, user };
    }

    async function deleteUser(id) {
        if (!getPermissions().manageUsers) return { ok: false, msg: "You do not have permission to manage users." };
        if (_currentUser && _currentUser.id === id) return { ok: false, msg: "You cannot delete the account you are logged in with." };
        const client = typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
        if (client) {
            const target = await FreelaDB.get("users", id);
            if (!canDeleteUser(target)) return { ok: false, msg: "You do not have permission to delete this user." };
            return invokeAdminFunction("delete-user", { userId: id });
        }
        const user = await FreelaDB.get("users", id);
        if (!canDeleteUser(user)) {
            return { ok: false, msg: "You do not have permission to delete this user." };
        }
        await FreelaDB.remove("users", id);
        return { ok: true };
    }

    return {
        ROLES, seedDefaultUsers, login, logout, restoreSession, getCurrentUser, updateCachedUser,
        getPermissions, roleLabel, canCreateRole, canDeleteUser, createUser, updateUser, deleteUser, sha256
    };
})();
