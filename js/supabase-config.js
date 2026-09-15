"use strict";
/*
 * Supabase browser client configuration.
 * Set the two values below for the deployed frontend. The anon key is
 * intended for browser use; never put a service-role key in this file.
 */
const FreelaSupabase = (() => {
    const config = {
        url: "",
        anonKey: ""
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