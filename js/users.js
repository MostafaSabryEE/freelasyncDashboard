"use strict";
/*
 * User management panel (Admin / Project Manager only).
 */
const FreelaUsers = (() => {
    let _users = [];

    const dom = {
        panel: null
    };

    function init() {
        dom.panel = document.getElementById("users_panel");
    }

    async function refresh() {
        _users = await FreelaDB.getAll("users");
        render();
    }

    function render() {
        if (!dom.panel) return;
        const perms = FreelaAuth.getPermissions();
        const currentUser = FreelaAuth.getCurrentUser();
        if (!perms.manageUsers) {
            dom.panel.innerHTML = "";
            return;
        }

        const rows = _users.map(u => {
            const canEdit = currentUser?.role === "admin" || u.id === currentUser?.id;
            const canChangePassword = u.id === currentUser?.id && currentUser?.role !== "admin";
            const canDelete = FreelaAuth.canDeleteUser(u);
            const actions = [
                canChangePassword ? `<button class="btn-secondary btn-sm" onclick="FreelaUsers.openEdit('${u.id}')">Change Password</button>` : (canEdit ? `<button class="btn-secondary btn-sm" onclick="FreelaUsers.openEdit('${u.id}')">Edit</button>` : ""),
                canDelete ? `<button class="btn-danger btn-sm" onclick="FreelaUsers.remove('${u.id}')">Delete</button>` : '<span style="color:var(--text-muted); font-size:0.75rem;">Protected</span>'
            ].filter(Boolean).join("");
            return `
            <tr>
                <td>${u.username}</td>
                <td>${u.fullName}</td>
                <td><span class="badge role-badge role-${u.role}">${FreelaAuth.roleLabel(u.role)}</span></td>
                <td>${u.active === false ? '<span class="badge st-blocked">Disabled</span>' : '<span class="badge st-delivered">Active</span>'}</td>
                <td class="user-row-actions">
                    ${actions}
                </td>
            </tr>
        `;
        }).join("");

        const roleOptions = Object.keys(FreelaAuth.ROLES)
            .filter(key => FreelaAuth.canCreateRole(key))
            .map(key => `<option value="${key}">${FreelaAuth.ROLES[key].label}</option>`).join("");
        const remoteMode = FreelaDB.remoteReady();

        dom.panel.innerHTML = `
            <div class="panel-header">
                <span>User Management</span>
                <span style="font-size:0.75rem; color:var(--text-muted);">${_users.length} accounts</span>
            </div>
            <form id="newUserForm" class="form-row" style="grid-template-columns: 1fr 1fr 1fr 1fr auto; align-items:end;">
                <div class="form-group"><label>${remoteMode ? "Email" : "Username"}</label><input type="${remoteMode ? "email" : "text"}" id="nuUsername" required maxlength="120"></div>
                <div class="form-group"><label>Full Name</label><input type="text" id="nuFullName" required maxlength="80"></div>
                <div class="form-group"><label>Role</label><select id="nuRole">${roleOptions}</select></div>
                <div class="form-group"><label>Password</label><input type="password" id="nuPassword" required minlength="6"></div>
                <button type="submit" class="btn-primary" style="height:36px;">Add User</button>
            </form>
            <table class="data-table">
                <thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        document.getElementById("newUserForm").addEventListener("submit", handleCreate);
    }

    async function handleCreate(e) {
        e.preventDefault();
        const username = document.getElementById("nuUsername").value.trim();
        const fullName = document.getElementById("nuFullName").value.trim();
        const role = document.getElementById("nuRole").value;
        const password = document.getElementById("nuPassword").value;

        const result = await FreelaAuth.createUser({ username, fullName, role, password });
        if (!result.ok) {
            App.ui.showNotify(result.msg, "error");
            return;
        }
        App.ui.showNotify(`User [${username}] created.`);
        e.target.reset();
        await refresh();
    }

    function openEdit(id) {
        const user = _users.find(u => u.id === id);
        if (!user) return;
        const currentUser = FreelaAuth.getCurrentUser();
        const isAdmin = currentUser?.role === "admin";
        if (!isAdmin && user.id !== currentUser?.id) {
            App.ui.showNotify("You can change only your own password.", "error");
            return;
        }
        const roleOptions = Object.keys(FreelaAuth.ROLES)
            .map(key => `<option value="${key}" ${key === user.role ? "selected" : ""}>${FreelaAuth.ROLES[key].label}</option>`).join("");

        const html = `
            <div class="form-group"><label>Username</label><input type="text" value="${user.username}" disabled></div>
            ${isAdmin ? `<div class="form-group"><label>Full Name</label><input type="text" id="euFullName" value="${user.fullName}"></div>
            <div class="form-group"><label>Role</label><select id="euRole">${roleOptions}</select></div>
            <div class="form-group"><label>Status</label>
                <select id="euActive">
                    <option value="true" ${user.active !== false ? "selected" : ""}>Active</option>
                    <option value="false" ${user.active === false ? "selected" : ""}>Disabled</option>
                </select>
            </div>` : `<input type="hidden" id="euFullName" value="${user.fullName}"><input type="hidden" id="euRole" value="${user.role}"><input type="hidden" id="euActive" value="true">`}
            <div class="form-group"><label>${isAdmin ? "New Password (optional)" : "New Password"}</label><input type="password" id="euPassword" minlength="6" ${isAdmin ? 'placeholder="Leave blank to keep current password"' : "required"}></div>
        `;
        App.ui.openModal("Edit User", html, async () => {
            const fullName = document.getElementById("euFullName").value.trim();
            const role = document.getElementById("euRole").value;
            const password = document.getElementById("euPassword").value;
            const active = document.getElementById("euActive").value === "true";

            const result = await FreelaAuth.updateUser(id, { fullName, role, password: password || undefined, active });
            if (!result.ok) {
                App.ui.showNotify(result.msg, "error");
                return;
            }
            App.ui.closeModal();
            App.ui.showNotify("User updated.");
            await refresh();
            App.ui.renderHeaderUser();
        });
    }

    async function remove(id) {
        const user = _users.find(item => item.id === id);
        if (!FreelaAuth.canDeleteUser(user)) {
            App.ui.showNotify("You do not have permission to delete this user.", "error");
            return;
        }
        if (!confirm("Delete this user account permanently?")) return;
        const result = await FreelaAuth.deleteUser(id);
        if (!result.ok) {
            App.ui.showNotify(result.msg, "error");
            return;
        }
        App.ui.showNotify("User deleted.");
        await refresh();
    }

    return { init, refresh, openEdit, remove };
})();
