"use strict";
/*
 * FreelaSync client-side database layer.
 * Uses IndexedDB (falls back to localStorage) so the tool works fully
 * offline as a static site (GitHub Pages has no server-side backend).
 * Object stores: "users", "projects".
 */
const FreelaDB = (() => {
    const DB_NAME = "freelasync_db";
    const DB_VERSION = 2;
    const STORES = ["users", "projects", "meta", "teams", "todos"];

    // Remote (Supabase) tables that map 1:1 onto simple records.
    const REMOTE_TABLES = {
        teams: {
            table: "app_teams",
            fromRow: r => ({ id: r.id, name: r.name, ownerId: r.owner_id || "", createdAt: r.created_at }),
            toRow: r => ({ id: r.id, name: r.name, owner_id: r.ownerId || null })
        },
        todos: {
            table: "app_todos",
            fromRow: r => ({ id: r.id, userId: r.user_id, title: r.title, done: r.done, createdAt: r.created_at }),
            toRow: r => ({ id: r.id, user_id: r.userId, title: r.title, done: Boolean(r.done) })
        }
    };

    let _dbPromise = null;
    let _fallbackMode = false;
    let _fallbackData = null; // { users: [], projects: [], meta: [] }

    const FALLBACK_KEY = "freelasync_fallback_store_v1";

    function remoteClient() {
        return typeof FreelaSupabase !== "undefined" ? FreelaSupabase.getClient() : null;
    }

    function remoteReady() {
        return Boolean(remoteClient());
    }

    function loadFallback() {
        try {
            const raw = localStorage.getItem(FALLBACK_KEY);
            _fallbackData = raw ? JSON.parse(raw) : {};
            STORES.forEach(s => { if (!_fallbackData[s]) _fallbackData[s] = []; });
        } catch (e) {
            _fallbackData = { users: [], projects: [], meta: [], teams: [], todos: [] };
        }
    }

    function saveFallback() {
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(_fallbackData));
    }

    function open() {
        if (_dbPromise) return _dbPromise;

        _dbPromise = new Promise((resolve) => {
            if (!window.indexedDB) {
                _fallbackMode = true;
                loadFallback();
                resolve(null);
                return;
            }

            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("users")) {
                    db.createObjectStore("users", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("projects")) {
                    db.createObjectStore("projects", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("meta")) {
                    db.createObjectStore("meta", { keyPath: "key" });
                }
                ["teams", "todos"].forEach(name => {
                    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
                });
            };

            req.onsuccess = (e) => {
                const db = e.target.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
            req.onerror = () => {
                _fallbackMode = true;
                loadFallback();
                resolve(null);
            };
        });

        return _dbPromise;
    }

    async function getAll(store) {
        const client = remoteClient();
        if (client && REMOTE_TABLES[store]) {
            const { data, error } = await client.from(REMOTE_TABLES[store].table).select("*").order("created_at");
            if (error) throw error;
            return data.map(REMOTE_TABLES[store].fromRow);
        }
        if (client && store === "users") {
            const { data, error } = await client.from("app_users").select("*").order("created_at");
            if (error) throw error;
            return data.map(user => ({
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                role: user.role,
                active: user.active,
                notifications: user.notifications || [],
                teamId: user.team_id || "T-001",
                createdAt: user.created_at
            }));
        }
        if (client && store === "projects") {
            const { data, error } = await client.from("app_projects").select("data").order("id");
            if (error) throw error;
            return data.map(row => row.data);
        }
        if (client && store === "meta") {
            const { data, error } = await client.from("app_meta").select("key,value");
            if (error) throw error;
            return data;
        }
        if (_fallbackMode) return [..._fallbackData[store]];
        const db = await open();
        if (!db) { loadFallback(); return [..._fallbackData[store]]; }

        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readonly");
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function get(store, key) {
        const client = remoteClient();
        if (client && REMOTE_TABLES[store]) {
            const { data, error } = await client.from(REMOTE_TABLES[store].table).select("*").eq("id", key).maybeSingle();
            if (error) throw error;
            return data ? REMOTE_TABLES[store].fromRow(data) : null;
        }
        if (client && store === "users") {
            const { data, error } = await client.from("app_users").select("*").eq("id", key).maybeSingle();
            if (error) throw error;
            return data ? { id: data.id, username: data.username, fullName: data.full_name, role: data.role, active: data.active, notifications: data.notifications || [], teamId: data.team_id || "T-001", createdAt: data.created_at } : null;
        }
        if (client && store === "projects") {
            const { data, error } = await client.from("app_projects").select("data").eq("id", key).maybeSingle();
            if (error) throw error;
            return data ? data.data : null;
        }
        if (client && store === "meta") {
            const { data, error } = await client.from("app_meta").select("key,value").eq("key", key).maybeSingle();
            if (error) throw error;
            return data;
        }
        if (_fallbackMode) return _fallbackData[store].find(r => r.id === key || r.key === key) || null;
        const db = await open();
        if (!db) { loadFallback(); return _fallbackData[store].find(r => r.id === key || r.key === key) || null; }

        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readonly");
            const req = tx.objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function put(store, record) {
        const client = remoteClient();
        if (client && REMOTE_TABLES[store]) {
            const { data, error } = await client.from(REMOTE_TABLES[store].table).upsert(REMOTE_TABLES[store].toRow(record)).select("*").single();
            if (error) throw error;
            return REMOTE_TABLES[store].fromRow(data);
        }
        if (client && store === "users") {
            const { data, error } = await client.from("app_users").update({
                full_name: record.fullName,
                role: record.role,
                active: record.active,
                notifications: record.notifications || []
            }).eq("id", record.id).select("*").maybeSingle();
            if (error) throw error;
            return data;
        }
        if (client && store === "projects") {
            const { data, error } = await client.from("app_projects").upsert({
                id: record.id,
                data: record,
                updated_by: (await client.auth.getUser()).data.user?.id || null
            }).select("data").single();
            if (error) throw error;
            return data.data;
        }
        if (client && store === "meta") {
            const { data, error } = await client.from("app_meta").upsert({ key: record.key, value: record.value, updated_by: (await client.auth.getUser()).data.user?.id || null }).select("key,value").single();
            if (error) throw error;
            return data;
        }
        if (_fallbackMode) {
            const idField = store === "meta" ? "key" : "id";
            const idx = _fallbackData[store].findIndex(r => r[idField] === record[idField]);
            if (idx >= 0) _fallbackData[store][idx] = record; else _fallbackData[store].push(record);
            saveFallback();
            return record;
        }

        const db = await open();
        if (!db) {
            loadFallback();
            const idField = store === "meta" ? "key" : "id";
            const idx = _fallbackData[store].findIndex(r => r[idField] === record[idField]);
            if (idx >= 0) _fallbackData[store][idx] = record; else _fallbackData[store].push(record);
            saveFallback();
            return record;
        }

        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).put(record);
            tx.oncomplete = () => resolve(record);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function remove(store, key) {
        const client = remoteClient();
        if (client && REMOTE_TABLES[store]) {
            const { error } = await client.from(REMOTE_TABLES[store].table).delete().eq("id", key);
            if (error) throw error;
            return;
        }
        if (client && store === "users") {
            const { error } = await client.from("app_users").delete().eq("id", key);
            if (error) throw error;
            return;
        }
        if (client && store === "projects") {
            const { error } = await client.from("app_projects").delete().eq("id", key);
            if (error) throw error;
            return;
        }
        if (client && store === "meta") {
            const { error } = await client.from("app_meta").delete().eq("key", key);
            if (error) throw error;
            return;
        }
        if (_fallbackMode) {
            const idField = store === "meta" ? "key" : "id";
            _fallbackData[store] = _fallbackData[store].filter(r => r[idField] !== key);
            saveFallback();
            return;
        }

        const db = await open();
        if (!db) {
            loadFallback();
            const idField = store === "meta" ? "key" : "id";
            _fallbackData[store] = _fallbackData[store].filter(r => r[idField] !== key);
            saveFallback();
            return;
        }

        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function clearAll() {
        const client = remoteClient();
        if (client) {
            const { error } = await client.from("app_projects").delete().neq("id", "__never__");
            if (error) throw error;
            return;
        }
        if (window.indexedDB) {
            await new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(DB_NAME);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
            });
        }
        localStorage.removeItem(FALLBACK_KEY);
        _dbPromise = null;
        _fallbackMode = false;
        _fallbackData = null;
    }

    function subscribeChanges(onChange) {
        const client = remoteClient();
        if (!client) return () => {};
        const channel = client.channel("freelasync-dashboard");
        channel.on("postgres_changes", { event: "*", schema: "public", table: "app_projects" }, onChange);
        channel.on("postgres_changes", { event: "*", schema: "public", table: "app_users" }, onChange);
        channel.on("postgres_changes", { event: "*", schema: "public", table: "app_meta" }, onChange);
        ["app_teams", "app_todos"].forEach(table => channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange));
        channel.subscribe();
        return () => client.removeChannel(channel);
    }

    async function rpc(name, params) {
        const client = remoteClient();
        if (!client) return null;
        const { data, error } = await client.rpc(name, params);
        if (error) throw error;
        return data;
    }

    return { getAll, get, put, remove, clearAll, subscribeChanges, remoteReady, rpc, STORES };
})();
