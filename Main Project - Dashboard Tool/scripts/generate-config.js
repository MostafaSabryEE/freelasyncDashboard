const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";

if (!url || !anonKey) {
    console.warn("SUPABASE_URL or SUPABASE_ANON_KEY is missing; the app will use local storage.");
}

const output = `"use strict";\nconst FreelaSupabase = (() => {\n    const config = ${JSON.stringify({ url, anonKey }, null, 4)};\n    function isConfigured() { return Boolean(config.url && config.anonKey && window.supabase); }\n    function getClient() { return isConfigured() ? window.supabase.createClient(config.url, config.anonKey) : null; }\n    return { config, isConfigured, getClient };\n})();\n`;

fs.writeFileSync(path.join(__dirname, "..", "js", "supabase-config.js"), output, "utf8");
