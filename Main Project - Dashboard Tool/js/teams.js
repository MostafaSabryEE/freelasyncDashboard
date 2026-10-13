"use strict";
/*
 * Team (workspace) management. Each team has its own users and projects;
 * only Business Owners can create teams (and rename the teams they own); Admins can see every team.
 */
const FreelaTeams = (() => {
    const esc = (value) => App.ui.escapeHtml(value);

    function teamName(teamId) {
        const team = App.state.getTeams().find(item => item.id === teamId);
        return team ? team.name : "Unassigned";
    }

    function options(selectedId) {
        return FreelaAuth.accessibleTeams().map(team => `<option value="${esc(team.id)}" ${team.id === selectedId ? "selected" : ""}>${esc(team.name)}</option>`).join("");
    }

    function render(panel) {
        if (!panel) return;
        const teams = FreelaAuth.accessibleTeams();
        const me = FreelaAuth.getCurrentUser();
        const canCreate = Boolean(FreelaAuth.getPermissions().createTeams);
        const users = App.state.getUsers();
        const projects = App.state.getProjects();
        const rows = teams.map(team => `<tr>
            <td>${esc(team.name)}<small> ${esc(team.id)}</small></td>
            <td>${users.filter(user => FreelaAuth.teamOf(user) === team.id).length}</td>
            <td>${projects.filter(project => FreelaAuth.teamOf(project) === team.id).length}</td>
            <td>${esc(App.ui.userNameById(team.ownerId) || "�")}</td>
            <td>${canCreate && team.ownerId === me?.id ? `<button class="btn-secondary btn-sm" onclick="FreelaTeams.rename('${esc(team.id)}')">Rename</button>` : ""}</td></tr>`).join("");
        panel.innerHTML = `
            <div class="panel-header"><span>Teams</span><span class="todo-count">${teams.length} teams</span></div>
            <p class="section-hint">Each team only sees its own users and projects. Assign users and projects to a team to keep workspaces separate.</p>
            ${canCreate ? `<form class="todo-form" onsubmit="FreelaTeams.create(event)">
                <label for="teamName" class="sr-only">New team name</label>
                <input id="teamName" maxlength="60" placeholder="New team name" required>
                <button type="submit" class="btn-primary">Create team</button>
            </form>` : ""}
            ${rows ? `<div class="table-scroll"><table class="data-table"><caption class="sr-only">Teams</caption><thead><tr><th scope="col">Team</th><th scope="col">Users</th><th scope="col">Projects</th><th scope="col">Owner</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-state">No teams yet.</div>`}`;
    }

    async function refreshAll() {
        await App.state.reloadUsers();
        App.state.syncDropdowns();
        FreelaTabs.renderActive();
    }

    async function create(event) {
        event.preventDefault();
        if (!FreelaAuth.getPermissions().createTeams) { App.ui.showNotify("Only Business Owners can create teams.", "error"); return; }
        const name = document.getElementById("teamName").value.trim();
        if (!name) return;
        if (App.state.getTeams().some(team => team.name.toLowerCase() === name.toLowerCase())) {
            App.ui.showNotify("A team with this name already exists.", "error");
            return;
        }
        const seq = await App.state.nextSeq("teamSeq");
        await FreelaDB.put("teams", { id: `T-${String(seq + 1).padStart(3, "0")}`, name, ownerId: FreelaAuth.getCurrentUser().id, createdAt: new Date().toISOString() });
        App.ui.showNotify(`Team [${name}] created.`);
        await refreshAll();
    }

    async function rename(teamId) {
        const team = App.state.getTeams().find(item => item.id === teamId);
        if (!team || team.ownerId !== FreelaAuth.getCurrentUser()?.id) return;
        App.ui.openModal("Rename Team", `<div class="form-group"><label for="dlgTeamName">Team name</label><input id="dlgTeamName" value="${esc(team.name)}" maxlength="60"></div>`, async () => {
            const name = document.getElementById("dlgTeamName").value.trim();
            if (!name) return;
            await FreelaDB.put("teams", { ...team, name });
            App.ui.closeModal();
            await refreshAll();
        });
    }

    function init() {
        FreelaTabs.register({ id: "teams", label: "Teams", order: 40, visible: (user, perms) => Boolean(perms.manageTeams), render });
    }

    return { init, teamName, options, create, rename };
})();
