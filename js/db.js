"use strict";
/*
 * FreelaSync client-side database layer.
 * Uses IndexedDB (falls back to localStorage) so the tool works fully
 * offline as a static site (GitHub Pages has no server-side backend).
 * Object stores: "users", "projects".
 */
const FreelaDB = (() => {
    const DB_NAME = "freelasync_db";
    const DB_VERSION = 1;
    const STORES = ["users", "projects", "meta"];

    let _dbPromise = null;
    let _fallbackMode = false;
    let _fallbackData = null; // { users: [], projects: [], meta: [] }

    const FALLBACK_KEY = "freelasync_fallback_store_v1";

    function loadFallback() {
        try {
            const raw = localStorage.getItem(FALLBACK_KEY);
            _fallbackData = raw ? JSON.parse(raw) : { users: [], projects: [], meta: [] };
        } catch (e) {
            _fallbackData = { users: [], projects: [], meta: [] };
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
            };

            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => {
                _fallbackMode = true;
                loadFallback();
                resolve(null);
            };
        });

        return _dbPromise;
    }

    async function getAll(store) {
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

    return { getAll, get, put, remove, clearAll, STORES };
})();
