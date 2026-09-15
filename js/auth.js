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
            deleteData: true
        },
        owner: {
            label: "Owner",
            manageUsers: true,
            manageProjects: true,
            manageTasks: true,
            manageOwnTasksOnly: false,
            deleteData: true
        },
        project_manager: {
            label: "Project Manager",
            manageUsers: false,
            manageProjects: true,
            manageTasks: true,
            manageOwnTasksOnly: false,
            deleteData: true
        },
        product_owner: {
            label: "Product Owner",
            manageUsers: false,
            manageProjects: true,
            manageTasks: true,
            manageOwnTasksOnly: false,
            deleteData: false
        },
        developer: {
            label: "Developer",
            manageUsers: false,
            manageProjects: false,
            manageTasks: true,
            manageOwnTasksOnly: true,
            deleteData: false
        },
        tester: {
            label: "Tester",
            manageUsers: false,
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
        { username: "powner", fullName: "Product Owner", role: "product_owner", password: "POwner@123" },
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
        const existing = await FreelaDB.getAll("users");
        if (existing.length > 0) return;

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
        const users = await FreelaDB.getAll("users");
        const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.active !== false);
        if (!user) return { ok: false, msg: "Invalid username or password." };

        const hash = await sha256(password);
        if (hash !== user.passwordHash) return { ok: false, msg: "Invalid username or password." };

        _currentUser = user;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username }));
        return { ok: true, user };
    }

    function logout() {
        _currentUser = null;
        sessionStorage.removeItem(SESSION_KEY);
    }

    async function signInWithGitHub() {
        const supabaseClient = FreelaSupabase && FreelaSupabase.getClient ? FreelaSupabase.getClient() : null;
        if (!supabaseClient) {
            return { ok: false, msg: "Supabase is not configured yet. Add the URL and anon key first." };
        }

        try {
            const redirectUrl = "https://pmlxghpmfqnehlgsitqe.supabase.co/auth/v1/callback";
            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'github',
                options: {
                    redirectTo: redirectUrl
                }
            });

            if (error) {
                return { ok: false, msg: error.message || "GitHub sign-in failed." };
            }

            return { ok: true };
        } catch (error) {
            return { ok: false, msg: error.message || "GitHub sign-in could not start." };
        }
    }

    async function restoreSession() {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) {
            if (window.supabase && FreelaSupabase && FreelaSupabase.getClient) {
                const supabaseClient = FreelaSupabase.getClient();
                if (supabaseClient) {
                    const { data: { session }, error } = await supabaseClient.auth.getSession();
                    if (!error && session && session.user) {
                        _currentUser = {
                            id: session.user.id,
                            username: session.user.user_metadata?.user_name || session.user.email || "github-user",
                            fullName: session.user.user_metadata?.full_name || session.user.user_metadata?.name || "GitHub User",
                            role: "project_manager",
                            email: session.user.email || "",
                            active: true
                        };
                        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: _currentUser.id, username: _currentUser.username }));
                        return _currentUser;
                    }
                }
            }
            return null;
        }
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

    async function createUser({ username, fullName, role, password }) {
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
        const user = await FreelaDB.get("users", id);
        if (!user) return { ok: false, msg: "User not found." };
        if (fullName !== undefined) user.fullName = fullName.trim();
        if (role !== undefined) user.role = role;
        if (active !== undefined) user.active = active;
        if (password) user.passwordHash = await sha256(password);
        await FreelaDB.put("users", user);
        if (_currentUser && _currentUser.id === id) _currentUser = user;
        return { ok: true, user };
    }

    async function deleteUser(id) {
        if (_currentUser && _currentUser.id === id) return { ok: false, msg: "You cannot delete the account you are logged in with." };
        await FreelaDB.remove("users", id);
        return { ok: true };
    }

    return {
        ROLES, seedDefaultUsers, login, logout, signInWithGitHub, restoreSession, getCurrentUser, updateCachedUser,
        getPermissions, roleLabel, createUser, updateUser, deleteUser, sha256
    };
})();
