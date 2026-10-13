"use strict";
/*
 * Personal to-do list: small private items plus every task assigned to the
 * signed-in user (read from the visible projects, so it stays in sync).
 */
const FreelaTodos = (() => {
    let _items = [];
    let _loadedFor = null;

    const esc = (value) => App.ui.escapeHtml(value);

    async function load() {
        const user = FreelaAuth.getCurrentUser();
        if (!user) return;
        const all = await FreelaDB.getAll("todos");
        _items = all.filter(item => item.userId === user.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        _loadedFor = user.id;
    }

    function assignedTasks() {
        const user = FreelaAuth.getCurrentUser();
        const result = [];
        App.state.getProjects().forEach(project => {
            (project.tasks || []).forEach(task => {
                if (task.assignedTo === user.id) result.push({ project, task });
            });
        });
        const rank = (entry) => (["Done", "Cancelled"].includes(entry.task.status) ? 1 : 0);
        return result.sort((a, b) => rank(a) - rank(b) || String(a.task.deadline || "9999").localeCompare(String(b.task.deadline || "9999")));
    }

    function renderTaskRow({ project, task }) {
        const done = task.status === "Done";
        const canToggle = App.state.canEditTask(task);
        return `<li class="todo-item ${done ? "todo-done" : ""}">
            <input type="checkbox" id="todo-task-${esc(task.id)}" ${done ? "checked" : ""} ${canToggle ? "" : "disabled"}
                onchange="FreelaTodos.toggleTask('${esc(project.id)}', '${esc(task.id)}', this.checked)">
            <label for="todo-task-${esc(task.id)}"><span class="todo-title">${esc(task.title)}</span>
                <small>${esc(project.name)} &middot; ${esc(task.taskType || "Development")} &middot; ${esc(task.priority || "Medium")} priority${task.deadline ? ` &middot; due ${esc(task.deadline)}` : ""}</small></label>
            <span class="badge ${App.ui.getStatusClass(task.status)}">${esc(task.status || "Not Started")}</span>
            <button class="btn-secondary btn-sm" onclick="FreelaTodos.openTask('${esc(project.id)}', '${esc(task.id)}')">Open</button></li>`;
    }

    async function render(panel) {
        const user = FreelaAuth.getCurrentUser();
        if (!panel || !user) return;
        if (_loadedFor !== user.id) await load();
        const tasks = assignedTasks();
        const personal = _items.map(item => `<li class="todo-item ${item.done ? "todo-done" : ""}">
            <input type="checkbox" id="todo-${esc(item.id)}" ${item.done ? "checked" : ""} onchange="FreelaTodos.toggle('${esc(item.id)}', this.checked)">
            <label for="todo-${esc(item.id)}"><span class="todo-title">${esc(item.title)}</span></label>
            <button class="btn-danger btn-sm" aria-label="Delete ${esc(item.title)}" onclick="FreelaTodos.remove('${esc(item.id)}')">x</button></li>`).join("");
        const open = _items.filter(item => !item.done).length + tasks.filter(entry => !["Done", "Cancelled"].includes(entry.task.status)).length;

        panel.innerHTML = `
            <div class="panel-header"><span>My To-Do</span><span class="todo-count" aria-live="polite">${open} open</span></div>
            <div class="todo-grid">
                <section aria-labelledby="todoPersonalTitle">
                    <h2 id="todoPersonalTitle" class="section-title">Personal tasks</h2>
                    <form class="todo-form" onsubmit="FreelaTodos.add(event)">
                        <label for="todoInput" class="sr-only">New personal task</label>
                        <input id="todoInput" maxlength="150" placeholder="Add a small task for yourself" required>
                        <button type="submit" class="btn-primary">Add</button>
                    </form>
                    ${personal ? `<ul class="todo-list">${personal}</ul>` : `<div class="empty-state">Nothing here yet. Add a quick reminder above.</div>`}
                </section>
                <section aria-labelledby="todoAssignedTitle">
                    <h2 id="todoAssignedTitle" class="section-title">Assigned to me</h2>
                    ${tasks.length ? `<ul class="todo-list">${tasks.map(renderTaskRow).join("")}</ul>` : `<div class="empty-state">No tasks are assigned to you right now.</div>`}
                </section>
            </div>`;
    }

    async function add(event) {
        event.preventDefault();
        const input = document.getElementById("todoInput");
        const title = input.value.trim();
        if (!title) return;
        const record = { id: `TD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId: FreelaAuth.getCurrentUser().id, title, done: false, createdAt: new Date().toISOString() };
        await FreelaDB.put("todos", record);
        _items.push(record);
        FreelaTabs.renderActive();
        setTimeout(() => document.getElementById("todoInput")?.focus(), 0);
    }

    async function toggle(id, done) {
        const item = _items.find(entry => entry.id === id);
        if (!item) return;
        item.done = done;
        await FreelaDB.put("todos", item);
        FreelaTabs.renderActive();
    }

    async function remove(id) {
        await FreelaDB.remove("todos", id);
        _items = _items.filter(entry => entry.id !== id);
        FreelaTabs.renderActive();
    }

    async function toggleTask(pid, tid, done) {
        const project = App.state.getProjects().find(item => item.id === pid);
        const task = project && project.tasks.find(item => item.id === tid);
        if (!task || !App.state.canEditTask(task)) return;
        task.status = done ? "Done" : "In Progress";
        await App.state.saveProject(project);
        App.state.refreshDashboard();
    }

    function openTask(pid, tid) {
        App.state.openProjectDetails(pid, tid);
        FreelaTabs.show("workspace");
    }

    function init() {
        FreelaTabs.register({ id: "todos", label: "My To-Do", order: 20, render });
        App.state.onRefresh(() => { if (FreelaTabs.getActive() === "todos") FreelaTabs.renderActive(); });
    }

    function reset() { _items = []; _loadedFor = null; }

    return { init, reset, add, toggle, remove, toggleTask, openTask };
})();
