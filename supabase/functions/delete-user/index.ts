import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAppUser } from "../_shared/auth.ts";

const projectManagerDeletableRoles = new Set(["owner", "tester", "developer"]);

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

    try {
        const { adminClient, user: adminUser, profile: callerProfile } = await requireAppUser(request);
        const body = await request.json();
        const userId = String(body.userId || "").trim();

        if (!userId) return jsonResponse({ error: "User ID is required." }, 400);
        if (userId === adminUser.id) return jsonResponse({ error: "You cannot delete the account you are logged in with." }, 400);

        const { data: target, error: targetError } = await adminClient
            .from("app_users")
            .select("id, role")
            .eq("id", userId)
            .maybeSingle();
        if (targetError) return jsonResponse({ error: targetError.message }, 400);
        if (!target) return jsonResponse({ error: "User not found." }, 404);
        if (callerProfile.role !== "admin" && (callerProfile.role !== "project_manager" || !projectManagerDeletableRoles.has(target.role))) {
            return jsonResponse({ error: "You do not have permission to delete this user." }, 403);
        }

        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) return jsonResponse({ error: error.message }, 400);

        return jsonResponse({ ok: true });
    } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Request failed." }, 401);
    }
});
