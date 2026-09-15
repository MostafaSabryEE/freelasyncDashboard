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
    const TASK_PRIORITIES = ["Critical", "High", "Medium", "Low"];

    let _projects = [];
    let _users = [];
    let _activeProjectId = null;
    let _portfolioView = "list";
    let _filters = { search: "", status: "all", priority: "all", assignee: "all" };

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

        formatMoney: (value, currency = 'USD') => {
            const numeric = Number(value || 0);
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency || 'USD',
                maximumFractionDigits: 2
            }).format(numeric);
        },

        userNameById: (uid) => {
            const u = _users.find(x => x.id === uid);
            return u ? u.fullName : "Unassigned";
        },

        escapeHtml: (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[char])),

        isOverdue: (date, status) => Boolean(date && !["Done", "Delivered", "Cancelled"].includes(status) && new Date(`${date}T23:59:59`) < new Date()),

        priorityClass: (priority) => `priority-${(priority || "Medium").toLowerCase()}`,

        renderNotificationBadge: () => {
            const user = FreelaAuth.getCurrentUser();
            const unread = user && Array.isArray(user.notifications) ? user.notifications.filter(n => !n.read).length : 0;
            const existing = document.getElementById("notification_count");
            if (existing) existing.textContent = unread > 99 ? "99+" : String(unread);
            if (existing) existing.style.display = unread ? "inline-flex" : "none";
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
            ui.renderNotificationBadge();
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
                commentsHistory.push({ id: `C-${String(cSeq).padStart(5, '0')}`, timestamp: new Date().toISOString(), text: pData.initialComment, author: FreelaAuth.getCurrentUser().fullName, replyTo: null, mentions: state.extractMentions(pData.initialComment) });
            }

            const project = {
                id: pid, name: pData.name, client: pData.client, type: pData.type, status: pData.status,
                deadline: pData.deadline || "", commentsHistory, tasks: [], activityHistory: [],
                decisions: [], meetingNotes: [], attachments: [], approvals: [], releases: [],
                milestones: [], invoices: [], currency: pData.currency || 'USD',
                budget: Number(pData.budget || 0), hourlyRate: Number(pData.hourlyRate || 0),
                clientPortalStatus: 'Open', billingNotes: [], createdBy: FreelaAuth.getCurrentUser().id
            };

            state.recordActivity(project, "project_created", `Project created by ${FreelaAuth.getCurrentUser().fullName}.`);

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

        extractMentions: (text) => {
            const names = String(text).match(/@[a-zA-Z0-9._-]+/g) || [];
            return [...new Set(names.map(name => name.slice(1).toLowerCase()))];
        },

        findMentionedUser: (mention) => {
            const normalized = String(mention).replace(/[^a-z0-9]/gi, '').toLowerCase();
            return _users.find(item => {
                const username = String(item.username || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                const fullName = String(item.fullName || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                return username === normalized || fullName === normalized;
            });
        },

        notifyMentions: async (project, text) => {
            await state.reloadUsers();
            const mentions = state.extractMentions(text);
            const unresolved = [];
            let notified = 0;
            for (const mention of mentions) {
                const user = state.findMentionedUser(mention);
                if (!user) { unresolved.push(`@${mention}`); continue; }
                if (user.id !== FreelaAuth.getCurrentUser().id) {
                    await state.notifyUser(user.id, `${FreelaAuth.getCurrentUser().fullName} mentioned you in ${project.name}.`, project.id, "mention");
                    notified++;
                }
            }
            if (unresolved.length) ui.showNotify(`User not found: ${unresolved.join(', ')}`, "error");
            return notified;
        },

        addProjectComment: async (pid, commentText, replyTo = null) => {
            const p = _projects.find(x => x.id === pid);
            if (!p || !commentText.trim()) return;
            if (!p.commentsHistory) p.commentsHistory = [];
            const cSeq = await state.nextSeq("commentSeq");
            p.commentsHistory.unshift({ id: `C-${String(cSeq).padStart(5, '0')}`, timestamp: new Date().toISOString(), text: commentText.trim(), author: FreelaAuth.getCurrentUser().fullName, replyTo, mentions: state.extractMentions(commentText) });
            state.recordActivity(p, "comment_added", `${FreelaAuth.getCurrentUser().fullName} added a project comment.`);
            const mentionCount = await state.notifyMentions(p, commentText);
            await FreelaDB.put("projects", p);
            state.refreshDashboard();
            ui.showNotify(mentionCount ? `Comment posted. ${mentionCount} mention notification sent.` : "Comment added to project history.");
        },

        deleteProjectComment: async (pid, cid) => {
            const p = _projects.find(x => x.id === pid);
            if (!p || !p.commentsHistory) return;
            p.commentsHistory = p.commentsHistory.filter(c => c.id !== cid);
            await FreelaDB.put("projects", p);
            state.refreshDashboard();
            ui.showNotify("Comment removed.");
        },

        replyToComment: (pid, cid) => {
            const text = prompt("Write a reply:");
            if (text && text.trim()) state.addProjectComment(pid, text.trim(), cid);
        },

        handleMentionInput: (input) => {
            const suggestions = document.getElementById("mentionSuggestions");
            if (!suggestions) return;
            const match = input.value.slice(0, input.selectionStart).match(/@([a-zA-Z0-9._-]*)$/);
            if (!match) { suggestions.innerHTML = ""; suggestions.style.display = "none"; return; }
            const query = match[1].toLowerCase();
            const matches = _users.filter(user => user.username.toLowerCase().startsWith(query) || user.fullName.toLowerCase().replace(/\s+/g, '').startsWith(query)).slice(0, 6);
            if (!matches.length) { suggestions.innerHTML = ""; suggestions.style.display = "none"; return; }
            suggestions.innerHTML = matches.map(user => `<button type="button" class="mention-suggestion" onclick="App.state.selectMention('${ui.escapeHtml(user.username)}')"><strong>@${ui.escapeHtml(user.username)}</strong><small>${ui.escapeHtml(user.fullName)}</small></button>`).join('');
            suggestions.style.display = "flex";
        },

        selectMention: (username) => {
            const input = document.getElementById("newProjectCommentInput");
            const suggestions = document.getElementById("mentionSuggestions");
            if (!input) return;
            const beforeCursor = input.value.slice(0, input.selectionStart);
            const afterCursor = input.value.slice(input.selectionStart);
            input.value = `${beforeCursor.replace(/@[a-zA-Z0-9._-]*$/, `@${username} `)}${afterCursor}`;
            input.focus();
            const cursor = input.value.length - afterCursor.length;
            input.setSelectionRange(cursor, cursor);
            if (suggestions) { suggestions.innerHTML = ""; suggestions.style.display = "none"; }
        },

        addDecision: async (pid) => {
            const project = _projects.find(item => item.id === pid);
            if (!project || !FreelaAuth.getPermissions().manageTasks) return;
            const title = prompt("Decision title:");
            if (!title || !title.trim()) return;
            const rationale = prompt("Decision and rationale:");
            if (!rationale || !rationale.trim()) return;
            if (!project.decisions) project.decisions = [];
            project.decisions.unshift({ id: `D-${Date.now()}`, title: title.trim(), rationale: rationale.trim(), status: "Recorded", author: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            state.recordActivity(project, "decision_recorded", `Decision recorded: ${title.trim()}.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addMeetingNote: async (pid) => {
            const project = _projects.find(item => item.id === pid);
            if (!project || !FreelaAuth.getPermissions().manageTasks) return;
            const subject = prompt("Meeting subject:");
            if (!subject || !subject.trim()) return;
            const notes = prompt("Meeting notes and action items:");
            if (!notes || !notes.trim()) return;
            if (!project.meetingNotes) project.meetingNotes = [];
            project.meetingNotes.unshift({ id: `M-${Date.now()}`, subject: subject.trim(), notes: notes.trim(), author: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            state.recordActivity(project, "meeting_note_added", `Meeting notes added: ${subject.trim()}.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addAttachmentLink: async (pid) => {
            const project = _projects.find(item => item.id === pid);
            if (!project || !FreelaAuth.getPermissions().manageTasks) return;
            const name = prompt("Attachment name:");
            const url = prompt("Attachment URL (Supabase Storage or shared file link):");
            if (!name || !url || !name.trim() || !url.trim()) return;
            try { new URL(url.trim()); } catch (error) { ui.showNotify("Enter a valid attachment URL.", "error"); return; }
            if (!project.attachments) project.attachments = [];
            project.attachments.unshift({ id: `F-${Date.now()}`, name: name.trim(), url: url.trim(), uploadedBy: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            state.recordActivity(project, "attachment_added", `Attachment added: ${name.trim()}.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
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

        recordActivity: (project, eventType, message, taskId = null) => {
            if (!project.activityHistory) project.activityHistory = [];
            const user = FreelaAuth.getCurrentUser();
            project.activityHistory.unshift({
                id: `A-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                timestamp: new Date().toISOString(), eventType, message, taskId,
                actor: user ? user.fullName : "System"
            });
            project.activityHistory = project.activityHistory.slice(0, 100);
        },

        notifyUser: async (userId, message, projectId, type = "general") => {
            if (!userId) return;
            const user = await FreelaDB.get("users", userId) || _users.find(u => u.id === userId);
            if (!user) return;
            if (!Array.isArray(user.notifications)) user.notifications = [];
            user.notifications.unshift({ id: `N-${Date.now()}`, message, projectId, type, createdAt: new Date().toISOString(), read: false });
            user.notifications = user.notifications.slice(0, 50);
            await FreelaDB.put("users", user);
        },

        markNotificationsRead: async () => {
            const user = FreelaAuth.getCurrentUser();
            if (!user || !Array.isArray(user.notifications)) return;
            user.notifications.forEach(n => { n.read = true; });
            await FreelaDB.put("users", user);
            FreelaAuth.updateCachedUser(user);
            ui.renderNotificationBadge();
            ui.showNotify("Notifications marked as read.");
        },

        showNotifications: async () => {
            const currentUser = FreelaAuth.getCurrentUser();
            if (!currentUser) return;
            const user = await FreelaDB.get("users", currentUser.id) || currentUser;
            FreelaAuth.updateCachedUser(user);
            ui.renderNotificationBadge();
            const notifications = user && Array.isArray(user.notifications) ? user.notifications : [];
            const html = notifications.length
                ? `<div class="notification-list">${notifications.slice(0, 20).map(notification => `<div class="notification-item ${notification.read ? '' : 'unread'}"><strong>${ui.escapeHtml(notification.message)}</strong><small>${new Date(notification.createdAt).toLocaleString()}</small></div>`).join('')}</div>`
                : '<div class="empty-state">No notifications yet.</div>';
            ui.openModal("Notifications", html, async () => {
                await state.markNotificationsRead();
                ui.closeModal();
            });
        },

        addTask: async (pid, title, status, priority, deadline, comment, assignedTo, dependencies = []) => {
            const project = _projects.find(p => p.id === pid);
            if (!project) return;
            const seq = await state.nextSeq("taskSeq");
            const tid = `T-${String(seq).padStart(5, '0')}`;
            project.tasks.push({ id: tid, title, status, priority: priority || "Medium", deadline, comment, assignedTo: assignedTo || "", dependencies, blockers: [], requirements: [], testCases: [], bugs: [], logs: [] });
            state.recordActivity(project, "task_created", `Task "${title}" was created.`, tid);
            await state.notifyUser(assignedTo, `You were assigned task "${title}".`, pid);
            await FreelaDB.put("projects", project);
            state.syncDropdowns(pid);
            state.refreshDashboard();
            ui.showNotify(`Task added to [${project.name}].`);
        },

        addRequirement: async (pid, tid) => {
            const project = _projects.find(item => item.id === pid);
            const task = project && project.tasks.find(item => item.id === tid);
            if (!project || !task || !state.canEditTask(task)) return;
            const title = prompt("Requirement title:");
            const acceptance = prompt("Acceptance criteria:");
            if (!title || !acceptance || !title.trim() || !acceptance.trim()) return;
            task.requirements = task.requirements || [];
            task.requirements.push({ id: `REQ-${Date.now()}`, title: title.trim(), acceptanceCriteria: acceptance.trim(), status: "Open", createdBy: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            state.recordActivity(project, "requirement_added", `Requirement added to task "${task.title}".` , tid);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addTestCase: async (pid, tid) => {
            const project = _projects.find(item => item.id === pid);
            const task = project && project.tasks.find(item => item.id === tid);
            if (!project || !task || !state.canEditTask(task)) return;
            const title = prompt("Test case title:");
            const expected = prompt("Expected result:");
            if (!title || !expected || !title.trim() || !expected.trim()) return;
            task.testCases = task.testCases || [];
            task.testCases.push({ id: `TC-${Date.now()}`, title: title.trim(), expectedResult: expected.trim(), status: "Not Run", executedBy: "", executedAt: null, createdBy: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            state.recordActivity(project, "test_case_added", `Test case added to task "${task.title}".`, tid);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        updateTestCase: async (pid, tid, testId, status) => {
            const project = _projects.find(item => item.id === pid);
            const task = project && project.tasks.find(item => item.id === tid);
            const testCase = task && (task.testCases || []).find(item => item.id === testId);
            if (!project || !task || !testCase || !state.canEditTask(task)) return;
            testCase.status = status;
            testCase.executedBy = FreelaAuth.getCurrentUser().fullName;
            testCase.executedAt = new Date().toISOString();
            state.recordActivity(project, "test_case_updated", `Test case "${testCase.title}" marked ${status}.`, tid);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addBug: async (pid, tid) => {
            const project = _projects.find(item => item.id === pid);
            const task = project && project.tasks.find(item => item.id === tid);
            if (!project || !task || !state.canEditTask(task)) return;
            const title = prompt("Bug title:");
            const details = prompt("Steps or observed result:");
            if (!title || !details || !title.trim() || !details.trim()) return;
            task.bugs = task.bugs || [];
            task.bugs.push({ id: `BUG-${Date.now()}`, title: title.trim(), details: details.trim(), severity: "Medium", status: "Open", reportedBy: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            state.recordActivity(project, "bug_reported", `Bug reported on task "${task.title}".`, tid);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addApproval: async (pid) => {
            const project = _projects.find(item => item.id === pid);
            if (!project || !FreelaAuth.getPermissions().manageTasks) return;
            const subject = prompt("Approval subject:");
            if (!subject || !subject.trim()) return;
            project.approvals = project.approvals || [];
            project.approvals.unshift({ id: `APR-${Date.now()}`, subject: subject.trim(), status: "Pending", requestedBy: FreelaAuth.getCurrentUser().fullName, decidedBy: "", createdAt: new Date().toISOString() });
            state.recordActivity(project, "approval_requested", `Approval requested: ${subject.trim()}.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        decideApproval: async (pid, approvalId, status) => {
            const project = _projects.find(item => item.id === pid);
            const approval = project && (project.approvals || []).find(item => item.id === approvalId);
            if (!project || !approval || !FreelaAuth.getPermissions().manageProjects) return;
            approval.status = status;
            approval.decidedBy = FreelaAuth.getCurrentUser().fullName;
            approval.decidedAt = new Date().toISOString();
            state.recordActivity(project, "approval_decided", `Approval "${approval.subject}" marked ${status}.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addRelease: async (pid) => {
            const project = _projects.find(item => item.id === pid);
            if (!project || !FreelaAuth.getPermissions().manageProjects) return;
            const version = prompt("Release version:");
            const notes = prompt("Release notes:");
            if (!version || !notes || !version.trim() || !notes.trim()) return;
            project.releases = project.releases || [];
            project.releases.unshift({ id: `REL-${Date.now()}`, version: version.trim(), notes: notes.trim(), status: "Planned", plannedDate: "", createdBy: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            state.recordActivity(project, "release_created", `Release ${version.trim()} planned.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addMilestone: async (pid) => {
            const project = _projects.find(item => item.id === pid);
            if (!project || !FreelaAuth.getPermissions().manageProjects) return;
            const title = prompt("Milestone title:");
            const amountString = prompt("Milestone value or amount:", "0");
            const dueDate = prompt("Milestone due date (YYYY-MM-DD):", "");
            if (!title || !title.trim()) return;
            project.milestones = project.milestones || [];
            const amount = Number(amountString || 0);
            project.milestones.unshift({
                id: `MS-${Date.now()}`,
                title: title.trim(),
                amount: Number.isFinite(amount) ? amount : 0,
                dueDate: dueDate || "",
                status: "Planned",
                createdAt: new Date().toISOString()
            });
            state.recordActivity(project, "milestone_added", `Milestone "${title.trim()}" planned.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        updateMilestoneStatus: async (pid, milestoneId, status) => {
            const project = _projects.find(item => item.id === pid);
            const milestone = project && (project.milestones || []).find(item => item.id === milestoneId);
            if (!project || !milestone || !FreelaAuth.getPermissions().manageProjects) return;
            milestone.status = status;
            state.recordActivity(project, "milestone_updated", `Milestone "${milestone.title}" marked ${status}.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        addInvoice: async (pid) => {
            const project = _projects.find(item => item.id === pid);
            if (!project || !FreelaAuth.getPermissions().manageProjects) return;
            const invoiceNumber = prompt("Invoice reference:");
            const amountString = prompt("Invoice amount:", "0");
            const dueDate = prompt("Due date (YYYY-MM-DD):", "");
            if (!invoiceNumber || !invoiceNumber.trim()) return;
            project.invoices = project.invoices || [];
            const amount = Number(amountString || 0);
            project.invoices.unshift({
                id: `INV-${Date.now()}`,
                invoiceNumber: invoiceNumber.trim(),
                amount: Number.isFinite(amount) ? amount : 0,
                dueDate: dueDate || "",
                status: "Open",
                createdAt: new Date().toISOString()
            });
            state.recordActivity(project, "invoice_added", `Invoice ${invoiceNumber.trim()} created.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        updateInvoiceStatus: async (pid, invoiceId, status) => {
            const project = _projects.find(item => item.id === pid);
            const invoice = project && (project.invoices || []).find(item => item.id === invoiceId);
            if (!project || !invoice || !FreelaAuth.getPermissions().manageProjects) return;
            invoice.status = status;
            state.recordActivity(project, "invoice_updated", `Invoice ${invoice.invoiceNumber} marked ${status}.`);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        editTask: (pid, tid) => {
            const project = _projects.find(p => p.id === pid);
            const task = project ? project.tasks.find(t => t.id === tid) : null;
            if (!task || !state.canEditTask(task)) { ui.showNotify("You do not have permission to edit this task.", "error"); return; }

            const perms = FreelaAuth.getPermissions();
            const statusOptions = TASK_STATUSES.map(s => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${s}</option>`).join('');
            const priorityOptions = TASK_PRIORITIES.map(p => `<option value="${p}" ${(task.priority || 'Medium') === p ? 'selected' : ''}>${p}</option>`).join('');
            const assigneeOptions = `<option value="">(Unassigned)</option>` + _users.map(u => `<option value="${u.id}" ${task.assignedTo === u.id ? 'selected' : ''}>${u.fullName} (${FreelaAuth.roleLabel(u.role)})</option>`).join('');
            const dependencyOptions = project.tasks.filter(t => t.id !== tid).map(t => `<option value="${t.id}" ${(task.dependencies || []).includes(t.id) ? 'selected' : ''}>${t.title}</option>`).join('');
            const blockersText = (task.blockers || []).filter(b => b.status !== 'resolved').map(b => b.text).join('\n');

            const html = `
                <div class="form-group"><label>Task Title</label><input type="text" id="mTTitle" value="${task.title}" ${perms.manageProjects ? '' : 'disabled'}></div>
                <div class="form-group"><label>Task Status</label><select id="mTStatus">${statusOptions}</select></div>
                <div class="form-group"><label>Priority</label><select id="mTPriority">${priorityOptions}</select></div>
                <div class="form-group"><label>Task Deadline</label><input type="date" id="mTDeadline" value="${task.deadline || ''}" ${perms.manageProjects ? '' : 'disabled'}></div>
                <div class="form-group"><label>Assigned To</label><select id="mTAssignee" ${perms.manageProjects ? '' : 'disabled'}>${assigneeOptions}</select></div>
                <div class="form-group"><label>Dependencies</label><select id="mTDependencies" multiple size="4" ${perms.manageProjects ? '' : 'disabled'}>${dependencyOptions}</select></div>
                <div class="form-group"><label>Open Blockers</label><textarea id="mTBlockers" placeholder="One blocker per line">${blockersText}</textarea></div>
                <div class="form-group"><label>Task Comments</label><textarea id="mTComment">${task.comment || ''}</textarea></div>
            `;
            ui.openModal("Edit Task", html, async () => {
                const previousAssignee = task.assignedTo;
                const previousStatus = task.status;
                if (perms.manageProjects) {
                    task.title = document.getElementById('mTTitle').value.trim() || task.title;
                    task.deadline = document.getElementById('mTDeadline').value;
                    task.assignedTo = document.getElementById('mTAssignee').value;
                    task.dependencies = Array.from(document.getElementById('mTDependencies').selectedOptions).map(option => option.value);
                }
                task.status = document.getElementById('mTStatus').value;
                task.priority = document.getElementById('mTPriority').value;
                task.comment = document.getElementById('mTComment').value.trim();
                const blockerLines = document.getElementById('mTBlockers').value.split('\n').map(value => value.trim()).filter(Boolean);
                task.blockers = blockerLines.map((text, index) => ({ id: (task.blockers || [])[index]?.id || `B-${Date.now()}-${index}`, text, status: 'open', createdBy: FreelaAuth.getCurrentUser().fullName, createdAt: (task.blockers || [])[index]?.createdAt || new Date().toISOString() }));
                if (previousStatus !== task.status) state.recordActivity(project, "task_status_changed", `Task "${task.title}" changed to ${task.status}.`, tid);
                if (previousAssignee !== task.assignedTo) await state.notifyUser(task.assignedTo, `You were assigned task "${task.title}".`, pid);
                state.recordActivity(project, "task_updated", `Task "${task.title}" was updated.`, tid);
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

        addBlocker: async (pid, tid) => {
            const project = _projects.find(p => p.id === pid);
            const task = project ? project.tasks.find(t => t.id === tid) : null;
            if (!task || !state.canEditTask(task)) return;
            const text = prompt("Describe the blocker:");
            if (!text || !text.trim()) return;
            if (!task.blockers) task.blockers = [];
            task.blockers.push({ id: `B-${Date.now()}`, text: text.trim(), status: 'open', createdBy: FreelaAuth.getCurrentUser().fullName, createdAt: new Date().toISOString() });
            task.status = "Blocked";
            state.recordActivity(project, "blocker_created", `Blocker added to task "${task.title}".`, tid);
            await FreelaDB.put("projects", project);
            await state.notifyUser(project.createdBy, `A blocker was added to task "${task.title}".`, pid);
            state.refreshDashboard();
        },

        resolveBlocker: async (pid, tid, blockerId) => {
            const project = _projects.find(p => p.id === pid);
            const task = project ? project.tasks.find(t => t.id === tid) : null;
            const blocker = task && (task.blockers || []).find(b => b.id === blockerId);
            if (!project || !task || !blocker || !state.canEditTask(task)) return;
            blocker.status = "resolved";
            state.recordActivity(project, "blocker_resolved", `Blocker resolved on task "${task.title}".`, tid);
            await FreelaDB.put("projects", project);
            state.refreshDashboard();
        },

        setPortfolioView: (view) => { _portfolioView = view; state.refreshDashboard(); },
        updateFilter: (key, value) => { _filters[key] = value; state.refreshDashboard(); },

        startTaskDrag: (event, pid, tid) => { event.dataTransfer.setData("text/plain", JSON.stringify({ pid, tid })); },
        dropTask: async (event, status) => {
            event.preventDefault();
            try {
                const item = JSON.parse(event.dataTransfer.getData("text/plain"));
                const project = _projects.find(p => p.id === item.pid);
                const task = project && project.tasks.find(t => t.id === item.tid);
                if (!task || !state.canEditTask(task)) return;
                task.status = status;
                state.recordActivity(project, "task_status_changed", `Task "${task.title}" moved to ${status}.`, task.id);
                await FreelaDB.put("projects", project);
                state.refreshDashboard();
            } catch (error) { ui.showNotify("Unable to move task.", "error"); }
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
            let totalHours = 0, totalTasks = 0, overdueTasks = 0, blockedTasks = 0;
            const workload = {};
            _projects.forEach(p => {
                totalTasks += p.tasks.length;
                p.tasks.forEach(t => {
                    t.logs.forEach(l => totalHours += l.hours);
                    if (ui.isOverdue(t.deadline, t.status)) overdueTasks++;
                    if (t.status === "Blocked" || (t.blockers || []).some(b => b.status === "open")) blockedTasks++;
                    if (t.assignedTo) workload[t.assignedTo] = (workload[t.assignedTo] || 0) + 1;
                });
            });
            ui.dom.summary.innerHTML = `
                <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${_projects.length}</div></div>
                <div class="stat-card"><div class="stat-label">Tasks Planned</div><div class="stat-value">${totalTasks}</div></div>
                <div class="stat-card"><div class="stat-label">Total Time Logged</div><div class="stat-value">${totalHours.toFixed(2)} Hrs</div></div>
                <div class="stat-card ${overdueTasks ? 'stat-alert' : ''}"><div class="stat-label">Overdue</div><div class="stat-value">${overdueTasks}</div></div>
                <div class="stat-card ${blockedTasks ? 'stat-alert' : ''}"><div class="stat-label">Blocked</div><div class="stat-value">${blockedTasks}</div></div>
                <div class="stat-card"><div class="stat-label">Assigned Work</div><div class="stat-value">${Object.keys(workload).length} People</div></div>
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

            const matchingProjects = _projects.filter(p => {
                const haystack = `${p.name} ${p.client} ${p.status}`.toLowerCase();
                return (!_filters.search || haystack.includes(_filters.search.toLowerCase())) &&
                    (_filters.status === "all" || p.status === _filters.status);
            });

            const filteredTasks = matchingProjects.flatMap(p => p.tasks.map(task => ({ project: p, task }))).filter(({ task }) => {
                const haystack = `${task.title} ${task.comment || ''}`.toLowerCase();
                return (!_filters.search || haystack.includes(_filters.search.toLowerCase())) &&
                    (_filters.priority === "all" || (task.priority || "Medium") === _filters.priority) &&
                    (_filters.assignee === "all" || (task.assignedTo || "") === _filters.assignee);
            });

            const taskCard = ({ project: p, task: t }, draggable = false) => {
                const tStatus = t.status || 'Not Started';
                const blockerCount = (t.blockers || []).filter(b => b.status === 'open').length;
                return `<div class="kanban-task" ${draggable ? `draggable="true" ondragstart="App.state.startTaskDrag(event, '${p.id}', '${t.id}')"` : ''} onclick="App.state.openProjectDetails('${p.id}')">
                    <div class="kanban-task-title">${ui.escapeHtml(t.title)}</div>
                    <div class="kanban-task-meta"><span class="priority-chip ${ui.priorityClass(t.priority)}">${t.priority || 'Medium'}</span><span>${ui.escapeHtml(p.name)}</span></div>
                    <div class="kanban-task-meta"><span>${t.assignedTo ? ui.escapeHtml(ui.userNameById(t.assignedTo)) : 'Unassigned'}</span>${ui.isOverdue(t.deadline, tStatus) ? '<span class="overdue-label">Overdue</span>' : ''}${blockerCount ? `<span class="blocker-label">${blockerCount} blocker${blockerCount > 1 ? 's' : ''}</span>` : ''}</div>
                </div>`;
            };

            const rowsHtml = matchingProjects.map(p => {
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
                                <span>${filteredTasks.filter(item => item.project.id === p.id).length}/${p.tasks.length} Tasks</span><span>&bull;</span>
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

            const statusesHtml = TASK_STATUSES.map(status => `<section class="kanban-column" ondragover="event.preventDefault()" ondrop="App.state.dropTask(event, '${status}')"><div class="kanban-column-title"><span>${status}</span><span>${filteredTasks.filter(({ task }) => (task.status || 'Not Started') === status).length}</span></div>${filteredTasks.filter(({ task }) => (task.status || 'Not Started') === status).map(item => taskCard(item, true)).join('') || '<div class="kanban-empty">No tasks</div>'}</section>`).join('');
            const workloadRows = _users.map(user => {
                const assigned = filteredTasks.filter(({ task }) => task.assignedTo === user.id).length;
                return assigned ? `<div class="workload-row"><span>${ui.escapeHtml(user.fullName)}</span><strong>${assigned} task${assigned > 1 ? 's' : ''}</strong></div>` : '';
            }).join('');
            const activity = matchingProjects.flatMap(p => (p.activityHistory || []).map(event => ({ ...event, projectName: p.name }))).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 8);
            const activityHtml = activity.map(event => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${ui.escapeHtml(event.message)}</strong><small>${ui.escapeHtml(event.projectName)} &middot; ${new Date(event.timestamp).toLocaleString()}</small></div></div>`).join('') || '<div class="empty-state">No activity recorded yet.</div>';
            const assigneeOptions = _users.map(user => `<option value="${user.id}" ${_filters.assignee === user.id ? 'selected' : ''}>${ui.escapeHtml(user.fullName)}</option>`).join('');

            ui.dom.mainContentPanel.innerHTML = `
                <div class="panel-header">
                    <span>Monitoring Workspace</span>
                    <div class="view-toggle"><button class="btn-sm ${_portfolioView === 'list' ? 'btn-primary' : 'btn-secondary'}" onclick="App.state.setPortfolioView('list')">Projects</button><button class="btn-sm ${_portfolioView === 'kanban' ? 'btn-primary' : 'btn-secondary'}" onclick="App.state.setPortfolioView('kanban')">Kanban</button></div>
                </div>
                <div class="monitor-toolbar"><input type="search" placeholder="Search projects and tasks..." value="${ui.escapeHtml(_filters.search)}" oninput="App.state.updateFilter('search', this.value)"><select onchange="App.state.updateFilter('status', this.value)"><option value="all">All project statuses</option>${PROJECT_STATUSES.map(status => `<option value="${status}" ${_filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select><select onchange="App.state.updateFilter('priority', this.value)"><option value="all">All priorities</option>${TASK_PRIORITIES.map(priority => `<option value="${priority}" ${_filters.priority === priority ? 'selected' : ''}>${priority}</option>`).join('')}</select><select onchange="App.state.updateFilter('assignee', this.value)"><option value="all">All assignees</option>${assigneeOptions}</select><button class="btn-secondary btn-sm" onclick="App.state.markNotificationsRead()">Mark notifications read</button></div>
                ${_portfolioView === 'kanban' ? `<div class="kanban-board">${statusesHtml}</div>` : `<div class="project-list">${rowsHtml || '<div class="empty-state">No projects or tasks match the current filters.</div>'}</div>`}
                <div class="monitor-panels"><div class="monitor-panel"><div class="monitor-panel-title">Workload</div>${workloadRows || '<div class="empty-state">No assigned work.</div>'}</div><div class="monitor-panel"><div class="monitor-panel-title">Recent Activity</div><div class="activity-list">${activityHtml}</div></div></div>
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
                        <span class="comment-time">${new Date(c.timestamp).toLocaleString()} ${c.author ? '&middot; ' + ui.escapeHtml(c.author) : ''}${c.replyTo ? ' &middot; Reply' : ''}</span>
                        ${perms.deleteData ? `<button class="btn-danger btn-sm" onclick="App.state.deleteProjectComment('${p.id}', '${c.id}')">x</button>` : ''}
                    </div>
                    <div class="comment-text">${ui.escapeHtml(c.text)}</div>
                    <button class="btn-secondary btn-sm comment-reply" onclick="App.state.replyToComment('${p.id}', '${c.id}')">Reply</button>
                </div>
            `).join('');

            const decisionsHtml = (p.decisions || []).map(decision => `<div class="communication-item"><strong>${ui.escapeHtml(decision.title)}</strong><span>${ui.escapeHtml(decision.rationale)}</span><small>${ui.escapeHtml(decision.author)} &middot; ${new Date(decision.createdAt).toLocaleString()}</small></div>`).join('') || '<div class="empty-state">No decisions recorded.</div>';
            const meetingNotesHtml = (p.meetingNotes || []).map(note => `<div class="communication-item"><strong>${ui.escapeHtml(note.subject)}</strong><span>${ui.escapeHtml(note.notes)}</span><small>${ui.escapeHtml(note.author)} &middot; ${new Date(note.createdAt).toLocaleString()}</small></div>`).join('') || '<div class="empty-state">No meeting notes recorded.</div>';
            const attachmentsHtml = (p.attachments || []).map(file => `<div class="communication-item attachment-item"><a href="${ui.escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${ui.escapeHtml(file.name)}</a><small>${ui.escapeHtml(file.uploadedBy)} &middot; ${new Date(file.createdAt).toLocaleString()}</small></div>`).join('') || '<div class="empty-state">No attachments linked.</div>';
            const projectBudget = Number(p.budget || 0);
            const projectRate = Number(p.hourlyRate || 0);
            const paidValue = (p.invoices || []).filter(i => i.status === 'Paid').reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const pendingValue = (p.invoices || []).filter(i => i.status !== 'Paid').reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const milestoneValue = (p.milestones || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const milestonesHtml = (p.milestones || []).map(milestone => `
                <div class="finance-item">
                    <div class="finance-item-row"><strong>${ui.escapeHtml(milestone.title)}</strong><span class="sdlc-status ${milestone.status === 'Done' ? 'sdlc-passed' : milestone.status === 'In Progress' ? 'sdlc-open' : 'approval-pending'}">${ui.escapeHtml(milestone.status)}</span></div>
                    <div class="finance-item-row"><small>${ui.escapeHtml(milestone.dueDate || 'No due date')}</small><small>${ui.formatMoney(milestone.amount, p.currency || 'USD')}</small></div>
                    <div class="task-ctrls">
                        <button class="btn-secondary btn-sm" onclick="App.state.updateMilestoneStatus('${p.id}', '${milestone.id}', 'In Progress')">In Progress</button>
                        <button class="btn-primary btn-sm" onclick="App.state.updateMilestoneStatus('${p.id}', '${milestone.id}', 'Done')">Done</button>
                    </div>
                </div>
            `).join('') || '<div class="empty-state">No milestones planned.</div>';
            const invoicesHtml = (p.invoices || []).map(invoice => `
                <div class="finance-item">
                    <div class="finance-item-row"><strong>${ui.escapeHtml(invoice.invoiceNumber)}</strong><span class="sdlc-status ${invoice.status === 'Paid' ? 'sdlc-passed' : invoice.status === 'Pending' ? 'approval-pending' : 'sdlc-open'}">${ui.escapeHtml(invoice.status)}</span></div>
                    <div class="finance-item-row"><small>${ui.escapeHtml(invoice.dueDate || 'No due date')}</small><small>${ui.formatMoney(invoice.amount, p.currency || 'USD')}</small></div>
                    <div class="task-ctrls">
                        <button class="btn-secondary btn-sm" onclick="App.state.updateInvoiceStatus('${p.id}', '${invoice.id}', 'Pending')">Pending</button>
                        <button class="btn-primary btn-sm" onclick="App.state.updateInvoiceStatus('${p.id}', '${invoice.id}', 'Paid')">Paid</button>
                    </div>
                </div>
            `).join('') || '<div class="empty-state">No billing records.</div>';

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
                            <div class="task-flags"><span class="priority-chip ${ui.priorityClass(t.priority)}">${t.priority || 'Medium'} priority</span>${(t.dependencies || []).length ? `<span class="dependency-label">${t.dependencies.length} dependency${t.dependencies.length > 1 ? 'ies' : ''}</span>` : ''}${(t.blockers || []).filter(b => b.status === 'open').map(b => `<span class="blocker-label" title="${ui.escapeHtml(b.text)}">Blocker: ${ui.escapeHtml(b.text)}</span><button class="btn-secondary btn-sm" onclick="App.state.resolveBlocker('${p.id}', '${t.id}', '${b.id}')">Resolve</button>`).join('')}</div>
                            ${t.comment ? `<div class="task-comment">Comment: ${ui.escapeHtml(t.comment)}</div>` : ''}
                            ${canEdit ? `<button class="btn-danger btn-sm blocker-button" onclick="App.state.addBlocker('${p.id}', '${t.id}')">Add Blocker</button>` : ''}
                            ${canEdit ? `<div class="sdlc-actions"><button class="btn-secondary btn-sm" onclick="App.state.addRequirement('${p.id}', '${t.id}')">Requirement</button><button class="btn-secondary btn-sm" onclick="App.state.addTestCase('${p.id}', '${t.id}')">Test Case</button><button class="btn-secondary btn-sm" onclick="App.state.addBug('${p.id}', '${t.id}')">Report Bug</button></div>` : ''}
                            ${(t.requirements || []).length ? `<div class="task-sdlc-list"><strong>Requirements</strong>${t.requirements.map(item => `<div><span class="sdlc-status sdlc-open">${ui.escapeHtml(item.status)}</span>${ui.escapeHtml(item.title)}<small>Acceptance: ${ui.escapeHtml(item.acceptanceCriteria)}</small></div>`).join('')}</div>` : ''}
                            ${(t.testCases || []).length ? `<div class="task-sdlc-list"><strong>Test Cases</strong>${t.testCases.map(item => `<div><span class="sdlc-status sdlc-${item.status.toLowerCase().replace(/\s+/g, '-')}">${ui.escapeHtml(item.status)}</span>${ui.escapeHtml(item.title)}<button class="btn-secondary btn-sm" onclick="App.state.updateTestCase('${p.id}', '${t.id}', '${item.id}', '${item.status === 'Passed' ? 'Failed' : 'Passed'}')">Mark ${item.status === 'Passed' ? 'Failed' : 'Passed'}</button><small>Expected: ${ui.escapeHtml(item.expectedResult)}</small></div>`).join('')}</div>` : ''}
                            ${(t.bugs || []).length ? `<div class="task-sdlc-list"><strong>Bugs</strong>${t.bugs.map(item => `<div><span class="sdlc-status sdlc-bug">${ui.escapeHtml(item.severity)}</span>${ui.escapeHtml(item.title)}<small>${ui.escapeHtml(item.status)}: ${ui.escapeHtml(item.details)}</small></div>`).join('')}</div>` : ''}
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
                        <div class="metric"><div class="metric-value">${ui.formatMoney(projectBudget, p.currency || 'USD')}</div><div class="metric-label">Budget</div></div>
                        <div class="metric"><div class="metric-value">${ui.formatMoney(paidValue, p.currency || 'USD')}</div><div class="metric-label">Collected</div></div>
                    </div>

                    <div class="communication-grid finance-grid">
                        <div class="comment-history-panel"><div class="comment-history-title">Project Finance <button class="btn-primary btn-sm" onclick="App.state.addMilestone('${p.id}')">Add milestone</button></div><div class="communication-list">${milestonesHtml}</div></div>
                        <div class="comment-history-panel"><div class="comment-history-title">Invoices <button class="btn-primary btn-sm" onclick="App.state.addInvoice('${p.id}')">Add invoice</button></div><div class="communication-list">${invoicesHtml}</div></div>
                        <div class="comment-history-panel"><div class="comment-history-title">Finance Snapshot</div><div class="communication-list"><div class="finance-item"><div class="finance-item-row"><strong>Budget</strong><span>${ui.formatMoney(projectBudget, p.currency || 'USD')}</span></div><div class="finance-item-row"><small>Hourly / rate</small><small>${ui.formatMoney(projectRate, p.currency || 'USD')}/hr</small></div></div><div class="finance-item"><div class="finance-item-row"><strong>Collected</strong><span>${ui.formatMoney(paidValue, p.currency || 'USD')}</span></div><div class="finance-item-row"><small>Outstanding</small><small>${ui.formatMoney(pendingValue, p.currency || 'USD')}</small></div></div><div class="finance-item"><div class="finance-item-row"><strong>Milestone value</strong><span>${ui.formatMoney(milestoneValue, p.currency || 'USD')}</span></div><div class="finance-item-row"><small>Portal status</small><small>${ui.escapeHtml(p.clientPortalStatus || 'Open')}</small></div></div></div></div>
                    </div>

                    <div class="comment-history-panel">
                        <div class="comment-history-title">Project Comment History (${(p.commentsHistory || []).length})</div>
                        <div class="comment-compose">
                            <div class="mention-input-wrap"><input type="text" id="newProjectCommentInput" placeholder="Comment or mention @username..." oninput="App.state.handleMentionInput(this)" style="flex-grow:1;"><div id="mentionSuggestions" class="mention-suggestions"></div></div>
                            <button class="btn-primary btn-sm" onclick="App.handlers.postProjectComment('${p.id}')">Post Comment</button>
                        </div>
                        <div class="comment-history-list">
                            ${commentsList || '<div style="font-style:italic; color:var(--text-muted); font-size:0.8rem;">No project comments logged yet.</div>'}
                        </div>
                    </div>

                    <div class="communication-grid">
                        <div class="comment-history-panel"><div class="comment-history-title">Decisions <button class="btn-primary btn-sm" onclick="App.state.addDecision('${p.id}')">Add</button></div><div class="communication-list">${decisionsHtml}</div></div>
                        <div class="comment-history-panel"><div class="comment-history-title">Meeting Notes <button class="btn-primary btn-sm" onclick="App.state.addMeetingNote('${p.id}')">Add</button></div><div class="communication-list">${meetingNotesHtml}</div></div>
                        <div class="comment-history-panel"><div class="comment-history-title">Attachments <button class="btn-primary btn-sm" onclick="App.state.addAttachmentLink('${p.id}')">Link</button></div><div class="communication-list">${attachmentsHtml}</div></div>
                    </div>

                    <div class="communication-grid sdlc-project-grid">
                        <div class="comment-history-panel"><div class="comment-history-title">Approvals <button class="btn-primary btn-sm" onclick="App.state.addApproval('${p.id}')">Request</button></div><div class="communication-list">${(p.approvals || []).map(item => `<div class="communication-item"><strong>${ui.escapeHtml(item.subject)}</strong><span class="sdlc-status approval-${item.status.toLowerCase()}">${ui.escapeHtml(item.status)}</span><small>Requested by ${ui.escapeHtml(item.requestedBy)}</small>${item.status === 'Pending' && perms.manageProjects ? `<div><button class="btn-primary btn-sm" onclick="App.state.decideApproval('${p.id}', '${item.id}', 'Approved')">Approve</button> <button class="btn-danger btn-sm" onclick="App.state.decideApproval('${p.id}', '${item.id}', 'Rejected')">Reject</button></div>` : ''}</div>`).join('') || '<div class="empty-state">No approvals.</div>'}</div></div>
                        <div class="comment-history-panel"><div class="comment-history-title">Releases <button class="btn-primary btn-sm" onclick="App.state.addRelease('${p.id}')">Plan</button></div><div class="communication-list">${(p.releases || []).map(item => `<div class="communication-item"><strong>${ui.escapeHtml(item.version)}</strong><span>${ui.escapeHtml(item.notes)}</span><small>${ui.escapeHtml(item.status)} &middot; ${ui.escapeHtml(item.createdBy)}</small></div>`).join('') || '<div class="empty-state">No releases planned.</div>'}</div></div>
                    </div>

                    <div class="task-list">
                        <div class="task-list-title">Planned Project Tasks & Time Logs<span>${visibleTasks.length} Tasks</span></div>
                        ${tasksHtml}
                    </div>
                    <div class="comment-history-panel"><div class="comment-history-title">Activity Feed</div><div class="activity-list">${(p.activityHistory || []).slice(0, 15).map(event => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${ui.escapeHtml(event.message)}</strong><small>${ui.escapeHtml(event.actor)} &middot; ${new Date(event.timestamp).toLocaleString()}</small></div></div>`).join('') || '<div class="empty-state">No activity recorded yet.</div>'}</div></div>
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

        postProjectComment: async (pid) => {
            const input = document.getElementById('newProjectCommentInput');
            if (!input || !input.value.trim()) return;
            await state.addProjectComment(pid, input.value.trim());
            input.value = "";
            const suggestions = document.getElementById("mentionSuggestions");
            if (suggestions) { suggestions.innerHTML = ""; suggestions.style.display = "none"; }
        },

        createTask: (e) => {
            e.preventDefault();
            if (!FreelaAuth.getPermissions().manageProjects) { ui.showNotify("You do not have permission to create tasks.", "error"); return; }
            const pid = ui.dom.tProjectSelect.value;
            const title = document.getElementById('tTitle').value.trim();
            const status = document.getElementById('tStatus').value;
            const priority = document.getElementById('tPriority').value;
            const deadline = document.getElementById('tDeadline').value;
            const comment = document.getElementById('tComment').value.trim();
            const assignedTo = ui.dom.tAssigneeSelect.value;
            if (!pid || !title) return;
            state.addTask(pid, title, status, priority, deadline, comment, assignedTo);
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
