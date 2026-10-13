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
            manageFinance: true,
            createUsers: true,
            manageTeams: true,
            viewDashboard: true,
            viewAllTeams: true
        },
        owner: {
            label: "Owner",
            manageUsers: true,
            createUsers: true,
            manageProjects: true,
            manageTasks: true,
            manageOwnTasksOnly: false,
            deleteData: true,
            monitorAllProjects: true,
            assignTasks: true,
            addComments: true,
            manageFinance: true,
            createTeams: true,
            manageTeams: true,
            viewDashboard: true
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
            manageFinance: true,
            createUsers: true,
            viewDashboard: true
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
        },
        client: {
            label: "Client",
            manageUsers: false,
            manageProjects: false,
            manageTasks: false,
            manageOwnTasksOnly: false,
            deleteData: false,
            monitorAllProjects: false,
            assignTasks: false,
            addComments: false,
            approveBudget: true,
            viewDashboard: true
        }
    };

    const DEFAULT_TEAM_ID = "T-001";
    const DEFAULT_TEAM = { id: DEFAULT_TEAM_ID, name: "Default Team" };

    // Legacy records without a team belong to the default team.
    const teamOf = (entity) => (entity && entity.teamId) || DEFAULT_TEAM_ID;

    const DEFAULT_USERS = [
        { username: "admin", fullName: "System Administrator", role: "admin", password: "Admin@123" },
        { username: "owner", fullName: "Business Owner", role: "owner", password: "Owner@123" },
        { username: "pmanager", fullName: "Project Manager", role: "project_manager", password: "PManager@123" },
        { username: "developer", fullName: "Developer", role: "developer", password: "Dev@123" },
        { username: "tester", fullName: "QA Tester", role: "tester", password: "Tester@123" },
        { username: "client", fullName: "Demo Client", role: "client", password: "Client@123" }
    ];

    let _currentUser = null;

    async function sha256(text) {
        const enc = new TextEncoder().encode(text);
        const buf = await crypto.subtle.digest("SHA-256", enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async function ensureDefaultTeam() {
        if (FreelaDB.remoteReady()) return;
        if (!(await FreelaDB.get("teams", DEFAULT_TEAM_ID))) {
            await FreelaDB.put("teams", { ...DEFAULT_TEAM, createdAt: new Date().toISOString() });
        }
    }

    // The seeded default team belongs to the first Business Owner in it.
    async function claimDefaultTeam() {
        if (FreelaDB.remoteReady()) return;
        const team = await FreelaDB.get("teams", DEFAULT_TEAM_ID);
        if (!team || team.ownerId) return;
        const users = await FreelaDB.getAll("users");
        const owner = users.find(u => u.role === "owner" && teamOf(u) === DEFAULT_TEAM_ID);
        if (owner) await FreelaDB.put("teams", { ...team, ownerId: owner.id });
    }

    async function seedDefaultUsers() {
        if (FreelaDB.remoteReady()) return;
        await ensureDefaultTeam();
        const existing = await FreelaDB.getAll("users");
        const activeExisting = existing.filter(item => item.role !== "product_owner");
        for (const user of existing.filter(item => item.role === "product_owner")) {
            await FreelaDB.remove("users", user.id);
        }
        if (activeExisting.length > 0) { await claimDefaultTeam(); return; }

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
                teamId: DEFAULT_TEAM_ID,
                createdAt: new Date().toISOString(),
                active: true
            });
        }
        await FreelaDB.put("meta", { key: "userSeq", value: n });
        await claimDefaultTeam();
    }

    async function nextUserId() {
        const meta = await FreelaDB.get("meta", "userSeq");
        const next = (meta ? meta.value : 0) + 1;
        await FreelaDB.put("meta", { key: "userSeq", value: next });
        return `U-${String(next).padStart(3, "0")}`;
    }

    const getRemoteClient = () => (typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null);

    const profileToUser = (profile) => ({
        id: profile.id,
        username: profile.username,
        fullName: profile.full_name,
        role: profile.role,
        active: profile.active,
        notifications: profile.notifications || [],
        teamId: profile.team_id || DEFAULT_TEAM_ID,
        createdAt: profile.created_at
    });

    async function login(username, password) {
        const client = getRemoteClient();
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
            _currentUser = profileToUser(profile);
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
        const client = getRemoteClient();
        if (client) await client.auth.signOut();
    }

    async function restoreSession() {
        const client = getRemoteClient();
        if (client) {
            const { data } = await client.auth.getSession();
            if (!data.session) return null;
            const { data: profile } = await client.from("app_users").select("*").eq("id", data.session.user.id).maybeSingle();
            if (!profile || profile.active === false) return null;
            _currentUser = profileToUser(profile);
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

    let _teams = [];
    const setTeams = (teams) => { _teams = teams || []; };

    // Teams owned by the current Business Owner.
    const ownedTeamIds = () => _teams.filter(t => t.ownerId && t.ownerId === _currentUser?.id).map(t => t.id);

    // Admin sees every team; an Owner sees their own team plus teams they own; others only their own team.
    function canAccessTeam(teamId) {
        if (!_currentUser) return false;
        if (_currentUser.role === "admin") return true;
        if (teamId === teamOf(_currentUser)) return true;
        return _currentUser.role === "owner" && ownedTeamIds().includes(teamId);
    }

    const accessibleTeams = () => _teams.filter(t => canAccessTeam(t.id));

    function canCreateRole(role) {
        const currentRole = _currentUser?.role;
        if (!getPermissions().createUsers) return false;
        if (currentRole === "admin") return Boolean(ROLES[role]);
        return ["owner", "project_manager", "developer", "tester", "client"].includes(role);
    }

    // Admin: any user but self. Owner: users (not admins/self) inside teams they created.
    function canDeleteUser(user) {
        if (!_currentUser || !user || user.id === _currentUser.id) return false;
        if (_currentUser.role === "admin") return true;
        return _currentUser.role === "owner" && user.role !== "admin" && ownedTeamIds().includes(teamOf(user));
    }

    // Admin may place a user in any team; an Owner only in teams they can access; others inherit their own.
    function resolveTeamId(requested) {
        if (requested && (_currentUser?.role === "admin" || (_currentUser?.role === "owner" && canAccessTeam(requested)))) return requested;
        return teamOf(_currentUser);
    }

    async function invokeAdminFunction(name, body) {
        const client = getRemoteClient();
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

    async function createUser({ username, fullName, role, password, teamId }) {
        if (!getPermissions().createUsers) return { ok: false, msg: "Only Admins, Business Owners and Project Managers can create users." };
        const client = getRemoteClient();
        if (client) {
            if (!canCreateRole(role)) return { ok: false, msg: "You do not have permission to create this role." };
            return invokeAdminFunction("create-user", { email: username, username, fullName, role, password, teamId: resolveTeamId(teamId) });
        }
        if (!ROLES[role]) return { ok: false, msg: "Invalid user role." };
        if (!canCreateRole(role)) return { ok: false, msg: "You do not have permission to create this role." };
        const users = await FreelaDB.getAll("users");
        if (users.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
            return { ok: false, msg: "Username already exists." };
        }
        const id = await nextUserId();
        const passwordHash = await sha256(password);
        const record = { id, username: username.trim(), fullName: fullName.trim(), role, passwordHash, teamId: resolveTeamId(teamId), createdAt: new Date().toISOString(), active: true };
        await FreelaDB.put("users", record);
        return { ok: true, user: record };
    }

    async function updateUser(id, { fullName, role, password, active, teamId }) {
        if (!getPermissions().manageUsers) return { ok: false, msg: "You do not have permission to manage users." };
        const client = getRemoteClient();
        if (client) {
            if (_currentUser?.role !== "admin" && (id !== _currentUser?.id || !password)) return { ok: false, msg: "You can change only your own password." };
            if (!ROLES[role]) return { ok: false, msg: "Invalid user role." };
            const result = await invokeAdminFunction("update-user", { userId: id, fullName, role, password, active, teamId });
            if (!result?.ok) return result || { ok: false, msg: "Request failed." };
            const user = profileToUser(result.user);
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
        if (fullName !== undefined) user.fullName = fullName.trim();
        if (role !== undefined) user.role = role;
        if (active !== undefined) user.active = active;
        if (teamId) user.teamId = teamId;
        if (password) user.passwordHash = await sha256(password);
        await FreelaDB.put("users", user);
        if (_currentUser && _currentUser.id === id) _currentUser = user;
        return { ok: true, user };
    }

    async function deleteUser(id) {
        if (!getPermissions().manageUsers) return { ok: false, msg: "You do not have permission to manage users." };
        if (_currentUser && _currentUser.id === id) return { ok: false, msg: "You cannot delete the account you are logged in with." };
        const client = getRemoteClient();
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
        ROLES, DEFAULT_TEAM_ID, teamOf, ensureDefaultTeam, seedDefaultUsers, login, logout, restoreSession, getCurrentUser, updateCachedUser,
        getPermissions, roleLabel, setTeams, resolveTeamId, ownedTeamIds, canAccessTeam, accessibleTeams, canCreateRole, canDeleteUser, createUser, updateUser, deleteUser, sha256
    };
})();
