"use strict";
/*
 * Supabase browser client configuration.
 * Set the two values below for the deployed frontend. The anon key is
 * intended for browser use; never put a service-role key in this file.
 */
const FreelaSupabase = (() => {
    const config = {
        url: "https://pmlxghpmfqnehlgsitqe.supabase.co",
        anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtbHhnaHBtZnFuZWhsZ3NpdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTk5ODMsImV4cCI6MjEwNTA3NTk4M30.FAFhTQx9fKhYRw4OYgjSyYzCxqtpGmRmXeO7NLjxUeQ"
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
