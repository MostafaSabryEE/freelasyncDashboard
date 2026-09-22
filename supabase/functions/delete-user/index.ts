import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

    try {
        const { adminClient, user: adminUser } = await requireAdmin(request);
        const body = await request.json();
        const userId = String(body.userId || "").trim();

        if (!userId) return jsonResponse({ error: "User ID is required." }, 400);
        if (userId === adminUser.id) return jsonResponse({ error: "You cannot delete the account you are logged in with." }, 400);

        const { data: target, error: targetError } = await adminClient
            .from("app_users")
            .select("id")
            .eq("id", userId)
            .maybeSingle();
        if (targetError) return jsonResponse({ error: targetError.message }, 400);
        if (!target) return jsonResponse({ error: "User not found." }, 404);

        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) return jsonResponse({ error: error.message }, 400);

        return jsonResponse({ ok: true });
    } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Request failed." }, 401);
    }
});
