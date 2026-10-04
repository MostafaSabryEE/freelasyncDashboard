import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getBearerToken(request: Request) {
    const header = request.headers.get("Authorization") || "";
    return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

export async function requireAppUser(request: Request) {
    const token = getBearerToken(request);
    if (!token) throw new Error("Missing authorization token.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Invalid or expired session.");

    const { data: profile, error: profileError } = await adminClient
        .from("app_users")
        .select("id, role, active")
        .eq("id", userData.user.id)
        .single();
    if (profileError || !profile || profile.active !== true) {
        throw new Error("Only active users can perform this action.");
    }

    return { adminClient, user: userData.user, profile };
}

export async function requireAdmin(request: Request) {
    const result = await requireAppUser(request);
    if (result.profile.role !== "admin") throw new Error("Only active administrators can perform this action.");
    return result;
}
