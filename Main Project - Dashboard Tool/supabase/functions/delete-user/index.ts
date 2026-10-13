import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAppUser } from "../_shared/auth.ts";

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
            .select("id, role, team_id")
            .eq("id", userId)
            .maybeSingle();
        if (targetError) return jsonResponse({ error: targetError.message }, 400);
        if (!target) return jsonResponse({ error: "User not found." }, 404);
        // Admins delete anyone; Business Owners only non-admin users inside teams they created.
        if (callerProfile.role !== "admin") {
            let allowed = false;
            if (callerProfile.role === "owner" && target.role !== "admin") {
                const { data: team } = await adminClient.from("app_teams").select("id").eq("id", target.team_id).eq("owner_id", adminUser.id).maybeSingle();
                allowed = Boolean(team);
            }
            if (!allowed) return jsonResponse({ error: "You do not have permission to delete this user." }, 403);
        }

        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) return jsonResponse({ error: error.message }, 400);

        return jsonResponse({ ok: true });
    } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Request failed." }, 401);
    }
});
