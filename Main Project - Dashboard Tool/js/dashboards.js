"use strict";
/*
 * Role dashboards. Project Manager / Admin / Owner see the delivery view
 * (progress, workload, budget, deadlines); the Client sees a read-only
 * summary of their own projects with the budget approval call-to-action.
 */
const FreelaDashboards = (() => {
    const esc = (value) => App.ui.escapeHtml(value);
    const DONE = ["Done", "Delivered"];

    function projectMetrics(project) {
        const tasks = project.tasks || [];
        const done = tasks.filter(task => DONE.includes(task.status)).length;
        const byStatus = {};
        tasks.forEach(task => { const key = task.status || "Not Started"; byStatus[key] = (byStatus[key] || 0) + 1; });
        const open = tasks.filter(task => !DONE.includes(task.status) && task.status !== "Cancelled");
        const upcoming = open.filter(task => task.deadline).map(task => task.deadline).sort()[0] || project.deadline || "";
        return {
            total: tasks.length,
            done,
            percent: tasks.length ? Math.round(done * 100 / tasks.length) : 0,
            byStatus,
            overdue: open.filter(task => App.ui.isOverdue(task.deadline, task.status)).length,
            blocked: tasks.filter(task => task.status === "Blocked" || (task.blockers || []).some(b => b.status === "open")).length,
            nextDeadline: upcoming,
            finance: FreelaFinance.summarize(project)
        };
    }

    function approvalChip(status) {
        const cls = status === "Approved" ? "st-delivered" : status === "Rejected" ? "st-blocked" : "st-on-hold";
        return `<span class="badge ${cls}">Budget ${esc(status)}</span>`;
    }

    // Shared by every audience; `audience` only toggles the internal-only details.
    function renderProjectCard(project, audience) {
        const m = projectMetrics(project);
        const money = (value) => App.ui.formatMoney(value, project.currency);
        const statusPills = Object.entries(m.byStatus).map(([status, count]) => `<span class="badge ${App.ui.getStatusClass(status)}">${esc(status)}: ${count}</span>`).join("");
        const internal = audience === "manager" ? `<div class="dash-flags"><span class="${m.overdue ? "dash-warn" : ""}">${m.overdue} overdue</span><span class="${m.blocked ? "dash-warn" : ""}">${m.blocked} blocked</span></div>` : "";
        const needsApproval = audience === "client" && m.finance.approval.status !== "Approved";
        return `<article class="dash-card" aria-labelledby="dash-${esc(project.id)}">
            <header><h3 id="dash-${esc(project.id)}">${esc(project.name)}</h3><span class="badge ${App.ui.getStatusClass(project.status)}">${esc(project.status)}</span></header>
            <div class="dash-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.percent}" aria-label="Progress of ${esc(project.name)}"><span style="width:${m.percent}%"></span></div>
            <p class="dash-progress-label">${m.percent}% complete &middot; ${m.done}/${m.total} tasks</p>
            <div class="dash-status">${statusPills || '<span class="empty-state">No tasks yet</span>'}</div>
            ${internal}
            <dl class="dash-budget">
                <div><dt>Budget</dt><dd>${money(m.finance.budget)}</dd></div>
                <div><dt>Spent</dt><dd>${money(m.finance.outputs)}</dd></div>
                <div><dt>Remaining</dt><dd class="${m.finance.remaining < 0 ? "dash-warn" : ""}">${money(m.finance.remaining)}</dd></div>
                <div><dt>Next deadline</dt><dd>${esc(m.nextDeadline || "Not set")}</dd></div>
            </dl>
            <footer>${approvalChip(m.finance.approval.status)}
                ${needsApproval ? `<button class="btn-primary btn-sm" onclick="FreelaDashboards.goFinance('${esc(project.id)}')">Review budget</button>` : `<button class="btn-secondary btn-sm" onclick="FreelaDashboards.goFinance('${esc(project.id)}')">Finance</button>`}
                <button class="btn-secondary btn-sm" onclick="FreelaDashboards.goProject('${esc(project.id)}')">Open project</button></footer>
        </article>`;
    }

    function render(panel) {
        if (!panel) return;
        const user = FreelaAuth.getCurrentUser();
        const audience = user?.role === "client" ? "client" : "manager";
        const projects = App.state.getProjects();
        const metrics = projects.map(project => ({ project, m: projectMetrics(project) }));
        const sum = (fn) => metrics.reduce((total, entry) => total + fn(entry), 0);
        const pendingApprovals = metrics.filter(entry => entry.m.finance.approval.status === "Pending").length;
        const title = audience === "client" ? "Client Dashboard" : (user?.role === "project_manager" ? "Project Manager Dashboard" : `${FreelaAuth.roleLabel(user?.role)} Dashboard`);

        const kpis = `<div class="summary-stats" aria-label="Key figures">
            <div class="stat-card"><div class="stat-label">Active projects</div><div class="stat-value">${projects.length}</div></div>
            <div class="stat-card"><div class="stat-label">Overall progress</div><div class="stat-value">${sum(e => e.m.total) ? Math.round(sum(e => e.m.done) * 100 / sum(e => e.m.total)) : 0}%</div></div>
            <div class="stat-card"><div class="stat-label">Open tasks</div><div class="stat-value">${sum(e => e.m.total - e.m.done)}</div></div>
            <div class="stat-card ${pendingApprovals ? "stat-alert" : ""}"><div class="stat-label">Budgets awaiting approval</div><div class="stat-value">${pendingApprovals}</div></div>
            ${audience === "manager" ? `<div class="stat-card ${sum(e => e.m.overdue) ? "stat-alert" : ""}"><div class="stat-label">Overdue tasks</div><div class="stat-value">${sum(e => e.m.overdue)}</div></div>` : ""}
        </div>`;

        const deadlines = metrics.filter(entry => entry.m.nextDeadline).sort((a, b) => a.m.nextDeadline.localeCompare(b.m.nextDeadline)).slice(0, 5);
        const deadlineList = deadlines.length
            ? `<ul class="dash-deadlines">${deadlines.map(entry => `<li><span>${esc(entry.m.nextDeadline)}</span> ${esc(entry.project.name)}</li>`).join("")}</ul>`
            : `<div class="empty-state">No upcoming deadlines.</div>`;

        panel.innerHTML = `
            <div class="panel-header"><span>${title}</span></div>
            ${kpis}
            ${projects.length ? `<div class="dash-grid">${metrics.map(entry => renderProjectCard(entry.project, audience)).join("")}</div>` : `<div class="empty-state">${audience === "client" ? "No projects are linked to your account yet." : "No projects yet. Create one from the Workspace tab."}</div>`}
            <section class="finance-card" aria-labelledby="dashDeadlinesTitle"><h2 id="dashDeadlinesTitle" class="section-title">Upcoming deadlines</h2>${deadlineList}</section>`;
    }

    function goFinance(pid) {
        FreelaFinance.select(pid);
        FreelaTabs.show("finance");
    }

    function goProject(pid) {
        App.state.openProjectDetails(pid);
        FreelaTabs.show("workspace");
    }

    function init() {
        FreelaTabs.register({ id: "dashboard", label: "Dashboard", order: 5, visible: (user, perms) => Boolean(perms.viewDashboard), render });
        App.state.onRefresh(() => { if (FreelaTabs.getActive() === "dashboard") FreelaTabs.renderActive(); });
    }

    return { init, goFinance, goProject };
})();
