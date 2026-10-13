"use strict";
/*
 * Tab registry. Feature modules register a tab (button + panel) with a
 * visibility rule and a render function instead of hard-coding markup.
 */
const FreelaTabs = (() => {
    const tabs = [];
    let activeId = "workspace";

    const byId = (id) => tabs.find(tab => tab.id === id);
    const bar = () => document.querySelector(".tab-bar");

    function createElements(def) {
        if (!document.getElementById(def.btnId)) {
            const button = document.createElement("button");
            button.className = "tab-btn";
            button.id = def.btnId;
            button.type = "button";
            button.setAttribute("role", "tab");
            button.setAttribute("aria-selected", "false");
            button.setAttribute("aria-controls", def.panelId);
            button.textContent = def.label;
            bar().appendChild(button);
        }
        if (!document.getElementById(def.panelId)) {
            const panel = document.createElement("main");
            panel.id = def.panelId;
            panel.className = "tab-panel-single";
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", def.btnId);
            panel.style.display = "none";
            panel.innerHTML = `<div class="panel" id="${def.id}_panel"></div>`;
            document.getElementById("tab_users").parentNode.appendChild(panel);
        }
        document.getElementById(def.btnId).addEventListener("click", () => show(def.id));
    }

    function register(def) {
        const tab = { order: 50, display: "grid", visible: () => true, ...def };
        tab.btnId = tab.btnId || `tab_${tab.id}_btn`;
        tab.panelId = tab.panelId || `tab_${tab.id}`;
        createElements(tab);
        tabs.push(tab);
        tabs.sort((a, b) => a.order - b.order);
        tabs.forEach(item => bar().appendChild(document.getElementById(item.btnId)));
    }

    function isVisible(tab) {
        const user = FreelaAuth.getCurrentUser();
        return Boolean(user) && tab.visible(user, FreelaAuth.getPermissions());
    }

    function applyVisibility() {
        tabs.forEach(tab => {
            document.getElementById(tab.btnId).style.display = isVisible(tab) ? "" : "none";
        });
        if (!byId(activeId) || !isVisible(byId(activeId))) show("workspace");
        else show(activeId);
    }

    function show(id) {
        const target = byId(id);
        if (!target || !isVisible(target)) return;
        activeId = id;
        tabs.forEach(tab => {
            const active = tab.id === id;
            document.getElementById(tab.panelId).style.display = active ? tab.display : "none";
            const button = document.getElementById(tab.btnId);
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", String(active));
        });
        renderActive();
    }

    // Re-renders only the visible tab so background refreshes stay cheap.
    function renderActive() {
        const tab = byId(activeId);
        if (tab && tab.render) tab.render(document.getElementById(`${tab.id}_panel`) || document.getElementById(tab.panelId));
    }

    const getActive = () => activeId;

    return { register, show, applyVisibility, renderActive, getActive };
})();

function switchTab(tab) {
    FreelaTabs.show(tab);
}
