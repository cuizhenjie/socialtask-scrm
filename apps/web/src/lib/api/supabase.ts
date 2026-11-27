// Server-only: never expose the service role via NEXT_PUBLIC_*.
export const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
export const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

export function serviceHeaders() {
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
}
