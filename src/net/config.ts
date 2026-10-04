/** True when the build has Supabase settings, so multiplayer can be offered. Kept separate from supabase.ts so checking it doesn't load the client library. */
export function multiplayerConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}
