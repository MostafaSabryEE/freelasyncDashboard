"use strict";
/*
 * Supabase browser client configuration.
 * Set the two public values below for the deployed frontend. Static HTML
 * cannot read Vercel environment variables at runtime, so these values must
 * be injected during a build or stored here. The anon key is browser-safe;
 * never put a service-role key in this file.
 */
const FreelaSupabase = (() => {
    const config = {
        url: window.FREELASYNC_CONFIG?.url || "",
        anonKey: window.FREELASYNC_CONFIG?.anonKey || ""
    };

    function isConfigured() {
        return Boolean(config.url && config.anonKey && window.supabase);
    }

    function getClient() {
        if (!isConfigured()) return null;
        return window.supabase.createClient(config.url, config.anonKey);
    }

    return { config, isConfigured, getClient };
})();
