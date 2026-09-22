import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

const allowedRoles = new Set(["admin", "owner", "project_manager", "product_owner", "developer", "tester", "client"]);

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

    try {
        const { adminClient } = await requireAdmin(request);
        const body = await request.json();
        const id = String(body.userId || "").trim();
        const fullName = String(body.fullName || "").trim();
        const role = String(body.role || "");
        const password = String(body.password || "");
        const active = body.active !== false;

        if (!id) return jsonResponse({ error: "User ID is required." }, 400);
        if (fullName.length < 2) return jsonResponse({ error: "Full name is required." }, 400);
        if (!allowedRoles.has(role)) return jsonResponse({ error: "Invalid user role." }, 400);
        if (password && password.length < 6) return jsonResponse({ error: "Password must be at least 6 characters." }, 400);

        const { data: target, error: targetError } = await adminClient.from("app_users").select("id").eq("id", id).single();
        if (targetError || !target) return jsonResponse({ error: "User not found." }, 404);

        if (password) {
            const { error } = await adminClient.auth.admin.updateUserById(id, { password });
            if (error) return jsonResponse({ error: error.message }, 400);
        }

        const { data: profile, error: profileError } = await adminClient
            .from("app_users")
            .update({ full_name: fullName, role, active })
            .eq("id", id)
            .select("id, username, full_name, role, active, notifications, created_at")
            .single();
        if (profileError) return jsonResponse({ error: profileError.message }, 400);

        return jsonResponse({ user: profile });
    } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Request failed." }, 401);
    }
});
