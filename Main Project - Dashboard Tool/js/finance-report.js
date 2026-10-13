"use strict";
/*
 * Per-project financial report (standalone HTML download).
 * Sections: budget & approval, allocations with logged hours, ledger, milestones,
 * task details, and a Development / Testing / Finance category summary with progress.
 */
const FreelaFinanceReport = (() => {
    const DONE = ["Done", "Delivered"];
    const esc = (value) => App.ui.escapeHtml(value);

    const percent = (done, total) => (total ? Math.round((done / total) * 100) : 0);
    const hoursOf = (task) => (task.logs || []).reduce((sum, log) => sum + (Number(log.hours) || 0), 0);

    function progressBar(value) {
        return `<div class="bar" role="img" aria-label="${value}% complete"><span style="width:${value}%"></span></div><small>${value}%</small>`;
    }

    function categorySummary(project, summary) {
        const tasks = project.tasks || [];
        const byType = (type) => tasks.filter(task => (task.taskType || "Development") === type);
        const taskCategory = (label, list) => {
            const done = list.filter(task => DONE.includes(task.status)).length;
            return { label, items: `${done} of ${list.length} tasks done`, hours: list.reduce((sum, task) => sum + hoursOf(task), 0), value: percent(done, list.length) };
        };
        const milestones = project.milestones || [];
        const milestonesDone = milestones.filter(item => item.status === "Done").length;
        const finance = {
            label: "Finance",
            items: `${milestonesDone} of ${milestones.length} milestones done; ${summary.allocatedPercent}% of budget allocated`,
            hours: null,
            value: percent(milestonesDone, milestones.length)
        };
        return [taskCategory("Development", byType("Development")), taskCategory("Testing", byType("Test")), finance];
    }

    function attachmentsHtml(task) {
        const list = task.attachments || [];
        return list.length ? list.map(file => `<a href="${esc(App.ui.normalizeUrl ? App.ui.normalizeUrl(file.url) : file.url)}">${esc(file.name)}</a>`).join("<br>") : "-";
    }

    function build(project) {
        const currency = project.currency || "USD";
        const money = (value) => esc(App.ui.formatMoney(value, currency));
        const summary = FreelaFinance.summarize(project);
        const hours = FreelaFinance.hoursByUser(project);
        const tasks = project.tasks || [];
        const doneTasks = tasks.filter(task => DONE.includes(task.status)).length;
        const overall = percent(doneTasks, tasks.length);
        const categories = categorySummary(project, summary);
        const name = (userId) => esc(FreelaFinance.nameOf(userId));

        const allocationRows = FreelaFinance.allocationRows(project).map(userId => {
            const entry = summary.perUser.find(item => item.userId === userId) || { percent: 0, allocated: 0, inputs: 0, outputs: 0, remaining: 0 };
            return `<tr><td>${name(userId)}</td><td>${entry.percent}%</td><td>${money(entry.allocated)}</td><td>${money(entry.inputs)}</td><td>${money(entry.outputs)}</td><td>${money(entry.remaining)}</td><td>${(hours[userId] || 0).toFixed(2)}</td></tr>`;
        }).join("");
        const ledgerRows = [...(project.transactions || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .map(item => `<tr><td>${esc(item.date)}</td><td>${name(item.userId)}</td><td>${item.type === "input" ? "Input" : "Output"}</td><td>${money(item.amount)}</td><td>${esc(item.description)}</td></tr>`).join("");
        const milestoneRows = (project.milestones || [])
            .map(item => `<tr><td>${esc(item.title)}</td><td>${esc(item.dueDate || "-")}</td><td>${esc(item.status)}</td><td>${money(item.amount)}</td></tr>`).join("");
        const taskRows = tasks.map(task => `<tr><td>${esc(task.title)}</td><td>${esc(task.taskType || "Development")}</td><td>${esc(task.comment || "-")}</td><td>${esc(task.status || "Not Started")}</td><td>${esc(task.assignedTo ? FreelaFinance.nameOf(task.assignedTo) : "Unassigned")}</td><td>${esc(task.deadline || "-")}</td><td>${hoursOf(task).toFixed(2)}</td><td>${attachmentsHtml(task)}</td></tr>`).join("");
        const categoryRows = categories.map(item => `<tr><td>${esc(item.label)}</td><td>${esc(item.items)}</td><td>${item.hours === null ? "-" : item.hours.toFixed(2)}</td><td class="progress">${progressBar(item.value)}</td></tr>`).join("");
        const table = (head, rows, empty) => rows
            ? `<div class="scroll"><table><thead><tr>${head.map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`
            : `<p class="empty">${empty}</p>`;
        const approval = summary.approval;
        const totalHours = tasks.reduce((sum, task) => sum + hoursOf(task), 0);

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Financial Report - ${esc(project.name)}</title>
<style>
:root { --navy:#1F6FB2; --ink:#0F172A; --muted:#475569; --line:#CBD5E1; --teal:#0F766E; }
* { box-sizing:border-box; }
body { font-family:Inter, Arial, sans-serif; color:var(--ink); margin:0; padding:32px; line-height:1.6; font-size:16px; background:#fff; }
header { border-bottom:4px solid var(--navy); padding-bottom:16px; margin-bottom:24px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
h1 { margin:0; color:var(--navy); font-size:1.5rem; }
h2 { color:var(--navy); margin:32px 0 8px; font-size:1.25rem; }
.sub { color:var(--muted); font-size:.9rem; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:16px; }
.kpi { border:1px solid var(--line); border-radius:8px; padding:12px 16px; }
.kpi b { display:block; font-size:1.2rem; }
.kpi span { color:var(--muted); font-size:.8rem; text-transform:uppercase; }
.scroll { overflow-x:auto; }
table { width:100%; border-collapse:collapse; }
th, td { border:1px solid var(--line); padding:8px; text-align:left; font-size:.9rem; vertical-align:top; }
th { background:var(--navy); color:#fff; }
.empty { color:var(--muted); font-style:italic; }
.bar { background:#E2E8F0; border-radius:6px; height:12px; min-width:120px; overflow:hidden; }
.bar span { display:block; height:100%; background:var(--teal); }
.progress { min-width:160px; }
footer { margin-top:40px; border-top:1px solid var(--line); padding-top:12px; color:var(--muted); font-size:.8rem; text-align:center; }
a { color:var(--navy); }
@media print { body { padding:0; } }
</style>
</head>
<body>
<header>
  <div><h1>MS-CollabDash &ndash; Financial Report</h1><div class="sub"><strong>${esc(project.name)}</strong> (${esc(project.id)}) &middot; Client: ${esc(project.client || "-")} &middot; Status: ${esc(project.status || "Not Started")}</div></div>
  <div class="sub">Generated: ${esc(new Date().toLocaleString())}</div>
</header>
<section aria-labelledby="h-summary"><h2 id="h-summary">Financial summary</h2>
<div class="kpis">
  <div class="kpi"><span>Budget</span><b>${money(summary.budget)}</b></div>
  <div class="kpi"><span>Budget approval</span><b>${esc(approval.status)}</b>${approval.at ? `<small>${esc(approval.by)}, ${esc(new Date(approval.at).toLocaleDateString())}</small>` : ""}</div>
  <div class="kpi"><span>Total input</span><b>${money(summary.inputs)}</b></div>
  <div class="kpi"><span>Total output</span><b>${money(summary.outputs)}</b></div>
  <div class="kpi"><span>Remaining</span><b>${money(summary.remaining)}</b></div>
  <div class="kpi"><span>Hours logged</span><b>${totalHours.toFixed(2)}</b></div>
  <div class="kpi"><span>Task completion</span><b>${overall}%</b></div>
  <div class="kpi"><span>Deadline</span><b>${esc(project.deadline || "None")}</b></div>
</div>
<p>Overall progress:</p>${progressBar(overall)}</section>
<section aria-labelledby="h-cat"><h2 id="h-cat">Summary by category</h2>${table(["Category", "Progress detail", "Hours", "Completion"], categoryRows, "No data.")}</section>
<section aria-labelledby="h-alloc"><h2 id="h-alloc">Allocation rules &amp; per-user summary</h2>${table(["Member", "Share", "Allocated", "Input", "Output", "Remaining", "Logged hours"], allocationRows, "No allocations.")}</section>
<section aria-labelledby="h-ms"><h2 id="h-ms">Milestones</h2>${table(["Milestone", "Due date", "Status", "Amount"], milestoneRows, "No milestones planned.")}</section>
<section aria-labelledby="h-ledger"><h2 id="h-ledger">Ledger</h2>${table(["Date", "User", "Type", "Amount", "Description"], ledgerRows, "No transactions recorded.")}</section>
<section aria-labelledby="h-tasks"><h2 id="h-tasks">Task details</h2>${table(["Task", "Category", "Description", "Status", "Assigned user", "Deadline", "Logged hours", "Attachments"], taskRows, "No tasks in this project.")}</section>
<footer>MS-CollabDash &bull; Project &amp; team workspace</footer>
</body>
</html>`;
    }

    function download(pid) {
        const project = App.state.getProjects().find(item => item.id === pid);
        const perms = FreelaAuth.getPermissions();
        if (!project) return;
        if (!perms.manageFinance) {
            App.ui.showNotify("You do not have permission to generate financial reports.", "error");
            return;
        }
        const blob = new Blob([build(project)], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Financial_Report_${String(project.name).replace(/[^\w-]+/g, "_")}.html`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        App.ui.showNotify(`Financial report generated for [${project.name}].`);
    }

    return { build, download };
})();
