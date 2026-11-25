import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function getAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service configuration is incomplete");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authenticateRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Authentication required");

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("Supabase authentication configuration is incomplete");
  }
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new Error("Invalid authentication token");
  }
  return { client, userId: data.user.id, user: data.user };
}

export async function requireOrganizationRole(
  request: Request,
  organizationId: string,
  allowedRoles: string[],
) {
  const { userId } = await authenticateRequest(request);
  const client = getAdminClient();
  const { data, error } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Could not verify organization membership");
  if (!data || !allowedRoles.includes(data.role)) {
    throw new Error("Insufficient organization role");
  }
  return { client, userId, role: data.role };
}
