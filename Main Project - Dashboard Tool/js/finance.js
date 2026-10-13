"use strict";
/*
 * Finance page: budget, client budget approval, per-user allocation rules
 * and an input/output ledger per project.
 * Access rules:
 *   manageFinance (Admin, Project Manager) -> edit budget, allocations, ledger
 *   approveBudget (Client)                 -> approve / reject the budget of their own projects
 *   Developer / Tester                     -> read only their own allocation and ledger rows
 *   Owner                                  -> manage finance in the teams they own
 * "Other Allocations" is a built-in pseudo member present in every project.
 */
const FreelaFinance = (() => {
    const ALLOCATABLE_ROLES = ["project_manager", "developer", "tester", "owner"];
    const OTHER_ID = "__other__";
    const MILESTONE_STATUSES = ["Planned", "In Progress", "Done"];
    let _selectedId = null;

    const esc = (value) => App.ui.escapeHtml(value);
    const money = (value, currency) => App.ui.formatMoney(value, currency);
    const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

    // Logged hours per user, summed from the time logs of every task in the project.
    function hoursByUser(project) {
        const totals = {};
        (project.tasks || []).forEach(task => (task.logs || []).forEach(log => {
            const key = log.loggedBy || log.loggedByName || "";
            totals[key] = (totals[key] || 0) + (Number(log.hours) || 0);
        }));
        return totals;
    }

    function approvalOf(project) {
        return project.budgetApproval || { status: "Pending", by: "", at: null, note: "" };
    }

    function teamMembers(project) {
        return App.state.getUsers().filter(user =>
            ALLOCATABLE_ROLES.includes(user.role) && user.active !== false &&
            FreelaAuth.teamOf(user) === FreelaAuth.teamOf(project));
    }

    // Rows shown in the allocation table: every team member plus "Other Allocations".
    const allocationRows = (project) => [...teamMembers(project).map(user => user.id), OTHER_ID];

    // Pure summary used by both this page and the dashboards.
    function summarize(project) {
        const budget = Number(project.budget) || 0;
        const allocations = project.allocations || [];
        const transactions = project.transactions || [];
        let inputs = 0, outputs = 0;
        const perUser = {};
        const row = (userId) => perUser[userId] || (perUser[userId] = { userId, percent: 0, allocated: 0, inputs: 0, outputs: 0 });
        allocations.forEach(item => {
            const entry = row(item.userId);
            entry.percent = Number(item.percent) || 0;
            entry.allocated = round2(budget * entry.percent / 100);
        });
        transactions.forEach(item => {
            const amount = Number(item.amount) || 0;
            const entry = row(item.userId);
            if (item.type === "input") { inputs += amount; entry.inputs += amount; }
            else { outputs += amount; entry.outputs += amount; }
        });
        Object.values(perUser).forEach(entry => { entry.remaining = round2(entry.allocated - entry.outputs); });
        return {
            budget,
            inputs: round2(inputs),
            outputs: round2(outputs),
            remaining: round2(budget - outputs),
            allocatedPercent: allocations.reduce((sum, item) => sum + (Number(item.percent) || 0), 0),
            approval: approvalOf(project),
            perUser: Object.values(perUser)
        };
    }

    function permissions() {
        const perms = FreelaAuth.getPermissions();
        const user = FreelaAuth.getCurrentUser();
        return {
            user,
            canManage: Boolean(perms.manageFinance),
            isClient: user?.role === "client",
            ownRowsOnly: ["developer", "tester"].includes(user?.role)
        };
    }

    const nameOf = (userId) => userId === OTHER_ID ? "Other Allocations" : (App.ui.userNameById(userId) || "Unknown user");
    const statusClass = (status) => status === "Approved" ? "st-delivered" : status === "Rejected" ? "st-blocked" : "st-on-hold";

    function renderApproval(project, access, summary) {
        const approval = summary.approval;
        const canDecide = access.isClient && project.clientUserId === access.user.id;
        const meta = approval.at ? `<small>${esc(approval.status)} by ${esc(approval.by)} on ${esc(new Date(approval.at).toLocaleDateString())}${approval.note ? ` - ${esc(approval.note)}` : ""}</small>` : "<small>Waiting for the client to review the budget.</small>";
        const decide = canDecide ? `
            <div class="finance-approve-form">
                <small>You can change your decision at any time.</small>
                <label for="finApprovalNote">Note (optional)</label>
                <input id="finApprovalNote" maxlength="200" placeholder="Comment for the project team">
                <div class="finance-actions">
                    <button class="btn-primary" onclick="FreelaFinance.decide('${esc(project.id)}', 'Approved')">Approve budget</button>
                    <button class="btn-danger" onclick="FreelaFinance.decide('${esc(project.id)}', 'Rejected')">Reject</button>
                </div>
            </div>` : "";
        return `<div class="finance-approval"><span class="badge ${statusClass(approval.status)}">Budget ${esc(approval.status)}</span>${meta}${decide}</div>`;
    }

    function renderBudgetForm(project, access) {
        if (!access.canManage) return "";
        return `<form class="finance-inline-form" onsubmit="FreelaFinance.saveBudget(event, '${esc(project.id)}')">
            <div class="form-group"><label for="finBudget">Project budget (${esc(project.currency || "USD")})</label>
            <input id="finBudget" type="number" min="0" step="0.01" value="${Number(project.budget) || 0}" required></div>
            <button type="submit" class="btn-primary">Save budget</button>
            <small>Changing the budget resets the client approval to Pending.</small></form>`;
    }

    function renderAllocations(project, access, summary) {
        const members = teamMembers(project);
        const current = new Map((project.allocations || []).map(item => [item.userId, item.percent]));
        if (access.isClient) return "";
        const hours = hoursByUser(project);
        const rowsFor = [...(access.ownRowsOnly ? members.filter(user => user.id === access.user.id) : members).map(user => ({ id: user.id, name: user.fullName, role: FreelaAuth.roleLabel(user.role) })),
            ...(access.ownRowsOnly ? [] : [{ id: OTHER_ID, name: "Other Allocations", role: "Default in all projects" }])];
        const rows = rowsFor.map(user => {
            const entry = summary.perUser.find(item => item.userId === user.id) || { percent: 0, allocated: 0, inputs: 0, outputs: 0, remaining: 0 };
            const percentCell = access.canManage
                ? `<input type="number" class="alloc-input" data-user="${esc(user.id)}" min="0" max="100" step="0.5" value="${Number(current.get(user.id)) || 0}" aria-label="Allocation percent for ${esc(user.name)}">`
                : `${entry.percent}%`;
            const logged = user.id === OTHER_ID ? "-" : `${(hours[user.id] || 0).toFixed(2)} h`;
            return `<tr><td>${esc(user.name)}<small> ${esc(user.role)}</small></td><td>${percentCell}</td><td>${money(entry.allocated, project.currency)}</td><td>${logged}</td><td>${money(entry.inputs, project.currency)}</td><td>${money(entry.outputs, project.currency)}</td><td>${money(entry.remaining, project.currency)}</td></tr>`;
        }).join("");
        return `<div class="finance-card">
            <div class="panel-header">Allocation rules &amp; per-user summary</div>
            <div class="table-scroll"><table class="data-table"><caption class="sr-only">Budget allocation per team member</caption>
            <thead><tr><th scope="col">Member</th><th scope="col">Share %</th><th scope="col">Allocated</th><th scope="col">Logged hours</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Remaining</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
            ${access.canManage ? `<div class="finance-actions"><span id="finAllocTotal" aria-live="polite">Total allocated: ${summary.allocatedPercent}%</span>
            <button class="btn-primary" onclick="FreelaFinance.saveAllocations('${esc(project.id)}')">Save allocations</button></div>` : ""}</div>`;
    }

    function renderLedger(project, access) {
        let transactions = [...(project.transactions || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        if (access.ownRowsOnly) transactions = transactions.filter(item => item.userId === access.user.id);
        const rows = transactions.map(item => `<tr>
            <td>${esc(item.date)}</td><td>${esc(nameOf(item.userId))}</td>
            <td><span class="badge ${item.type === "input" ? "st-delivered" : "st-on-hold"}">${item.type === "input" ? "Input" : "Output"}</span></td>
            <td>${money(item.amount, project.currency)}</td><td>${esc(item.description)}</td>
            <td>${access.canManage ? `<button class="btn-danger btn-sm" aria-label="Delete transaction" onclick="FreelaFinance.removeTransaction('${esc(project.id)}', '${esc(item.id)}')">x</button>` : ""}</td></tr>`).join("");
        const members = teamMembers(project);
        const form = access.canManage ? `<form class="finance-inline-form" onsubmit="FreelaFinance.addTransaction(event, '${esc(project.id)}')">
            <div class="form-group"><label for="finTxUser">User</label><select id="finTxUser" required>${members.map(user => `<option value="${esc(user.id)}">${esc(user.fullName)}</option>`).join("")}<option value="${OTHER_ID}">Other Allocations</option></select></div>
            <div class="form-group"><label for="finTxType">Type</label><select id="finTxType"><option value="output">Output (payout / cost)</option><option value="input">Input (income / credit)</option></select></div>
            <div class="form-group"><label for="finTxAmount">Amount</label><input id="finTxAmount" type="number" min="0.01" step="0.01" required></div>
            <div class="form-group"><label for="finTxDate">Date</label><input id="finTxDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
            <div class="form-group"><label for="finTxDesc">Description</label><input id="finTxDesc" maxlength="150" required></div>
            <button type="submit" class="btn-primary">Add entry</button></form>` : "";
        return `<div class="finance-card"><div class="panel-header">Ledger (input / output)</div>${form}
            ${rows ? `<div class="table-scroll"><table class="data-table"><caption class="sr-only">Financial transactions</caption><thead><tr><th scope="col">Date</th><th scope="col">User</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Description</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-state">No transactions recorded yet.</div>`}</div>`;
    }

    function renderMilestones(project, access) {
        if (access.isClient) return "";
        const items = project.milestones || [];
        const showAmount = !access.ownRowsOnly;
        const rows = items.map(item => `<tr>
            <td>${esc(item.title)}</td><td>${esc(item.dueDate || "No due date")}</td>
            <td><span class="badge ${item.status === "Done" ? "st-delivered" : item.status === "In Progress" ? "st-in-progress" : "st-on-hold"}">${esc(item.status)}</span></td>
            ${showAmount ? `<td>${money(item.amount, project.currency)}</td>` : ""}
            <td>${access.canManage ? `<span class="finance-actions">${MILESTONE_STATUSES.filter(status => status !== item.status).map(status => `<button class="btn-secondary btn-sm" onclick="FreelaFinance.setMilestoneStatus('${esc(project.id)}', '${esc(item.id)}', '${status}')">${status}</button>`).join("")}<button class="btn-danger btn-sm" aria-label="Delete milestone ${esc(item.title)}" onclick="FreelaFinance.removeMilestone('${esc(project.id)}', '${esc(item.id)}')">x</button></span>` : ""}</td></tr>`).join("");
        const form = access.canManage ? `<form class="finance-inline-form" onsubmit="FreelaFinance.addMilestone(event, '${esc(project.id)}')">
            <div class="form-group"><label for="finMsTitle">Milestone</label><input id="finMsTitle" maxlength="120" required></div>
            <div class="form-group"><label for="finMsAmount">Amount</label><input id="finMsAmount" type="number" min="0" step="0.01" value="0" required></div>
            <div class="form-group"><label for="finMsDue">Due date</label><input id="finMsDue" type="date"></div>
            <button type="submit" class="btn-primary">Add milestone</button></form>` : "";
        return `<div class="finance-card"><div class="panel-header">Milestones</div>${form}
            ${rows ? `<div class="table-scroll"><table class="data-table"><caption class="sr-only">Project milestones</caption><thead><tr><th scope="col">Milestone</th><th scope="col">Due</th><th scope="col">Status</th>${showAmount ? '<th scope="col">Amount</th>' : ""}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-state">No milestones planned yet.</div>`}</div>`;
    }

    function render(panel) {
        if (!panel) return;
        const projects = App.state.getProjects();
        if (!projects.length) {
            panel.innerHTML = `<div class="panel-header">Finance</div><div class="empty-state">No projects available. Finance records appear once a project exists.</div>`;
            return;
        }
        if (!projects.some(project => project.id === _selectedId)) _selectedId = projects[0].id;
        const project = projects.find(item => item.id === _selectedId);
        const access = permissions();
        const summary = summarize(project);
        const options = projects.map(item => `<option value="${esc(item.id)}" ${item.id === _selectedId ? "selected" : ""}>[${esc(item.id)}] ${esc(item.name)}</option>`).join("");
        const showMetrics = !access.ownRowsOnly;

        panel.innerHTML = `
            <div class="panel-header"><span>Finance</span>
                ${access.canManage ? `<button class="btn-secondary btn-sm" onclick="FreelaFinanceReport.download('${esc(project.id)}')">Generate financial report</button>` : ""}<span class="finance-project-pick"><label for="finProject" class="sr-only">Project</label><select id="finProject" onchange="FreelaFinance.select(this.value)">${options}</select></span></div>
            ${showMetrics ? `<div class="summary-stats" aria-label="Budget key figures">
                <div class="stat-card"><div class="stat-label">Budget</div><div class="stat-value">${money(summary.budget, project.currency)}</div></div>
                <div class="stat-card"><div class="stat-label">Total input</div><div class="stat-value">${money(summary.inputs, project.currency)}</div></div>
                <div class="stat-card"><div class="stat-label">Total output</div><div class="stat-value">${money(summary.outputs, project.currency)}</div></div>
                <div class="stat-card ${summary.remaining < 0 ? "stat-alert" : ""}"><div class="stat-label">Budget remaining</div><div class="stat-value">${money(summary.remaining, project.currency)}</div></div>
            </div>` : ""}
            ${renderApproval(project, access, summary)}
            ${renderBudgetForm(project, access)}
            ${renderMilestones(project, access)}
            ${renderAllocations(project, access, summary)}
            ${renderLedger(project, access)}`;

        panel.querySelectorAll(".alloc-input").forEach(input => input.addEventListener("input", updateAllocTotal));
    }

    function updateAllocTotal() {
        const total = Array.from(document.querySelectorAll(".alloc-input")).reduce((sum, input) => sum + (Number(input.value) || 0), 0);
        const label = document.getElementById("finAllocTotal");
        if (label) {
            label.textContent = `Total allocated: ${total}%${total > 100 ? " (cannot exceed 100%)" : ""}`;
            label.classList.toggle("finance-over", total > 100);
        }
    }

    const findProject = (pid) => App.state.getProjects().find(item => item.id === pid);

    function guardManage() {
        if (permissions().canManage) return true;
        App.ui.showNotify("You do not have permission to change financial settings.", "error");
        return false;
    }

    async function persist(project, message) {
        await App.state.saveProject(project);
        App.state.refreshDashboard();
        if (message) App.ui.showNotify(message);
    }

    async function saveBudget(event, pid) {
        event.preventDefault();
        const project = findProject(pid);
        if (!project || !guardManage()) return;
        const budget = round2(document.getElementById("finBudget").value);
        if (budget < 0) return;
        if (budget !== Number(project.budget)) project.budgetApproval = { status: "Pending", by: "", at: null, note: "" };
        project.budget = budget;
        await persist(project, "Budget saved. Awaiting client approval.");
    }

    async function saveAllocations(pid) {
        const project = findProject(pid);
        if (!project || !guardManage()) return;
        const allocations = Array.from(document.querySelectorAll(".alloc-input"))
            .map(input => ({ userId: input.dataset.user, percent: round2(input.value) }))
            .filter(item => item.percent > 0);
        const total = allocations.reduce((sum, item) => sum + item.percent, 0);
        if (allocations.some(item => item.percent < 0 || item.percent > 100) || total > 100) {
            App.ui.showNotify("Allocations must be between 0 and 100% and total at most 100%.", "error");
            return;
        }
        project.allocations = allocations;
        await persist(project, "Allocation rules saved.");
    }

    async function addMilestone(event, pid) {
        event.preventDefault();
        const project = findProject(pid);
        if (!project || !guardManage()) return;
        project.milestones = project.milestones || [];
        project.milestones.unshift({
            id: `MS-${Date.now()}`,
            title: document.getElementById("finMsTitle").value.trim(),
            amount: round2(document.getElementById("finMsAmount").value),
            dueDate: document.getElementById("finMsDue").value,
            status: "Planned",
            createdAt: new Date().toISOString()
        });
        App.state.recordActivity(project, "milestone_added", `Milestone "${project.milestones[0].title}" planned.`);
        await persist(project, "Milestone added.");
    }

    async function setMilestoneStatus(pid, milestoneId, status) {
        const project = findProject(pid);
        const milestone = project && (project.milestones || []).find(item => item.id === milestoneId);
        if (!milestone || !MILESTONE_STATUSES.includes(status) || !guardManage()) return;
        milestone.status = status;
        App.state.recordActivity(project, "milestone_updated", `Milestone "${milestone.title}" marked ${status}.`);
        await persist(project);
    }

    async function removeMilestone(pid, milestoneId) {
        const project = findProject(pid);
        if (!project || !guardManage() || !confirm("Delete this milestone?")) return;
        project.milestones = (project.milestones || []).filter(item => item.id !== milestoneId);
        await persist(project, "Milestone removed.");
    }

    async function addTransaction(event, pid) {
        event.preventDefault();
        const project = findProject(pid);
        if (!project || !guardManage()) return;
        const type = document.getElementById("finTxType").value;
        if (type === "output" && approvalOf(project).status !== "Approved") {
            App.ui.showNotify("The client must approve the budget before outputs can be recorded.", "error");
            return;
        }
        project.transactions = project.transactions || [];
        project.transactions.push({
            id: `TX-${Date.now()}`,
            type,
            userId: document.getElementById("finTxUser").value,
            amount: round2(document.getElementById("finTxAmount").value),
            date: document.getElementById("finTxDate").value,
            description: document.getElementById("finTxDesc").value.trim(),
            createdBy: FreelaAuth.getCurrentUser().id
        });
        await persist(project, "Ledger entry added.");
    }

    async function removeTransaction(pid, txId) {
        const project = findProject(pid);
        if (!project || !guardManage() || !confirm("Delete this ledger entry?")) return;
        project.transactions = (project.transactions || []).filter(item => item.id !== txId);
        await persist(project, "Ledger entry removed.");
    }

    async function decide(pid, decision) {
        const project = findProject(pid);
        const access = permissions();
        if (!project || !FreelaAuth.getPermissions().approveBudget || project.clientUserId !== access.user.id) {
            App.ui.showNotify("Only the client linked to this project can decide on the budget.", "error");
            return;
        }
        const note = (document.getElementById("finApprovalNote")?.value || "").trim();
        try {
            if (FreelaDB.remoteReady()) {
                await FreelaDB.rpc("approve_project_budget", { p_project_id: pid, p_decision: decision, p_note: note });
                await App.state.reloadProjects();
            } else {
                project.budgetApproval = { status: decision, by: access.user.fullName, at: new Date().toISOString(), note };
                await App.state.saveProject(project);
            }
        } catch (error) {
            App.ui.showNotify(error.message || "Could not save the decision.", "error");
            return;
        }
        App.state.refreshDashboard();
        App.ui.showNotify(`Budget ${decision.toLowerCase()}.`);
    }

    function select(pid) {
        _selectedId = pid;
        FreelaTabs.renderActive();
    }

    function init() {
        FreelaTabs.register({
            id: "finance", label: "Finance", order: 30,
            visible: () => true,
            render
        });
        App.state.onRefresh(() => { if (FreelaTabs.getActive() === "finance") FreelaTabs.renderActive(); });
    }

    return { init, OTHER_ID, nameOf, hoursByUser, allocationRows, addMilestone, setMilestoneStatus, removeMilestone, summarize, select, saveBudget, saveAllocations, addTransaction, removeTransaction, decide };
})();
