"use strict";
/*
 * FreelaSync core application logic: projects, tasks, time logs.
 * Data is persisted through FreelaDB (IndexedDB) and access is
 * restricted according to the signed-in user's role (see auth.js).
 */
const App = (() => {
    const PROJECT_TYPES = ["Hourly", "Fixed fee", "Retainer", "Value-based"];
    const PROJECT_STATUSES = ["Not Started", "In Progress", "Blocked", "Cancelled", "Reviewing", "Delivered", "On Hold"];
    const TASK_STATUSES = ["Not Started", "In Progress", "Blocked", "Cancelled", "Done", "On Hold"];

    let _projects = [];
    let _users = [];
    let _activeProjectId = null;

    const ui = {
        dom: {},

        cacheDom: () => {
            ui.dom = {
                projectForm: document.getElementById('projectForm'),
                taskForm: document.getElementById('taskForm'),
                logForm: document.getElementById('logForm'),
                tProjectSelect: document.getElementById('tProjectSelect'),
                tAssigneeSelect: document.getElementById('tAssigneeSelect'),
                lProjectSelect: document.getElementById('lProjectSelect'),
                lTaskSelect: document.getElementById('lTaskSelect'),
                summary: document.getElementById('dashboard_summary'),
                mainContentPanel: document.getElementById('main_content_panel'),
                notifyPane: document.getElementById('notification_pane'),
                editModal: document.getElementById('editModal'),
                modalTitle: document.getElementById('modalTitle'),
                modalBody: document.getElementById('modalBody'),
                modalSaveBtn: document.getElementById('modalSaveBtn'),
                formSection: document.getElementById('form_section'),
                headerUser: document.getElementById('header_user_chip')
            };
        },

        showNotify: (message, type = 'success') => {
            const toast = document.createElement('div');
            toast.className = `notify-toast ${type}`;
            toast.innerText = message;
            ui.dom.notifyPane.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        },

        openModal: (title, bodyHtml, onSave) => {
            ui.dom.modalTitle.innerText = title;
            ui.dom.modalBody.innerHTML = bodyHtml;
            ui.dom.modalSaveBtn.onclick = onSave;
            ui.dom.editModal.classList.add('active');
        },

        closeModal: () => {
            ui.dom.editModal.classList.remove('active');
        },

        getStatusClass: (statusStr) => `st-${(statusStr || 'not-started').toLowerCase().replace(/\s+/g, '-')}`,

        getTypeClass: (typeStr) => {
            switch (typeStr) {
                case 'Fixed fee': return 'type-fixed';
                case 'Retainer': return 'type-retainer';
                case 'Value-based': return 'type-value';
                case 'Hourly':
                default: return 'type-hourly';
            }
        },

        calcHours: (start, end) => {
            const ms = new Date(end) - new Date(start);
            return parseFloat((ms / (1000 * 60 * 60)).toFixed(2));
        },

        validateLog: (start, end) => {
            const startTime = new Date(start);
            const endTime = new Date(end);
            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return { ok: false, msg: "Invalid dates." };
            if (endTime <= startTime) return { ok: false, msg: "End time must be after start time." };
            return { ok: true };
        },

        getDeadlineBadgeHtml: (deadlineStr, status = '') => {
            if (!deadlineStr) return '';
            const isCompleted = ['Delivered', 'Done'].includes(status);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const target = new Date(deadlineStr); target.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (isCompleted) return `<span class="deadline-badge done">Target Met (${deadlineStr})</span>`;
            if (diffDays < 0) {
                const overdue = Math.abs(diffDays);
                return `<span class="deadline-badge delayed">Delayed by ${overdue} day${overdue > 1 ? 's' : ''} (${deadlineStr})</span>`;
            }
            if (diffDays === 0) return `<span class="deadline-badge today">Due Today (${deadlineStr})</span>`;
            return `<span class="deadline-badge normal">In ${diffDays} day${diffDays > 1 ? 's' : ''} (${deadlineStr})</span>`;
        },

        userNameById: (uid) => {
            const u = _users.find(x => x.id === uid);
            return u ? u.fullName : "Unassigned";
        },

        renderHeaderUser: () => {
            const user = FreelaAuth.getCurrentUser();
            if (!user || !ui.dom.headerUser) return;
            const initials = user.fullName.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
            ui.dom.headerUser.innerHTML = `
                <div class="user-avatar">${initials}</div>
                <div class="user-meta">
                    <span class="user-name">${user.fullName}</span>
                    <span class="user-role">${FreelaAuth.roleLabel(user.role)}</span>
                </div>
            `;
        },

        applyPermissionVisibility: () => {
            const perms = FreelaAuth.getPermissions();
            if (ui.dom.formSection) ui.dom.formSection.style.display = (perms.manageProjects || perms.manageTasks) ? 'flex' : 'none';
            document.getElementById('projectFormPanel').style.display = perms.manageProjects ? 'flex' : 'none';
            document.getElementById('taskFormPanel').style.display = perms.manageProjects ? 'flex' : 'none';
            document.getElementById('resetDbBtn').style.display = perms.deleteData ? 'inline-block' : 'none';

            const usersTabBtn = document.getElementById('tab_users_btn');
            if (usersTabBtn) usersTabBtn.style.display = perms.manageUsers ? 'inline-block' : 'none';
        }
    };

    const state = {
        init: async () => {
            await state.reloadProjects();
            await state.reloadUsers();
            state.syncDropdowns();
            state.refreshDashboard();
        },

        reloadProjects: async () => {
            _projects = await FreelaDB.getAll("projects");
            _projects.sort((a, b) => a.id.localeCompare(b.id));
        },

        reloadUsers: async () => {
            _users = await FreelaDB.getAll("users");
        },

        nextSeq: async (key) => {
            const meta = await FreelaDB.get("meta", key);
            const next = (meta ? meta.value : 0) + 1;
            await FreelaDB.put("meta", { key, value: next });
            return next;
        },

        canEditTask: (task) => {
            const perms = FreelaAuth.getPermissions();
            if (perms.manageProjects) return true;
            const user = FreelaAuth.getCurrentUser();
            return perms.manageOwnTasksOnly && user && task.assignedTo === user.id;
        },

        openProjectDetails: (pid) => { _activeProjectId = pid; state.refreshDashboard(); },
        closeProjectDetails: () => { _activeProjectId = null; state.refreshDashboard(); },

        addProject: async (pData) => {
            const seq = await state.nextSeq("projectSeq");
            const pid = `P-${String(seq).padStart(4, '0')}`;
            const commentsHistory = [];

            if (pData.initialComment) {
                const cSeq = await state.nextSeq("commentSeq");
                commentsHistory.push({ id: `C-${String(cSeq).padStart(5, '0')}`, timestamp: new Date().toISOString(), text: pData.initialComment, author: FreelaAuth.getCurrentUser().fullName });
            }

            const project = {
                id: pid, name: pData.name, client: pData.client, type: pData.type, status: pData.status,
                deadline: pData.deadline || "", commentsHistory, tasks: [], createdBy: FreelaAuth.getCurrentUser().id
            };

            await FreelaDB.put("projects", project);
            await state.reloadProjects();
            state.syncDropdowns(pid);
            state.refreshDashboard();
            ui.showNotify(`Project [${pData.name}] initialized.`);
        },

        editProject: (pid) => {
            const p = _projects.find(x => x.id === pid);
            if (!p) return;
            const typeOptions = PROJECT_TYPES.map(t => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t}</option>`).join('');
            const statusOptions = PROJECT_STATUSES.map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('');
            const html = `
                <div class="form-group"><label>Project Name</label><input type="text" id="mPName" value="${p.name}"></div>
                <div class="form-group"><label>Client Name</label><input type="text" id="mPClient" value="${p.client}"></div>
                <div class="form-group"><label>Project Type</label><select id="mPType">${typeOptions}</select></div>
                <div class="form-group"><label>Project Status</label><select id="mPStatus">${statusOptions}</select></div>
                <div class="form-group"><label>Project Deadline</label><input type="date" id="mPDeadline" value="${p.deadline || ''}"></div>
            `;
            ui.openModal("Edit Project Details", html, async () => {
                p.name = document.getElementById('mPName').value.trim() || p.name;
                p.client = document.getElementById('mPClient').value.trim() || p.client;
                p.type = document.getElementById('mPType').value;
                p.status = document.getElementById('mPStatus').value;
                p.deadline = document.getElementById('mPDeadline').value;
                await FreelaDB.put("projects", p);
                ui.closeModal();
                state.refreshDashboard();
                ui.showNotify("Project updated.");
            });
        },

        addProjectComment: async (pid, commentText) => {
            const p = _projects.find(x => x.id === pid);
            if (!p || !commentText.trim()) return;
            if (!p.commentsHistory) p.commentsHistory = [];
            const cSeq = await state.nextSeq("commentSeq");
            p.commentsHistory.unshift({ id: `C-${String(cSeq).padStart(5, '0')}`, timestamp: new Date().toISOString(), text: commentText.trim(), author: FreelaAuth.getCurrentUser().fullName });
            await FreelaDB.put("projects", p);
            state.refreshDashboard();
            ui.showNotify("Comment added to project history.");
        },

        deleteProjectComment: async (pid, cid) => {
            const p = _projects.find(x => x.id === pid);
            if (!p || !p.commentsHistory) return;
            p.commentsHistory = p.commentsHistory.filter(c => c.id !== cid);
            await FreelaDB.put("projects", p);
            state.refreshDashboard();
            ui.showNotify("Comment removed.");
        },

        deleteProject: async (pid) => {
            if (!confirm(`Remove project [${pid}] and all attached tasks/logs?`)) return;
            await FreelaDB.remove("projects", pid);
            await state.reloadProjects();
            if (_activeProjectId === pid) _activeProjectId = null;
            state.syncDropdowns();
            state.refreshDashboard();
            ui.showNotify("Project deleted.");
        },

        addTask: async (pid, title, status, deadline, comment, assignedTo) => {
            const project = _projects.find(p => p.id === pid);
            if (!project) return;
            const seq = await state.nextSeq("taskSeq");
            const tid = `T-${String(seq).padStart(5, '0')}`;
            project.tasks.push({ id: tid, title, status, deadline, comment, assignedTo: assignedTo || "", logs: [] });
            await FreelaDB.put("projects", project);
            state.syncDropdowns(pid);
            state.refreshDashboard();
            ui.showNotify(`Task added to [${project.name}].`);
        },

        editTask: (pid, tid) => {
            const project = _projects.find(p => p.id === pid);
            const task = project ? project.tasks.find(t => t.id === tid) : null;
            if (!task || !state.canEditTask(task)) { ui.showNotify("You do not have permission to edit this task.", "error"); return; }

            const perms = FreelaAuth.getPermissions();
            const statusOptions = TASK_STATUSES.map(s => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${s}</option>`).join('');
            const assigneeOptions = `<option value="">(Unassigned)</option>` + _users.map(u => `<option value="${u.id}" ${task.assignedTo === u.id ? 'selected' : ''}>${u.fullName} (${FreelaAuth.roleLabel(u.role)})</option>`).join('');

            const html = `
                <div class="form-group"><label>Task Title</label><input type="text" id="mTTitle" value="${task.title}" ${perms.manageProjects ? '' : 'disabled'}></div>
                <div class="form-group"><label>Task Status</label><select id="mTStatus">${statusOptions}</select></div>
                <div class="form-group"><label>Task Deadline</label><input type="date" id="mTDeadline" value="${task.deadline || ''}" ${perms.manageProjects ? '' : 'disabled'}></div>
                <div class="form-group"><label>Assigned To</label><select id="mTAssignee" ${perms.manageProjects ? '' : 'disabled'}>${assigneeOptions}</select></div>
                <div class="form-group"><label>Task Comments</label><textarea id="mTComment">${task.comment || ''}</textarea></div>
            `;
            ui.openModal("Edit Task", html, async () => {
                if (perms.manageProjects) {
                    task.title = document.getElementById('mTTitle').value.trim() || task.title;
                    task.deadline = document.getElementById('mTDeadline').value;
                    task.assignedTo = document.getElementById('mTAssignee').value;
                }
                task.status = document.getElementById('mTStatus').value;
                task.comment = document.getElementById('mTComment').value.trim();
                await FreelaDB.put("projects", project);
                ui.closeModal();
                state.refreshDashboard();
                ui.showNotify("Task updated.");
            });
        },

        deleteTask: async (pid, tid) => {
            const perms = FreelaAuth.getPermissions();
            if (!perms.deleteData) { ui.showNotify("You do not have permission to delete tasks.", "error"); return; }
            if (!confirm("Delete this planned task and all its logged time entries?")) return;
            const project = _projects.find(p => p.id === pid);
            if (!project) return;
            project.tasks = project.tasks.filter(t => t.id !== tid);
            await FreelaDB.put("projects", project);
            state.syncDropdowns(pid);
            state.refreshDashboard();
            ui.showNotify("Task deleted.");
        },

        addLog: async (tid, start, end, comment) => {
            let foundProject = null, foundTask = null;
            for (const p of _projects) {
                const t = p.tasks.find(x => x.id === tid);
                if (t) { foundProject = p; foundTask = t; break; }
            }
            if (!foundTask) return;
            if (!state.canEditTask(foundTask)) { ui.showNotify("You do not have permission to log time on this task.", "error"); return; }

            const hours = ui.calcHours(start, end);
            const seq = await state.nextSeq("logSeq");
            const lid = `L-${String(seq).padStart(6, '0')}`;
            const user = FreelaAuth.getCurrentUser();
            foundTask.logs.push({ id: lid, start, end, hours, comment, loggedBy: user.id, loggedByName: user.fullName });
            await FreelaDB.put("projects", foundProject);
            state.refreshDashboard();
            ui.showNotify(`Logged ${hours} hrs to task.`);
        },

        editLog: (pid, tid, lid) => {
            const project = _projects.find(p => p.id === pid);
            const task = project ? project.tasks.find(t => t.id === tid) : null;
            const log = task ? task.logs.find(l => l.id === lid) : null;
            if (!log) return;
            const perms = FreelaAuth.getPermissions();
            const user = FreelaAuth.getCurrentUser();
            const canEdit = perms.manageProjects || (perms.manageOwnTasksOnly && log.loggedBy === user.id);
            if (!canEdit) { ui.showNotify("You do not have permission to edit this log entry.", "error"); return; }

            const html = `
                <div class="form-group"><label>Start Time</label><input type="datetime-local" id="mLStart" value="${log.start}"></div>
                <div class="form-group"><label>End Time</label><input type="datetime-local" id="mLEnd" value="${log.end}"></div>
                <div class="form-group"><label>Log Comments</label><textarea id="mLComment">${log.comment || ''}</textarea></div>
            `;
            ui.openModal("Edit Log Time Frame", html, async () => {
                const start = document.getElementById('mLStart').value;
                const end = document.getElementById('mLEnd').value;
                const check = ui.validateLog(start, end);
                if (!check.ok) { ui.showNotify(check.msg, 'error'); return; }
                log.start = start; log.end = end;
                log.hours = ui.calcHours(start, end);
                log.comment = document.getElementById('mLComment').value.trim();
                await FreelaDB.put("projects", project);
                ui.closeModal();
                state.refreshDashboard();
                ui.showNotify("Log entry updated.");
            });
        },

        deleteLog: async (pid, tid, lid) => {
            const project = _projects.find(p => p.id === pid);
            const task = project ? project.tasks.find(t => t.id === tid) : null;
            const log = task ? task.logs.find(l => l.id === lid) : null;
            if (!log) return;
            const perms = FreelaAuth.getPermissions();
            const user = FreelaAuth.getCurrentUser();
            const canDelete = perms.deleteData || (perms.manageOwnTasksOnly && log.loggedBy === user.id);
            if (!canDelete) { ui.showNotify("You do not have permission to delete this log entry.", "error"); return; }
            if (!confirm("Remove this logged time entry?")) return;
            task.logs = task.logs.filter(l => l.id !== lid);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
            ui.showNotify("Log entry removed.");
        },

        syncDropdowns: (preferredPid = null) => {
            const perms = FreelaAuth.getPermissions();
            const assigneeOptions = `<option value="">(Unassigned)</option>` + _users.map(u => `<option value="${u.id}">${u.fullName} (${FreelaAuth.roleLabel(u.role)})</option>`).join('');
            if (ui.dom.tAssigneeSelect) ui.dom.tAssigneeSelect.innerHTML = assigneeOptions;

            if (_projects.length === 0) {
                ui.dom.tProjectSelect.innerHTML = '<option value="">(No Projects)</option>';
                ui.dom.lProjectSelect.innerHTML = '<option value="">(No Projects)</option>';
                ui.dom.lTaskSelect.innerHTML = '<option value="">(No Tasks)</option>';
                return;
            }

            ui.dom.tProjectSelect.innerHTML = _projects.map(p => `<option value="${p.id}" ${p.id === preferredPid ? 'selected' : ''}>[${p.id}] ${p.name}</option>`).join('');

            const currentSelectedLogPid = preferredPid || ui.dom.lProjectSelect.value || _projects[0].id;
            ui.dom.lProjectSelect.innerHTML = _projects.map(p => `<option value="${p.id}" ${p.id === currentSelectedLogPid ? 'selected' : ''}>[${p.id}] ${p.name}</option>`).join('');

            state.handleLogProjectFilterChange(ui.dom.lProjectSelect.value);
        },

        handleLogProjectFilterChange: (pid) => {
            const project = _projects.find(p => p.id === pid);
            const perms = FreelaAuth.getPermissions();
            const user = FreelaAuth.getCurrentUser();
            if (!project || project.tasks.length === 0) {
                ui.dom.lTaskSelect.innerHTML = '<option value="">(No Tasks in this project)</option>';
                return;
            }
            let tasks = project.tasks;
            if (perms.manageOwnTasksOnly) tasks = tasks.filter(t => t.assignedTo === user.id);
            if (tasks.length === 0) {
                ui.dom.lTaskSelect.innerHTML = '<option value="">(No tasks assigned to you)</option>';
                return;
            }
            ui.dom.lTaskSelect.innerHTML = tasks.map(t => `<option value="${t.id}">[${t.status || 'Not Started'}] ${t.title}</option>`).join('');
        },

        refreshDashboard: () => {
            state.renderSummary();
            if (_activeProjectId) state.renderProjectDetailView(_activeProjectId);
            else state.renderPortfolioView();
        },

        renderSummary: () => {
            let totalHours = 0, totalTasks = 0;
            _projects.forEach(p => {
                totalTasks += p.tasks.length;
                p.tasks.forEach(t => t.logs.forEach(l => totalHours += l.hours));
            });
            ui.dom.summary.innerHTML = `
                <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${_projects.length}</div></div>
                <div class="stat-card"><div class="stat-label">Tasks Planned</div><div class="stat-value">${totalTasks}</div></div>
                <div class="stat-card"><div class="stat-label">Total Time Logged</div><div class="stat-value">${totalHours.toFixed(2)} Hrs</div></div>
            `;
        },

        renderPortfolioView: () => {
            if (_projects.length === 0) {
                ui.dom.mainContentPanel.innerHTML = `
                    <div class="panel-header">My Projects Portfolio</div>
                    <div class="empty-state">No active projects in portfolio. Register a project on the left to begin.</div>
                `;
                return;
            }

            const rowsHtml = _projects.map(p => {
                const typeName = p.type || 'Hourly';
                const cardTypeClass = ui.getTypeClass(typeName);
                const pStatus = p.status || 'Not Started';
                let pTotalHours = 0;
                p.tasks.forEach(t => t.logs.forEach(l => pTotalHours += l.hours));
                const deadlineBadgeHtml = ui.getDeadlineBadgeHtml(p.deadline, pStatus);
                const commentCount = p.commentsHistory ? p.commentsHistory.length : 0;

                return `
                    <div class="proj-row-card ${cardTypeClass}" onclick="App.state.openProjectDetails('${p.id}')">
                        <div class="proj-info-group">
                            <div class="proj-row-title">${p.name}</div>
                            <div class="proj-row-sub">
                                <span>Client: <strong>${p.client}</strong></span><span>&bull;</span>
                                <span>${typeName}</span><span>&bull;</span>
                                <span>${p.tasks.length} Tasks</span><span>&bull;</span>
                                <span>${pTotalHours.toFixed(2)} Hrs Logged</span><span>&bull;</span>
                                <span>${commentCount} Comments</span>
                            </div>
                        </div>
                        <div class="proj-row-meta">
                            ${deadlineBadgeHtml}
                            <span class="badge ${ui.getStatusClass(pStatus)}">${pStatus}</span>
                            <span style="color: var(--text-muted); font-weight: bold;">&rsaquo;</span>
                        </div>
                    </div>
                `;
            }).join('');

            ui.dom.mainContentPanel.innerHTML = `
                <div class="panel-header">
                    <span>My Projects Portfolio</span>
                    <span style="font-size:0.75rem; color:var(--text-muted);">Click a project row to view details & logs</span>
                </div>
                <div class="project-list">${rowsHtml}</div>
            `;
        },

        renderProjectDetailView: (pid) => {
            const p = _projects.find(x => x.id === pid);
            if (!p) { _activeProjectId = null; state.renderPortfolioView(); return; }

            const perms = FreelaAuth.getPermissions();
            const currentUser = FreelaAuth.getCurrentUser();
            const typeName = p.type || 'Hourly';
            const pStatus = p.status || 'Not Started';
            let pTotalHours = 0;
            p.tasks.forEach(t => t.logs.forEach(l => pTotalHours += l.hours));
            const projDeadlineBadge = ui.getDeadlineBadgeHtml(p.deadline, pStatus);

            const commentsList = (p.commentsHistory || []).map(c => `
                <div class="comment-item">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="comment-time">${new Date(c.timestamp).toLocaleString()} ${c.author ? '&middot; ' + c.author : ''}</span>
                        ${perms.deleteData ? `<button class="btn-danger btn-sm" onclick="App.state.deleteProjectComment('${p.id}', '${c.id}')">x</button>` : ''}
                    </div>
                    <div class="comment-text">${c.text}</div>
                </div>
            `).join('');

            let visibleTasks = p.tasks;
            if (perms.manageOwnTasksOnly) visibleTasks = p.tasks.filter(t => t.assignedTo === currentUser.id);

            const tasksHtml = visibleTasks.length === 0
                ? `<div style="color: var(--text-muted); font-size: 0.8rem; font-style: italic;">No tasks visible for your role in this project yet.</div>`
                : visibleTasks.map(t => {
                    let tHours = 0;
                    t.logs.forEach(l => tHours += l.hours);
                    const tStatus = t.status || 'Not Started';
                    const taskDeadlineBadge = ui.getDeadlineBadgeHtml(t.deadline, tStatus);
                    const canEdit = state.canEditTask(t);

                    const logsHtml = t.logs.length === 0
                        ? `<div style="color: var(--text-muted); font-size: 0.75rem; font-style: italic;">No time logged yet.</div>`
                        : t.logs.map(l => {
                            const canEditLog = perms.manageProjects || (perms.manageOwnTasksOnly && l.loggedBy === currentUser.id);
                            return `
                            <div class="log-row">
                                <div class="log-info">
                                    <span><strong>${l.hours} Hrs</strong> <span class="log-time">(${new Date(l.start).toLocaleString()} - ${new Date(l.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span> ${l.loggedByName ? `<span class="log-time">by ${l.loggedByName}</span>` : ''}</span>
                                    ${l.comment ? `<span class="log-comment">Note: ${l.comment}</span>` : ''}
                                </div>
                                ${canEditLog ? `
                                <div class="task-ctrls">
                                    <button class="btn-secondary btn-sm" onclick="App.state.editLog('${p.id}', '${t.id}', '${l.id}')">Edit Log</button>
                                    <button class="btn-danger btn-sm" onclick="App.state.deleteLog('${p.id}', '${t.id}', '${l.id}')">x</button>
                                </div>` : ''}
                            </div>
                        `; }).join('');

                    return `
                        <div class="task-item">
                            <div class="task-header">
                                <span class="task-title">
                                    <span class="badge ${ui.getStatusClass(tStatus)}">${tStatus}</span>
                                    ${taskDeadlineBadge}
                                    ${t.title}
                                    <small style="color:var(--text-muted); font-weight:normal;">(${tHours.toFixed(2)} hrs)</small>
                                </span>
                                ${canEdit ? `
                                <div class="task-ctrls">
                                    <button class="btn-secondary btn-sm" onclick="App.state.editTask('${p.id}', '${t.id}')">Edit Task</button>
                                    ${perms.deleteData ? `<button class="btn-danger btn-sm" onclick="App.state.deleteTask('${p.id}', '${t.id}')">Delete Task</button>` : ''}
                                </div>` : ''}
                            </div>
                            <div class="task-assignee">Assigned to: ${t.assignedTo ? ui.userNameById(t.assignedTo) : 'Unassigned'}</div>
                            ${t.comment ? `<div class="task-comment">Comment: ${t.comment}</div>` : ''}
                            <div class="log-entries">${logsHtml}</div>
                        </div>
                    `;
                }).join('');

            ui.dom.mainContentPanel.innerHTML = `
                <div class="detail-view-container">
                    <div class="detail-top-nav">
                        <button class="btn-header" onclick="App.state.closeProjectDetails()">&larr; Back to Portfolio</button>
                        <div style="display:flex; gap:8px;">
                            ${perms.manageProjects ? `<button class="btn-secondary btn-sm" onclick="App.state.editProject('${p.id}')">Edit Project</button>` : ''}
                            <button class="btn-primary btn-sm" onclick="App.reports.generateHtmlReport('${p.id}')">Generate Report</button>
                            ${perms.deleteData ? `<button class="btn-danger btn-sm" onclick="App.state.deleteProject('${p.id}')">Delete</button>` : ''}
                        </div>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                        <div>
                            <h2 style="color:#fff; font-size:1.4rem; font-weight:700;">${p.name}</h2>
                            <div style="color:var(--text-muted); font-size:0.9rem; margin-top:2px;">Client: <strong>${p.client}</strong> &bull; ${typeName}</div>
                        </div>
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                            <span class="badge ${ui.getStatusClass(pStatus)}" style="font-size:0.8rem; padding:6px 12px;">${pStatus}</span>
                            ${projDeadlineBadge}
                        </div>
                    </div>

                    <div class="proj-metrics">
                        <div class="metric"><div class="metric-value">${p.tasks.length}</div><div class="metric-label">Tasks Planned</div></div>
                        <div class="metric"><div class="metric-value">${pTotalHours.toFixed(2)} Hrs</div><div class="metric-label">Total Time Logged</div></div>
                    </div>

                    <div class="comment-history-panel">
                        <div class="comment-history-title">Project Comment History (${(p.commentsHistory || []).length})</div>
                        <div style="display:flex; gap:8px;">
                            <input type="text" id="newProjectCommentInput" placeholder="Add a date-stamped comment to project history..." style="flex-grow:1;">
                            <button class="btn-primary btn-sm" onclick="App.handlers.postProjectComment('${p.id}')">Post Comment</button>
                        </div>
                        <div class="comment-history-list">
                            ${commentsList || '<div style="font-style:italic; color:var(--text-muted); font-size:0.8rem;">No project comments logged yet.</div>'}
                        </div>
                    </div>

                    <div class="task-list">
                        <div class="task-list-title">Planned Project Tasks & Time Logs<span>${visibleTasks.length} Tasks</span></div>
                        ${tasksHtml}
                    </div>
                </div>
            `;
        },

        exportData: async () => {
            const users = await FreelaDB.getAll("users");
            const projects = await FreelaDB.getAll("projects");
            const exportTime = new Date().toISOString();
            const payload = { exportTime, app: "FREELASYNC", users: users.map(u => ({ ...u, passwordHash: undefined })), projects };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
            const a = document.createElement('a');
            a.setAttribute("href", dataStr);
            a.setAttribute("download", `freelasync_backup_${exportTime.split('T')[0]}.json`);
            a.click();
            ui.showNotify("Backup exported (passwords are not included).");
        },

        importData: (event) => {
            const perms = FreelaAuth.getPermissions();
            if (!perms.deleteData) { ui.showNotify("You do not have permission to import data.", "error"); return; }
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    if (!imported.projects) throw new Error("Invalid structure");
                    for (const p of imported.projects) await FreelaDB.put("projects", p);
                    await state.reloadProjects();
                    state.syncDropdowns();
                    state.refreshDashboard();
                    ui.showNotify("Project database restored successfully.", 'success');
                } catch (err) {
                    ui.showNotify("Invalid database file format.", 'error');
                }
            };
            reader.readAsText(file);
        },

        resetDatabase: async () => {
            const perms = FreelaAuth.getPermissions();
            if (!perms.deleteData) { ui.showNotify("You do not have permission to reset the database.", "error"); return; }
            if (!confirm("Delete ALL projects, tasks and time logs permanently? Users are kept.")) return;
            const projects = await FreelaDB.getAll("projects");
            for (const p of projects) await FreelaDB.remove("projects", p.id);
            await state.reloadProjects();
            _activeProjectId = null;
            state.syncDropdowns();
            state.refreshDashboard();
            ui.showNotify("Project data reset.");
        }
    };

    const handlers = {
        createProject: (e) => {
            e.preventDefault();
            if (!FreelaAuth.getPermissions().manageProjects) { ui.showNotify("You do not have permission to create projects.", "error"); return; }
            const pName = document.getElementById('pName').value.trim();
            const pClient = document.getElementById('pClient').value.trim();
            const pType = document.getElementById('pType').value;
            const pStatus = document.getElementById('pStatus').value;
            const pDeadline = document.getElementById('pDeadline').value;
            const pComment = document.getElementById('pComment').value.trim();
            if (!pName || !pClient) return;
            state.addProject({ name: pName, client: pClient, type: pType, status: pStatus, deadline: pDeadline, initialComment: pComment });
            ui.dom.projectForm.reset();
        },

        postProjectComment: (pid) => {
            const input = document.getElementById('newProjectCommentInput');
            if (!input || !input.value.trim()) return;
            state.addProjectComment(pid, input.value.trim());
            input.value = "";
        },

        createTask: (e) => {
            e.preventDefault();
            if (!FreelaAuth.getPermissions().manageProjects) { ui.showNotify("You do not have permission to create tasks.", "error"); return; }
            const pid = ui.dom.tProjectSelect.value;
            const title = document.getElementById('tTitle').value.trim();
            const status = document.getElementById('tStatus').value;
            const deadline = document.getElementById('tDeadline').value;
            const comment = document.getElementById('tComment').value.trim();
            const assignedTo = ui.dom.tAssigneeSelect.value;
            if (!pid || !title) return;
            state.addTask(pid, title, status, deadline, comment, assignedTo);
            ui.dom.taskForm.reset();
        },

        logTime: (e) => {
            e.preventDefault();
            const tid = ui.dom.lTaskSelect.value;
            const startStr = document.getElementById('lStart').value;
            const endStr = document.getElementById('lEnd').value;
            const comment = document.getElementById('lComment').value.trim();
            if (!tid) { ui.showNotify("Please select a task.", 'error'); return; }
            const check = ui.validateLog(startStr, endStr);
            if (!check.ok) { ui.showNotify(check.msg, 'error'); return; }
            state.addLog(tid, startStr, endStr, comment);
            ui.dom.logForm.reset();
        }
    };

    const reports = {
        generateHtmlReport: (pid) => {
            const project = _projects.find(p => p.id === pid);
            if (!project) return;
            const typeName = project.type || 'Hourly';
            const timestamp = new Date().toLocaleString();
            let totalHours = 0;
            project.tasks.forEach(t => t.logs.forEach(l => totalHours += l.hours));

            const htmlStream = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Report - ${project.name}</title>
<style>
body { font-family: Arial, sans-serif; color:#222; margin:40px; }
header { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #1f6fb2; padding-bottom:16px; }
.brand { display:flex; align-items:center; gap:14px; }
.brand img { width:48px; height:48px; }
h1 { font-size:1.3rem; color:#1f6fb2; margin:0; }
.client { color:#555; font-size:0.9rem; }
.meta-blocks { display:flex; gap:16px; margin:20px 0; }
.block { flex:1; border:1px solid #ddd; border-radius:6px; padding:10px; }
.bl-label { font-size:0.7rem; text-transform:uppercase; color:#888; }
.bl-val { font-size:1rem; font-weight:700; }
.comments-box { background:#f7f7f7; border-radius:6px; padding:12px; margin-bottom:20px; }
.c-line { margin-bottom:6px; font-size:0.85rem; }
table { width:100%; border-collapse:collapse; margin-top:10px; }
th, td { border:1px solid #ddd; padding:8px; font-size:0.85rem; text-align:left; }
th { background:#1f6fb2; color:#fff; }
.footer { margin-top:40px; text-align:center; color:#999; font-size:0.75rem; border-top:1px solid #ddd; padding-top:10px; }
</style>
</head>
<body>
<header>
    <div class="brand">
        <div>
            <h1>FREELASYNC Report</h1>
            <div class="client"><strong>${project.name}</strong> (${typeName}) | Client: ${project.client}</div>
        </div>
    </div>
    <div style="text-align: right; font-size: 0.8rem; color: #777;">Generated: ${timestamp}</div>
</header>
<div class="meta-blocks">
    <div class="block"><div class="bl-label">Project Status</div><div class="bl-val">${project.status || 'Not Started'}</div></div>
    <div class="block"><div class="bl-label">Target Deadline</div><div class="bl-val">${project.deadline || 'None'}</div></div>
    <div class="block"><div class="bl-label">Total Time Logged</div><div class="bl-val">${totalHours.toFixed(2)} Hrs</div></div>
</div>
${(project.commentsHistory && project.commentsHistory.length > 0) ? `
<div class="comments-box">
    <h3>Project History Comments</h3>
    ${project.commentsHistory.map(c => `<div class="c-line"><strong style="color:#666; font-size:0.75rem;">[${new Date(c.timestamp).toLocaleString()}]</strong> ${c.text}</div>`).join('')}
</div>` : ''}
<h2>Planned Tasks &amp; Logged Time Breakdown</h2>
${project.tasks.map(t => `
<h3 style="margin-top:20px; color:#1f6fb2;">Task: ${t.title} [Status: ${t.status || 'Not Started'}] ${t.deadline ? `<span style="font-size:0.8rem; color:#666; font-weight:normal;">(Deadline: ${t.deadline})</span>` : ''}</h3>
${t.comment ? `<p style="color:#555; font-style:italic; margin: 4px 0 10px 0;">Task Note: ${t.comment}</p>` : ''}
${t.logs.length === 0 ? '<p style="color:#777; font-style:italic;">No time logged for this task.</p>' : `
<table>
<thead><tr><th>Time Window</th><th>Duration</th><th>Logged By</th><th>Comments</th></tr></thead>
<tbody>
${t.logs.map(l => `<tr><td>${new Date(l.start).toLocaleString()} - ${new Date(l.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>${l.hours} Hrs</td><td>${l.loggedByName || '-'}</td><td>${l.comment || '-'}</td></tr>`).join('')}
</tbody>
</table>`}
`).join('')}
<div class="footer">FREELASYNC Project Report &bull; By Mostafa Sabry</div>
</body>
</html>`;

            const blob = new Blob([htmlStream], { type: "text/html;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Report_${project.name.replace(/\s+/g, '_')}.html`);
            link.click();
            URL.revokeObjectURL(url);
            ui.showNotify(`Report generated for [${project.name}].`);
        }
    };

    return { init: state.init, state, handlers, reports, ui };
})();
