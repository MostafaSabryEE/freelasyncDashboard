import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAppUser } from "../_shared/auth.ts";

const allowedRoles = new Set(["admin", "owner", "project_manager", "product_owner", "developer", "tester", "client"]);
const creatorRoles = new Map([
    ["admin", new Set(["admin", "owner", "project_manager", "product_owner", "developer", "tester", "client"])],
    ["project_manager", new Set(["owner", "project_manager", "developer", "tester"])],
    ["owner", new Set(["owner", "project_manager", "developer", "tester"])],
    ["tester", new Set(["owner", "project_manager", "developer", "tester"])],
    ["developer", new Set(["owner", "project_manager", "developer", "tester"])]
]);

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

    try {
        const { adminClient, profile: creator } = await requireAppUser(request);
        const body = await request.json();
        const email = String(body.email || body.username || "").trim().toLowerCase();
        const username = String(body.username || email.split("@")[0]).trim();
        const fullName = String(body.fullName || "").trim();
        const password = String(body.password || "");
        const role = String(body.role || "developer");

        if (!email.includes("@")) return jsonResponse({ error: "A valid email address is required." }, 400);
        if (fullName.length < 2) return jsonResponse({ error: "Full name is required." }, 400);
        if (password.length < 6) return jsonResponse({ error: "Password must be at least 6 characters." }, 400);
        if (!allowedRoles.has(role)) return jsonResponse({ error: "Invalid user role." }, 400);
        if (!creatorRoles.get(creator.role)?.has(role)) {
            return jsonResponse({ error: "You do not have permission to create this role." }, 403);
        }

        const { data: created, error: createError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { username, full_name: fullName }
        });
        if (createError || !created.user) return jsonResponse({ error: createError?.message || "Could not create user." }, 400);

        const { data: profile, error: profileError } = await adminClient
            .from("app_users")
            .update({ username, full_name: fullName, role, active: true })
            .eq("id", created.user.id)
            .select("id, username, full_name, role, active, notifications, created_at")
            .single();
        if (profileError) {
            await adminClient.auth.admin.deleteUser(created.user.id);
            return jsonResponse({ error: profileError.message }, 500);
        }

        return jsonResponse({ user: profile }, 201);
    } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Request failed." }, 401);
    }
});
